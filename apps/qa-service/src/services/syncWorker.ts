import { listAllPageIds, getPageForIndexing } from './bookstack.ts'
import { chunkText } from './chunkText.ts'
import { embedTexts, isEmbeddingConfigured } from './embeddings.ts'
import { getPool } from './db.ts'

export interface FullSyncResult {
  pages: number
  chunks: number
  ms: number
}

/**
 * 全量同步：清空索引表 → 拉取所有页面 → 分块 → 嵌入 → 写入 MySQL。
 * 数据量大时耗时长，适合后台任务或手工触发。
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const t0 = Date.now()
  if (!isEmbeddingConfigured()) {
    throw new Error('全量索引需要嵌入 API：请配置 EMBEDDING_API_KEY 或 OPENAI_API_KEY（可选 EMBEDDING_BASE_URL 指向硅基流动等）')
  }

  const pool = getPool()
  const pageIds = await listAllPageIds()
  await pool.execute('DELETE FROM knowledge_chunks')

  let chunkTotal = 0
  for (const pageId of pageIds) {
    const page = await getPageForIndexing(pageId)
    if (!page.text.trim()) continue

    const parts = chunkText(page.text)
    if (!parts.length) continue

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
    chunkTotal += parts.length
  }

  await pool.execute(
    `INSERT INTO knowledge_sync_meta (meta_key, meta_value)
     VALUES ('last_full_sync', ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [new Date().toISOString()],
  )

  return { pages: pageIds.length, chunks: chunkTotal, ms: Date.now() - t0 }
}
