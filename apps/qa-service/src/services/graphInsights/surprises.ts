/**
 * graphInsights/surprises.ts —— 惊奇连接
 *
 * 定义（design.md §4.3 · D-003）：
 *   surprise_score = w_cross * is_cross_community(e)
 *                  + w_type  * is_cross_type(e)
 *                  + w_weight * log(1 + edge.weight)
 *
 * 注意：Louvain 降级时 is_cross_community 无法算 → 整条洞察类型返回空数组。
 */
import { surpriseKey } from './keys.ts'
import type { LouvainResult } from './louvain.ts'
import type { SpaceSubgraph } from './loader.ts'

export interface SurpriseInsight {
  key: string
  a: { id: number; name: string; type: string }
  b: { id: number; name: string; type: string }
  edge_weight: number
  cross_community: boolean
  cross_type: boolean
  surprise_score: number
}

export interface SurpriseWeights {
  crossCommunity: number
  crossType: number
  edgeLog: number
}

export function computeSurprises(
  subgraph: SpaceSubgraph,
  louvain: LouvainResult,
  opts: { weights: SurpriseWeights; topN: number },
): SurpriseInsight[] {
  const assetById = new Map(subgraph.assets.map((a) => [a.id, a]))
  const out: SurpriseInsight[] = []

  for (const e of subgraph.coCitedEdges) {
    const aAsset = assetById.get(e.a)
    const bAsset = assetById.get(e.b)
    if (!aAsset || !bAsset) continue
    const cA = louvain.communities.get(e.a)
    const cB = louvain.communities.get(e.b)
    // 若任一端点未被 Louvain 归类（孤立节点未进图），跳过
    if (cA == null || cB == null) continue
    const crossCommunity = cA !== cB
    if (!crossCommunity) continue // 只报跨社区的惊奇
    const crossType = aAsset.type !== bAsset.type

    const score =
      opts.weights.crossCommunity * 1 +
      opts.weights.crossType * (crossType ? 1 : 0) +
      opts.weights.edgeLog * Math.log(1 + Math.max(1, e.weight))

    out.push({
      key: surpriseKey(e.a, e.b),
      a: { id: aAsset.id, name: aAsset.name, type: aAsset.type },
      b: { id: bAsset.id, name: bAsset.name, type: bAsset.type },
      edge_weight: e.weight,
      cross_community: crossCommunity,
      cross_type: crossType,
      surprise_score: Math.round(score * 100) / 100,
    })
  }
  out.sort((x, y) => y.surprise_score - x.surprise_score)
  return out.slice(0, opts.topN)
}
