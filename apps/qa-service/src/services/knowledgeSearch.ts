/**
 * knowledgeSearch.ts —— 向量检索 service（从 routes/knowledgeDocs.ts 抽出）
 *
 * 角色：
 *   - routes/knowledgeDocs.ts 的 POST /search 薄壳直接调本 service
 *   - services/ragPipeline.ts 的 Step 1 retrieveInitial 内部复用
 *
 * 设计决策：见 openspec/changes/knowledge-qa/design.md
 *   - score > 0.5 阈值由调用方决定（本 service 不过滤）
 *   - 返回原始 rows，RAG 负责阈值/排序/裁剪
 */
import { getPgPool } from './pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from './embeddings.ts'

export interface AssetChunk {
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  metadata: Record<string, unknown> | null
  /** ingest-l0-abstract（ADR-32 候选）：可选 chunk 主键，给 lazy backfill 用 */
  chunk_id?: number
}

export interface KnowledgeSearchInput {
  query: string
  top_k?: number
  source_ids?: number[]
  /** Notebook 等场景：把检索结果限定在指定 metadata_asset.id 集合内 */
  asset_ids?: number[]
  /** 可选：ACL 行级过滤（unified-auth change 引入） */
  aclFilter?: { where: string; params: unknown[] }
}

export class EmbeddingNotConfiguredError extends Error {
  constructor() {
    super('embedding not configured')
    this.name = 'EmbeddingNotConfiguredError'
  }
}

/**
 * 按问题语义在 metadata_field 中做 ANN 检索，返回 chunk 粒度结果。
 * 不做阈值过滤；调用方自行决定 min_score。
 */
export async function searchKnowledgeChunks(
  input: KnowledgeSearchInput,
): Promise<AssetChunk[]> {
  const { query, top_k = 10, source_ids, asset_ids, aclFilter } = input
  if (!query?.trim()) return []
  if (!isEmbeddingConfigured()) throw new EmbeddingNotConfiguredError()

  const k = Math.min(50, Math.max(1, Number(top_k)))
  const pool = getPgPool()

  const [qVec] = await embedTexts([query])
  const vecStr = `[${qVec.join(',')}]`

  const params: unknown[] = [vecStr, k]
  const filters: string[] = []
  if (source_ids?.length) {
    params.push(source_ids)
    filters.push(`ma.source_id = ANY($${params.length}::int[])`)
  }
  if (asset_ids?.length) {
    params.push(asset_ids)
    filters.push(`mf.asset_id = ANY($${params.length}::int[])`)
  }
  if (aclFilter?.where) {
    // 调用方已保证 where 是参数化片段；这里把 params 续到末尾
    const baseIdx = params.length
    filters.push(
      // 把 $1/$2 之类偏移到 baseIdx+1/2 上避免冲突
      aclFilter.where.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + baseIdx}`),
    )
    for (const p of aclFilter.params) params.push(p)
  }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''

  const { rows } = await pool.query(
    `SELECT
       mf.id          AS chunk_id,
       mf.asset_id,
       ma.name        AS asset_name,
       mf.content     AS chunk_content,
       1 - (mf.embedding <=> $1::vector) AS score,
       mf.metadata
     FROM metadata_field mf
     JOIN metadata_asset ma ON ma.id = mf.asset_id
     WHERE mf.embedding IS NOT NULL
       AND mf.chunk_level = 3
       AND (ma.offline IS NULL OR ma.offline = false)
       ${where}
     ORDER BY mf.embedding <=> $1::vector
     LIMIT $2`,
    params,
  )

  return rows as AssetChunk[]
}
