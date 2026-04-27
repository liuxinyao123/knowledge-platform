import type { Pool } from 'mysql2/promise'
import { getPageForIndexing, listPagesBatch } from './bookstack.ts'
import { chatComplete, isLlmConfigured } from './llm.ts'

export function parseBookstackPageId(externalRef: string): number | null {
  const m = /^bookstack:page:(\d+)$/.exec(externalRef.trim())
  return m ? Number(m[1]) : null
}

/** 从 BookStack 分页拉取页面并写入 asset_item（幂等 upsert） */
export async function syncBookstackAssetsForSource(
  pool: Pool,
  sourceId: number,
): Promise<{ upserted: number }> {
  let offset = 0
  const count = 100
  let upserted = 0
  for (;;) {
    const pages = await listPagesBatch(offset, count)
    if (!pages.length) break
    for (const p of pages) {
      const ref = `bookstack:page:${p.id}`
      await pool.execute(
        `INSERT INTO asset_item (source_id, external_ref, name, asset_type, ingest_status)
         VALUES (?, ?, ?, 'document', 'unknown')
         ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP`,
        [sourceId, ref, p.name],
      )
      upserted++
    }
    if (pages.length < count) break
    offset += count
  }

  const [cntRows] = await pool.execute(
    'SELECT COUNT(*) AS n FROM asset_item WHERE source_id = ?',
    [sourceId],
  )
  const n = Number((cntRows as { n: number }[])[0]?.n ?? 0)
  await pool.execute(
    'UPDATE asset_source SET asset_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [n, sourceId],
  )

  return { upserted }
}

export async function getDefaultBookstackSourceId(pool: Pool): Promise<number | null> {
  const [rows] = await pool.execute(
    'SELECT id FROM asset_source WHERE source_type = ? ORDER BY id LIMIT 1',
    ['bookstack'],
  )
  const r = rows as { id: number }[]
  return r[0]?.id ?? null
}

/** 按 knowledge_chunks 统计结果 upsert asset_knowledge_link，并刷新 ingest_status */
export async function refreshKnowledgeLinksForSource(pool: Pool, sourceId: number): Promise<{ updated: number }> {
  const [items] = await pool.execute(
    'SELECT id, external_ref FROM asset_item WHERE source_id = ?',
    [sourceId],
  )
  let updated = 0
  for (const row of items as { id: number; external_ref: string }[]) {
    const pageId = parseBookstackPageId(row.external_ref)
    if (pageId == null) {
      await pool.execute(
        `INSERT INTO asset_knowledge_link (item_id, vector_mapping_id, mapping_type, status, last_error)
         VALUES (?, NULL, 'rag', 'skipped', ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), last_error = VALUES(last_error), updated_at = CURRENT_TIMESTAMP`,
        [row.id, '非 BookStack 页面引用，跳过映射'],
      )
      updated++
      continue
    }
    const [cRows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM knowledge_chunks WHERE page_id = ?',
      [pageId],
    )
    const chunkCount = Number((cRows as { n: number }[])[0]?.n ?? 0)
    const refKey = `bookstack:page:${pageId}`
    const status = chunkCount > 0 ? 'linked' : 'pending'
    await pool.execute(
      `INSERT INTO asset_knowledge_link (item_id, vector_mapping_id, mapping_type, status, last_error)
       VALUES (?, ?, 'rag', ?, NULL)
       ON DUPLICATE KEY UPDATE vector_mapping_id = VALUES(vector_mapping_id), status = VALUES(status),
         last_error = NULL, updated_at = CURRENT_TIMESTAMP`,
      [row.id, refKey, status],
    )
    const ingest = chunkCount > 0 ? 'indexed' : 'not_indexed'
    await pool.execute(
      'UPDATE asset_item SET ingest_status = ? WHERE id = ?',
      [ingest, row.id],
    )
    updated++
  }
  return { updated }
}

async function summarizeBody(text: string): Promise<{ text: string; summaryStatus: string }> {
  const clipped = text.replace(/\s+/g, ' ').trim().slice(0, 800)
  if (!isLlmConfigured()) {
    return { text: clipped, summaryStatus: 'fallback' }
  }
  const { content } = await chatComplete(
    [{ role: 'user', content: `用中文写一段 200 字以内的摘要，保留主题与关键事实，不要编造：\n\n${text.slice(0, 12_000)}` }],
    { maxTokens: 400 },
  )
  return { text: content?.trim() || clipped, summaryStatus: content ? 'done' : 'fallback' }
}

/** 为尚未生成摘要的资产拉取正文并写入 summary（无 API Key 时截取正文） */
export async function enrichSummariesForSource(
  pool: Pool,
  sourceId: number,
  opts?: { limit?: number },
): Promise<{ processed: number }> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 20))
  const [rows] = await pool.execute(
    `SELECT id, external_ref FROM asset_item
     WHERE source_id = ? AND (summary IS NULL OR summary_status IN ('pending', 'fallback'))
     ORDER BY id LIMIT ?`,
    [sourceId, limit],
  )
  let processed = 0
  for (const row of rows as { id: number; external_ref: string }[]) {
    const pageId = parseBookstackPageId(row.external_ref)
    if (pageId == null) {
      await pool.execute(
        'UPDATE asset_item SET summary_status = ? WHERE id = ?',
        ['skipped', row.id],
      )
      processed++
      continue
    }
    try {
      const page = await getPageForIndexing(pageId)
      const body = page.text?.trim() ?? ''
      if (!body) {
        await pool.execute(
          'UPDATE asset_item SET summary = NULL, summary_status = ? WHERE id = ?',
          ['empty', row.id],
        )
        processed++
        continue
      }
      const { text, summaryStatus } = await summarizeBody(body)
      await pool.execute(
        'UPDATE asset_item SET summary = ?, summary_status = ? WHERE id = ?',
        [text, summaryStatus, row.id],
      )
    } catch {
      await pool.execute(
        'UPDATE asset_item SET summary_status = ? WHERE id = ?',
        ['error', row.id],
      )
    }
    processed++
  }
  return { processed }
}
