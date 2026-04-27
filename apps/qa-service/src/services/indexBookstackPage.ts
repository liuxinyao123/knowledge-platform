import { getPageForIndexing, listPageAttachments, getAttachmentContent } from './bookstack.ts'
import { chunkText } from './chunkText.ts'
import { embedTexts, isEmbeddingConfigured } from './embeddings.ts'
import { getPool } from './db.ts'
import { getPgPool } from './pgDb.ts'
import { ingestDocument, isKnownExt } from './ingestPipeline/index.ts'

/**
 * 取 metadata_source connector='bookstack' 的 id；
 * 由 pgDb.ensureDefaultSource 保证常有一条。
 */
async function getBookstackSourceIdInPg(): Promise<number | null> {
  const pgPool = getPgPool()
  const { rows } = await pgPool.query(
    `SELECT id FROM metadata_source WHERE connector = 'bookstack' LIMIT 1`,
  )
  return rows.length ? Number(rows[0].id) : null
}

/**
 * 删除并重建单页向量切片：双写
 *   1. MySQL knowledge_chunks    —— 向后兼容 vectorSearch.ts / assetDirectory 统计
 *   2. pgvector metadata_field   —— 通过 ingestDocument 写入，供 knowledge-qa RAG 检索
 *
 * 需配置嵌入 API；未配置则跳过写入。
 * pgvector 写入失败不阻断老路径；仅日志 WARN。
 */
export async function indexBookstackPage(pageId: number): Promise<{
  chunks: number
  skipped: boolean
  pgAssetId?: number
  extractorId?: string
  attachments?: { total: number; ingested: number; skipped: number; failed: number }
}> {
  if (!isEmbeddingConfigured()) {
    return { chunks: 0, skipped: true }
  }

  const page = await getPageForIndexing(pageId)
  const text = page.text?.trim() ?? ''
  const pool = getPool()

  // ── 1) 老路径：MySQL knowledge_chunks（仅用 HTML body 文本）─────────────
  const parts = text ? chunkText(text) : []
  await pool.execute('DELETE FROM knowledge_chunks WHERE page_id = ?', [pageId])
  if (parts.length) {
    const vectors = await embedTexts(parts)
    if (vectors.length !== parts.length) {
      throw new Error('embedding count mismatch')
    }
    for (let i = 0; i < parts.length; i++) {
      await pool.execute(
        `INSERT INTO knowledge_chunks (page_id, chunk_index, page_name, page_url, text, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [page.id, i, page.name, page.url, parts[i], JSON.stringify(vectors[i])],
      )
    }
  }

  const sourceId = await getBookstackSourceIdInPg()

  // ── 2) 新路径：pgvector metadata_field via ingestDocument（页面正文）────
  let pgAssetId: number | undefined
  let extractorId: string | undefined
  if (sourceId != null && text) {
    try {
      const out = await ingestDocument({
        buffer: Buffer.from(text, 'utf-8'),
        name: `bookstack-page-${pageId}.txt`,
        sourceId,
        opts: { skipTags: text.length < 500 },
      })
      pgAssetId = out.assetId
      extractorId = out.extractorId
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `WARN: pgvector sync failed for bookstack page ${pageId}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      )
    }
  }

  // ── 3) 附件链路（ADR-31 · 2026-04-24）─────────────────────────────────
  // 用户往 BookStack 页面上传的 xlsx / pdf / docx 等附件，
  // 按 extension 走 ingestPipeline 的对应 extractor（xlsxExtractor / pdfExtractor / ...）
  // 幂等性：按 external_path='bookstack:attachment:{id}' 先 DELETE 再 INSERT
  const attStats = { total: 0, ingested: 0, skipped: 0, failed: 0 }
  if (sourceId != null) {
    try {
      const attachments = await listPageAttachments(pageId)
      attStats.total = attachments.length
      const pgPool = getPgPool()

      for (const att of attachments) {
        // 外部链接跳过（不是实体文件）
        if (att.external) { attStats.skipped++; continue }
        // 未知扩展名也跳过（避免把任意文件都丢给 plaintext 兜底）
        if (!isKnownExt(att.name)) { attStats.skipped++; continue }

        try {
          const content = await getAttachmentContent(att.id)
          if (!content) { attStats.skipped++; continue }

          const externalPath = `bookstack:attachment:${att.id}`

          // 幂等：先删该附件的旧 asset（FK CASCADE 带走 metadata_field / metadata_asset_image）
          await pgPool.query(
            `DELETE FROM metadata_asset WHERE external_path = $1`,
            [externalPath],
          )

          // 用真实文件名 → router 路由到正确 extractor（xlsx / pdf / docx / ...）
          const out = await ingestDocument({
            buffer: content.buffer,
            name: content.name,
            sourceId,
          })

          // 打上附件外部标识，供下次 sync 幂等识别
          await pgPool.query(
            `UPDATE metadata_asset SET external_path = $1, external_id = $2 WHERE id = $3`,
            [externalPath, String(att.id), out.assetId],
          )

          attStats.ingested++
        } catch (err) {
          attStats.failed++
          // eslint-disable-next-line no-console
          console.warn(
            `WARN: attachment ingest failed (page=${pageId}, att=${att.id}, name=${att.name}): ${
              err instanceof Error ? err.message : 'unknown'
            }`,
          )
        }
      }
    } catch (err) {
      // 附件 API 本身失败不阻塞页面索引
      // eslint-disable-next-line no-console
      console.warn(
        `WARN: list attachments failed (page=${pageId}): ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
  }

  return { chunks: parts.length, skipped: false, pgAssetId, extractorId, attachments: attStats }
}
