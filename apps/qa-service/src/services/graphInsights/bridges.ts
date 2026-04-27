/**
 * graphInsights/bridges.ts —— 桥接节点
 *
 * 定义（design.md §4.2）：
 *   - Louvain 启用：节点的 CO_CITED 邻居 distinct community_id ≥ 3
 *   - Louvain 降级：节点的 HAS_TAG tag set distinct ≥ 3（回退口径）
 */
import { bridgeKey } from './keys.ts'
import type { LouvainResult } from './louvain.ts'
import type { SpaceSubgraph } from './loader.ts'

export interface BridgeInsight {
  key: string
  asset_id: number
  name: string
  type: string
  /** 跨越社区/标签集群数 */
  bridge_count: number
  /** 识别口径 */
  mode: 'community' | 'tag'
  /** 最多 5 个邻居 id 样本，供 MiniGraph 渲染 */
  neighbor_sample: number[]
}

/** Louvain 启用时的主路径：邻居按 community_id 去重 */
export function computeBridgesByCommunity(
  subgraph: SpaceSubgraph,
  louvain: LouvainResult,
  opts: { minBridges: number },
): BridgeInsight[] {
  const adj = new Map<number, Set<number>>()
  for (const e of subgraph.coCitedEdges) {
    if (!adj.has(e.a)) adj.set(e.a, new Set())
    if (!adj.has(e.b)) adj.set(e.b, new Set())
    adj.get(e.a)!.add(e.b)
    adj.get(e.b)!.add(e.a)
  }
  const assetById = new Map(subgraph.assets.map((a) => [a.id, a]))

  const out: BridgeInsight[] = []
  for (const [id, neighbors] of adj) {
    const communities = new Set<number>()
    for (const n of neighbors) {
      const c = louvain.communities.get(n)
      if (c != null) communities.add(c)
    }
    if (communities.size < opts.minBridges) continue
    const asset = assetById.get(id)
    if (!asset) continue
    out.push({
      key: bridgeKey(id),
      asset_id: id,
      name: asset.name,
      type: asset.type,
      bridge_count: communities.size,
      mode: 'community',
      neighbor_sample: Array.from(neighbors).slice(0, 5),
    })
  }
  out.sort((x, y) => y.bridge_count - x.bridge_count)
  return out
}

/** Louvain 降级时的回退路径：按 tag 集群 distinct 判定 */
export function computeBridgesByTag(
  subgraph: SpaceSubgraph,
  opts: { minBridges: number },
): BridgeInsight[] {
  const tagsByAsset = new Map<number, Set<string>>()
  for (const t of subgraph.tagLinks) {
    if (!tagsByAsset.has(t.asset_id)) tagsByAsset.set(t.asset_id, new Set())
    tagsByAsset.get(t.asset_id)!.add(t.tag)
  }
  const adj = new Map<number, Set<number>>()
  for (const e of subgraph.coCitedEdges) {
    if (!adj.has(e.a)) adj.set(e.a, new Set())
    if (!adj.has(e.b)) adj.set(e.b, new Set())
    adj.get(e.a)!.add(e.b)
    adj.get(e.b)!.add(e.a)
  }
  const assetById = new Map(subgraph.assets.map((a) => [a.id, a]))

  const out: BridgeInsight[] = []
  for (const [id] of tagsByAsset) {
    const tags = tagsByAsset.get(id)
    if (!tags || tags.size < opts.minBridges) continue
    const asset = assetById.get(id)
    if (!asset) continue
    const neighbors = adj.get(id) ?? new Set<number>()
    out.push({
      key: bridgeKey(id),
      asset_id: id,
      name: asset.name,
      type: asset.type,
      bridge_count: tags.size,
      mode: 'tag',
      neighbor_sample: Array.from(neighbors).slice(0, 5),
    })
  }
  out.sort((x, y) => y.bridge_count - x.bridge_count)
  return out
}
