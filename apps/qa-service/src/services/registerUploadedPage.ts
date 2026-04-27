import type { Pool } from 'mysql2/promise'
import { getPageForIndexing } from './bookstack.ts'
import { getDefaultBookstackSourceId, refreshKnowledgeLinksForSource } from './assetCatalog.ts'
import { indexBookstackPage } from './indexBookstackPage.ts'

export type RegisterUploadedPageResult = {
  pageId: number
  sourceId: number
  assetItemUpserted: boolean
  chunks: number
  indexSkipped: boolean
}

/**
 * 将已写入 BookStack 的页面登记到 asset_item，并增量更新 knowledge_chunks 与 asset_knowledge_link。
 */
export async function registerUploadedBookstackPage(
  pool: Pool,
  pageId: number,
  opts?: { summary?: string | null },
): Promise<RegisterUploadedPageResult> {
  if (!Number.isFinite(pageId) || pageId <= 0) {
    throw new Error('invalid pageId')
  }

  const page = await getPageForIndexing(pageId)
  const sourceId = await getDefaultBookstackSourceId(pool)
  if (sourceId == null) {
    throw new Error('no bookstack asset_source row')
  }

  const externalRef = `bookstack:page:${pageId}`
  const summary = opts?.summary?.trim() || null

  await pool.execute(
    `INSERT INTO asset_item (source_id, external_ref, name, asset_type, ingest_status)
     VALUES (?, ?, ?, 'document', 'unknown')
     ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP`,
    [sourceId, externalRef, page.name],
  )
  if (summary) {
    await pool.execute(
      `UPDATE asset_item SET summary = ?, summary_status = 'done' WHERE source_id = ? AND external_ref = ?`,
      [summary, sourceId, externalRef],
    )
  }

  const idx = await indexBookstackPage(pageId)
  await refreshKnowledgeLinksForSource(pool, sourceId)

  const [cntRows2] = await pool.execute(
    'SELECT COUNT(*) AS n FROM asset_item WHERE source_id = ?',
    [sourceId],
  )
  const ac = Number((cntRows2 as { n: number }[])[0]?.n ?? 0)
  await pool.execute(
    'UPDATE asset_source SET asset_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [ac, sourceId],
  )

  const [cntRows] = await pool.execute(
    'SELECT COUNT(*) AS n FROM asset_item WHERE source_id = ? AND external_ref = ?',
    [sourceId, externalRef],
  )
  const ok = Number((cntRows as { n: number }[])[0]?.n ?? 0) > 0

  return {
    pageId,
    sourceId,
    assetItemUpserted: ok,
    chunks: idx.chunks,
    indexSkipped: idx.skipped,
  }
}
