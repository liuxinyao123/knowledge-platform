/**
 * graphInsights/sparse.ts —— 稀疏社区
 *
 * 定义（design.md §4.4）：
 *   |C| ≥ minSize AND cohesion = |edges_in_C| / C(|C|, 2) < cohesionThreshold
 *
 * 输出：每个稀疏社区带 core_assets（社区内度最高的 3 个成员）
 */
import { sparseKey } from './keys.ts'
import type { LouvainResult } from './louvain.ts'
import type { SpaceSubgraph } from './loader.ts'

export interface SparseCore {
  id: number
  name: string
  degree: number
}

export interface SparseInsight {
  key: string
  community_id: number
  size: number
  /** 0..1；保留 3 位小数 */
  cohesion: number
  core_assets: SparseCore[]
}

export function computeSparse(
  subgraph: SpaceSubgraph,
  louvain: LouvainResult,
  opts: { cohesionThreshold: number; minSize: number },
): SparseInsight[] {
  // 按社区聚合成员 + 度
  const membersByCommunity = new Map<number, Set<number>>()
  for (const [assetId, cid] of louvain.communities) {
    if (!membersByCommunity.has(cid)) membersByCommunity.set(cid, new Set())
    membersByCommunity.get(cid)!.add(assetId)
  }

  const degreeInCommunity = new Map<number, Map<number, number>>()
  const edgesInCommunity = new Map<number, number>()

  for (const e of subgraph.coCitedEdges) {
    const cA = louvain.communities.get(e.a)
    const cB = louvain.communities.get(e.b)
    if (cA == null || cB == null) continue
    if (cA !== cB) continue
    const cid = cA
    edgesInCommunity.set(cid, (edgesInCommunity.get(cid) ?? 0) + 1)
    if (!degreeInCommunity.has(cid)) degreeInCommunity.set(cid, new Map())
    const degMap = degreeInCommunity.get(cid)!
    degMap.set(e.a, (degMap.get(e.a) ?? 0) + 1)
    degMap.set(e.b, (degMap.get(e.b) ?? 0) + 1)
  }

  const assetById = new Map(subgraph.assets.map((a) => [a.id, a]))
  const out: SparseInsight[] = []

  for (const [cid, members] of membersByCommunity) {
    const size = members.size
    if (size < opts.minSize) continue
    const possible = (size * (size - 1)) / 2
    if (possible <= 0) continue
    const actual = edgesInCommunity.get(cid) ?? 0
    const cohesion = actual / possible
    if (cohesion >= opts.cohesionThreshold) continue

    const degMap = degreeInCommunity.get(cid) ?? new Map<number, number>()
    const coreRanked = Array.from(members)
      .map((id) => ({ id, deg: degMap.get(id) ?? 0 }))
      .sort((x, y) => y.deg - x.deg)
      .slice(0, 3)

    const core_assets: SparseCore[] = coreRanked
      .map((c) => {
        const a = assetById.get(c.id)
        if (!a) return null
        return { id: c.id, name: a.name, degree: c.deg }
      })
      .filter((x): x is SparseCore => x !== null)

    out.push({
      key: sparseKey(Array.from(members)),
      community_id: cid,
      size,
      cohesion: Math.round(cohesion * 1000) / 1000,
      core_assets,
    })
  }

  // 内聚度升序（最差的先出）
  out.sort((x, y) => x.cohesion - y.cohesion)
  return out
}
