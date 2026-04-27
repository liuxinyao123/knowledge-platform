/**
 * graphInsights/isolated.ts —— 孤立页面
 *
 * 定义（design.md §4.1）：
 *   degree(CO_CITED ∪ HAS_TAG) ≤ 1
 *   AND created_at < now() - minAgeDays
 *
 * `created_at` 而非 `indexed_at`：避免 BookStack 增量 sync（ADR-31）
 * 因重新 index 老 page 把资产年龄"刷新"掉导致漏报（见 Explore §R7）。
 */
import { isolatedKey } from './keys.ts'
import type { SpaceSubgraph } from './loader.ts'

export interface IsolatedInsight {
  key: string
  asset_id: number
  name: string
  type: string
  degree: number
  created_at: string | null
}

export function computeIsolated(
  subgraph: SpaceSubgraph,
  opts: { minAgeDays: number },
): IsolatedInsight[] {
  const degree = new Map<number, number>()
  for (const a of subgraph.assets) degree.set(a.id, 0)
  for (const e of subgraph.coCitedEdges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1)
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1)
  }
  for (const t of subgraph.tagLinks) {
    degree.set(t.asset_id, (degree.get(t.asset_id) ?? 0) + 1)
  }

  const cutoffMs = Date.now() - opts.minAgeDays * 24 * 60 * 60 * 1000

  const out: IsolatedInsight[] = []
  for (const asset of subgraph.assets) {
    const d = degree.get(asset.id) ?? 0
    if (d > 1) continue
    if (!asset.created_at) continue // 没时间戳的资产保守不报
    const createdMs = Date.parse(asset.created_at)
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue
    out.push({
      key: isolatedKey(asset.id),
      asset_id: asset.id,
      name: asset.name,
      type: asset.type,
      degree: d,
      created_at: asset.created_at,
    })
  }
  // 按度升序（度 0 的先出），再按 created_at 升序（老的先出）
  out.sort((x, y) => {
    if (x.degree !== y.degree) return x.degree - y.degree
    return (x.created_at ?? '').localeCompare(y.created_at ?? '')
  })
  return out
}
