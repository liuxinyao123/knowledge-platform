/**
 * graphInsights/louvain.ts —— 用 graphology-communities-louvain 对 CO_CITED 子图做社区检测
 *
 * 约束（D-002）：仅 CO_CITED 边参与；HAS_TAG 不进图。
 * 降级（D-007）：
 *   - |E| > maxEdges → throw GraphTooLargeError（路由层捕获、降级）
 *   - graphology 内部抛 → throw LouvainFailureError
 *
 * 节点键：使用字符串形式（graphology 内部即用字符串存储，避免类型漂移）。
 */
// graphology + graphology-communities-louvain 都以 CJS bundle 形式发布
// （`module.exports = X`，无 `.default` 属性），但 .d.ts 声明 `export default X`。
// NodeNext + esModuleInterop 下默认导入会报 "no construct signatures"。
// 与 `services/fileSource/scheduler.ts` / `routes/fileSource.ts` 同模式：
// 用 createRequire 显式 require，绕过 ESM/CJS interop 难点。
import { createRequire } from 'node:module'

import type { SubgraphEdge } from './loader.ts'

const _require = createRequire(import.meta.url)

interface GraphInstance {
  hasNode(key: string): boolean
  addNode(key: string): void
  hasEdge(a: string, b: string): boolean
  addEdge(a: string, b: string, attrs?: Record<string, unknown>): void
}
interface GraphCtor {
  new (opts?: { type?: string; multi?: boolean }): GraphInstance
}
interface LouvainModule {
  detailed(
    g: GraphInstance,
    opts: { resolution?: number; getEdgeWeight?: string },
  ): { communities: Record<string, number>; modularity?: number }
}

const Graph = _require('graphology') as GraphCtor
const louvain = _require('graphology-communities-louvain') as LouvainModule

export class GraphTooLargeError extends Error {
  readonly edgeCount: number
  readonly limit: number
  constructor(edgeCount: number, limit: number) {
    super(`graph too large: |E|=${edgeCount} > limit=${limit}`)
    this.name = 'GraphTooLargeError'
    this.edgeCount = edgeCount
    this.limit = limit
  }
}

export class LouvainFailureError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super(`louvain failed: ${(cause as Error)?.message ?? String(cause)}`)
    this.name = 'LouvainFailureError'
    this.cause = cause
  }
}

export interface LouvainResult {
  /** Map<assetId, communityId> —— 不在任何 CO_CITED 边上的孤立节点不出现 */
  communities: Map<number, number>
  /** Map<communityId, memberCount> */
  sizes: Map<number, number>
  /** 按 size 降序的社区 id 列表，供确定性迭代 */
  orderedIds: number[]
  /** Louvain 最终 modularity */
  modularity: number
}

export function detectCommunities(
  edges: SubgraphEdge[],
  nodeIds: number[],
  opts: { resolution: number; maxEdges: number },
): LouvainResult {
  if (edges.length > opts.maxEdges) {
    throw new GraphTooLargeError(edges.length, opts.maxEdges)
  }

  const g = new Graph({ type: 'undirected', multi: false })
  for (const id of nodeIds) {
    const key = String(id)
    if (!g.hasNode(key)) g.addNode(key)
  }
  for (const e of edges) {
    const aKey = String(e.a)
    const bKey = String(e.b)
    if (!g.hasNode(aKey)) g.addNode(aKey)
    if (!g.hasNode(bKey)) g.addNode(bKey)
    if (!g.hasEdge(aKey, bKey)) {
      g.addEdge(aKey, bKey, { weight: Math.max(1, e.weight) })
    }
  }

  try {
    const detail = louvain.detailed(g, {
      resolution: opts.resolution,
      getEdgeWeight: 'weight',
    })
    const raw = detail.communities as Record<string, number>
    const communities = new Map<number, number>()
    for (const k of Object.keys(raw)) {
      const assetId = Number(k)
      if (!Number.isFinite(assetId)) continue
      communities.set(assetId, raw[k])
    }
    const sizes = new Map<number, number>()
    for (const c of communities.values()) {
      sizes.set(c, (sizes.get(c) ?? 0) + 1)
    }
    const orderedIds = Array.from(sizes.entries())
      .sort((x, y) => y[1] - x[1])
      .map(([cid]) => cid)
    return {
      communities,
      sizes,
      orderedIds,
      modularity: typeof detail.modularity === 'number' ? detail.modularity : 0,
    }
  } catch (err) {
    throw new LouvainFailureError(err)
  }
}
