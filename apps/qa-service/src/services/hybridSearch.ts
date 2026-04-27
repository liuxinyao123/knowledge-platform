/**
 * services/hybridSearch.ts —— 向量 + 关键词 双路 + RRF 融合
 *
 * 思路：
 *   1. 并行调 vector retrieve（top-N=20）和 keyword retrieve（top-N=20）
 *   2. RRF 融合：score(d) = Σ 1 / (k + rank(d)), 默认 k=60
 *   3. 按 RRF 分数倒序，取 top-K
 *
 * 适用场景：
 *   - 短查询（COF / DTS / VSM 这种 3-4 字母缩写）—— vector 失语义、keyword 直击
 *   - 含关键术语的问题（"缓冲块"、"邵氏度"）—— 双路求并集，更全
 *   - 纯概念问题 —— 跟纯 vector 差不多（keyword 路命中少）
 *
 * 文献：Cormack et al. "Reciprocal Rank Fusion outperforms Condorcet and
 *      individual Rank Learning Methods" (SIGIR 2009)
 */
import { searchKnowledgeChunks, type AssetChunk } from './knowledgeSearch.ts'
import { searchKnowledgeByKeyword } from './keywordSearch.ts'

export interface HybridSearchInput {
  query: string
  top_k?: number
  asset_ids?: number[]
  source_ids?: number[]
  /** RRF 常数，默认 60；越大越平等对待两路 */
  rrf_k?: number
}

export interface HybridResult extends AssetChunk {
  /** RRF 分数 */
  rrf_score: number
  /** 来源：v=vector / k=keyword / b=both */
  source_set: 'v' | 'k' | 'b'
  vector_rank?: number
  keyword_rank?: number
}

/** chunk 唯一性 key —— 同一 (asset_id, content) 视为同一 chunk */
function chunkKey(c: AssetChunk): string {
  return `${c.asset_id}::${c.chunk_content.slice(0, 80)}`
}

export async function searchHybrid(input: HybridSearchInput): Promise<HybridResult[]> {
  const top_k = Math.min(50, Math.max(1, Number(input.top_k ?? 20)))
  const recall_n = Math.max(top_k, 20)   // 两路各拉宽，给 RRF 更多素材
  const k = Math.max(1, Number(input.rrf_k ?? 60))

  const sharedOpts = {
    top_k: recall_n,
    asset_ids: input.asset_ids,
    source_ids: input.source_ids,
  }

  // 并行
  const [vectorRes, keywordRes] = await Promise.all([
    searchKnowledgeChunks({ query: input.query, ...sharedOpts }),
    searchKnowledgeByKeyword({ query: input.query, ...sharedOpts }),
  ])

  // RRF 融合
  type Acc = HybridResult & { _vR?: number; _kR?: number }
  const map = new Map<string, Acc>()

  vectorRes.forEach((c, i) => {
    const key = chunkKey(c)
    map.set(key, {
      ...c,
      rrf_score: 1 / (k + i + 1),
      source_set: 'v',
      vector_rank: i + 1,
      _vR: i + 1,
    })
  })

  keywordRes.forEach((c, i) => {
    const key = chunkKey(c)
    const exist = map.get(key)
    const inc = 1 / (k + i + 1)
    if (exist) {
      exist.rrf_score += inc
      exist.source_set = 'b'
      exist.keyword_rank = i + 1
      exist._kR = i + 1
    } else {
      map.set(key, {
        ...c,
        rrf_score: inc,
        source_set: 'k',
        keyword_rank: i + 1,
        _kR: i + 1,
      })
    }
  })

  return [...map.values()]
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, top_k)
}
