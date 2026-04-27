import type { PageDoc } from '../ragTypes.ts'
import { getPool } from './db.ts'
import { embedTexts, cosineSimilarity, isEmbeddingConfigured } from './embeddings.ts'

export interface ScoredChunk {
  page_id: number
  chunk_index: number
  page_name: string
  page_url: string
  text: string
  score: number
}

function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((x) => Number(x))
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown
      return Array.isArray(j) ? j.map((x) => Number(x)) : []
    } catch {
      return []
    }
  }
  return []
}

/** 将若干高分 chunk 合并为按页聚合的 PageDoc（供 RAG 使用） */
export function mergeChunksToPageDocs(chunks: ScoredChunk[], maxPages = 8): PageDoc[] {
  const byPage = new Map<
    number,
    { parts: string[]; page_name: string; page_url: string; best: number }
  >()

  for (const c of chunks) {
    const cur = byPage.get(c.page_id)
    if (!cur) {
      byPage.set(c.page_id, {
        parts: [c.text],
        page_name: c.page_name,
        page_url: c.page_url,
        best: c.score,
      })
    } else {
      if (cur.parts.length < 5) cur.parts.push(c.text)
      cur.best = Math.max(cur.best, c.score)
    }
  }

  return [...byPage.entries()]
    .sort((a, b) => b[1].best - a[1].best)
    .slice(0, maxPages)
    .map(([id, v]) => {
      const text = v.parts.join('\n\n').slice(0, 12_000)
      return {
        id,
        name: v.page_name,
        url: v.page_url,
        text,
        excerpt: text.slice(0, 200),
      }
    })
}

export async function countIndexChunks(): Promise<number> {
  const pool = getPool()
  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM knowledge_chunks')
  const row = (rows as Record<string, unknown>[])[0]
  const c = row?.c
  return Number(c ?? 0)
}

export async function getLastFullSyncIso(): Promise<string | null> {
  const pool = getPool()
  const [rows] = await pool.execute(
    'SELECT meta_value FROM knowledge_sync_meta WHERE meta_key = ?',
    ['last_full_sync'],
  )
  const row = (rows as Record<string, unknown>[])[0]
  const v = row?.meta_value
  return typeof v === 'string' ? v : null
}

interface ChunkRow {
  page_id: number
  chunk_index: number
  page_name: string
  page_url: string
  text: string
  embedding: unknown
}

/**
 * 本地向量检索：全表扫 + 余弦相似度（骨架实现；数据量大后应换 ANN 索引）
 */
export async function searchPagesByVector(
  question: string,
  topChunks = 24,
): Promise<PageDoc[]> {
  if (!isEmbeddingConfigured()) return []

  const pool = getPool()
  const [rows] = await pool.execute(
    'SELECT page_id, chunk_index, page_name, page_url, text, embedding FROM knowledge_chunks',
  ) as [ChunkRow[], unknown]

  if (!Array.isArray(rows) || rows.length === 0) return []

  const [qVec] = await embedTexts([question])
  const scored: ScoredChunk[] = []
  for (const r of rows) {
    const ev = parseEmbedding(r.embedding)
    if (ev.length === 0 || ev.length !== qVec.length) continue
    scored.push({
      page_id: r.page_id,
      chunk_index: r.chunk_index,
      page_name: r.page_name,
      page_url: r.page_url,
      text: r.text,
      score: cosineSimilarity(qVec, ev),
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return mergeChunksToPageDocs(scored.slice(0, topChunks))
}
