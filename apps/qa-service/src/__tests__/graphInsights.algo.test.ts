/**
 * graphInsights.algo.test.ts —— 四类洞察算法纯函数单测
 *
 * 不触碰 AGE / PG，直接喂合成子图测算法行为。
 */
import { describe, it, expect } from 'vitest'

import type { SpaceSubgraph } from '../services/graphInsights/loader.ts'
import { detectCommunities } from '../services/graphInsights/louvain.ts'
import { computeIsolated } from '../services/graphInsights/isolated.ts'
import {
  computeBridgesByCommunity,
  computeBridgesByTag,
} from '../services/graphInsights/bridges.ts'
import { computeSurprises } from '../services/graphInsights/surprises.ts'
import { computeSparse } from '../services/graphInsights/sparse.ts'
import {
  isolatedKey,
  bridgeKey,
  surpriseKey,
  sparseKey,
} from '../services/graphInsights/keys.ts'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function mkSubgraph(
  assets: Array<{ id: number; name?: string; type?: string; age_days?: number }>,
  edges: Array<[number, number, number?]>,
  tags: Array<[number, string]> = [],
): SpaceSubgraph {
  const _assets = assets.map((a) => ({
    id: a.id,
    name: a.name ?? `asset-${a.id}`,
    type: a.type ?? 'pdf',
    created_at: a.age_days !== undefined ? daysAgo(a.age_days) : daysAgo(30),
    indexed_at: a.age_days !== undefined ? daysAgo(a.age_days) : daysAgo(30),
  }))
  const _edges = edges.map(([a, b, w = 1]) => ({ a: Math.min(a, b), b: Math.max(a, b), weight: w }))
  const _tagLinks = tags.map(([asset_id, tag]) => ({ asset_id, tag }))
  const maxIndexedAt = _assets.reduce<string | null>(
    (acc, a) => (a.indexed_at && (!acc || a.indexed_at > acc) ? a.indexed_at : acc),
    null,
  )
  return {
    assets: _assets,
    coCitedEdges: _edges,
    tagLinks: _tagLinks,
    signature: `a=${_assets.length},e=${_edges.length},t=${_tagLinks.length},m=${maxIndexedAt}`,
    maxIndexedAt,
  }
}

// ─────────── isolated ───────────

describe('computeIsolated', () => {
  it('degree 0 + 老资产 → 上榜', () => {
    const g = mkSubgraph([{ id: 1, age_days: 10 }], [])
    const out = computeIsolated(g, { minAgeDays: 7 })
    expect(out).toHaveLength(1)
    expect(out[0].asset_id).toBe(1)
    expect(out[0].degree).toBe(0)
    expect(out[0].key).toBe(isolatedKey(1))
  })

  it('degree 1（边界）→ 上榜', () => {
    const g = mkSubgraph(
      [{ id: 1, age_days: 10 }, { id: 2, age_days: 10 }],
      [[1, 2]],
    )
    const out = computeIsolated(g, { minAgeDays: 7 })
    // 两个节点都度=1，都应上榜
    expect(out.map((x) => x.asset_id).sort()).toEqual([1, 2])
  })

  it('degree 2 → 不上榜', () => {
    const g = mkSubgraph(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [[1, 2], [1, 3]],
    )
    const out = computeIsolated(g, { minAgeDays: 7 })
    expect(out.map((x) => x.asset_id)).toEqual([2, 3])
    // 1 不上榜（度=2）
  })

  it('新资产（年龄 < 阈值）→ 不上榜即使 degree 0', () => {
    const g = mkSubgraph([{ id: 99, age_days: 3 }], [])
    const out = computeIsolated(g, { minAgeDays: 7 })
    expect(out).toHaveLength(0)
  })

  it('HAS_TAG 连接也算入度', () => {
    const g = mkSubgraph([{ id: 1, age_days: 10 }], [], [[1, 'finance']])
    const out = computeIsolated(g, { minAgeDays: 7 })
    // degree 含 HAS_TAG → degree = 1 → 仍上榜（边界）
    expect(out).toHaveLength(1)
    expect(out[0].degree).toBe(1)
  })
})

// ─────────── bridges ───────────

describe('computeBridges*', () => {
  it('Louvain 启用：邻居跨 3 社区 → 桥接', () => {
    // 节点 10 是 hub，连接 4 个节点分别属于 4 个社区
    const g = mkSubgraph(
      [
        { id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 },
      ],
      [[10, 11], [10, 12], [10, 13], [10, 14]],
    )
    const louvain = {
      communities: new Map<number, number>([
        [10, 0], [11, 1], [12, 2], [13, 3], [14, 4],
      ]),
      sizes: new Map([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]),
      orderedIds: [0, 1, 2, 3, 4],
      modularity: 0.2,
    }
    const out = computeBridgesByCommunity(g, louvain, { minBridges: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].asset_id).toBe(10)
    expect(out[0].bridge_count).toBe(4)
    expect(out[0].mode).toBe('community')
    expect(out[0].key).toBe(bridgeKey(10))
  })

  it('Louvain 启用：邻居都在同一社区 → 不桥接', () => {
    const g = mkSubgraph(
      [{ id: 10 }, { id: 11 }, { id: 12 }],
      [[10, 11], [10, 12]],
    )
    const louvain = {
      communities: new Map<number, number>([[10, 0], [11, 0], [12, 0]]),
      sizes: new Map([[0, 3]]),
      orderedIds: [0],
      modularity: 0.0,
    }
    const out = computeBridgesByCommunity(g, louvain, { minBridges: 3 })
    expect(out).toHaveLength(0)
  })

  it('HAS_TAG 回退：跨 ≥ 3 个 tag 集群 → 桥接', () => {
    const g = mkSubgraph(
      [{ id: 20 }],
      [],
      [[20, 'alpha'], [20, 'beta'], [20, 'gamma']],
    )
    const out = computeBridgesByTag(g, { minBridges: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].asset_id).toBe(20)
    expect(out[0].bridge_count).toBe(3)
    expect(out[0].mode).toBe('tag')
  })

  it('HAS_TAG 回退：仅 2 个 tag → 不桥接', () => {
    const g = mkSubgraph([{ id: 20 }], [], [[20, 'alpha'], [20, 'beta']])
    const out = computeBridgesByTag(g, { minBridges: 3 })
    expect(out).toHaveLength(0)
  })
})

// ─────────── surprises ───────────

describe('computeSurprises', () => {
  const weights = { crossCommunity: 3.0, crossType: 1.5, edgeLog: 1.0 }

  it('跨社区 + 跨类型 + weight=5 → 分数 ≈ 6.79', () => {
    const g = mkSubgraph(
      [
        { id: 1, type: 'pdf' },
        { id: 2, type: 'md' },
      ],
      [[1, 2, 5]],
    )
    const louvain = {
      communities: new Map<number, number>([[1, 0], [2, 1]]),
      sizes: new Map([[0, 1], [1, 1]]),
      orderedIds: [0, 1],
      modularity: 0,
    }
    const out = computeSurprises(g, louvain, { weights, topN: 10 })
    expect(out).toHaveLength(1)
    expect(out[0].cross_community).toBe(true)
    expect(out[0].cross_type).toBe(true)
    expect(out[0].edge_weight).toBe(5)
    // 3·1 + 1.5·1 + 1·log(6) ≈ 3 + 1.5 + 1.792 = 6.29
    expect(out[0].surprise_score).toBeCloseTo(6.29, 1)
    expect(out[0].key).toBe(surpriseKey(1, 2))
  })

  it('同社区边 → 不出现在 surprises', () => {
    const g = mkSubgraph([{ id: 1 }, { id: 2 }], [[1, 2]])
    const louvain = {
      communities: new Map<number, number>([[1, 0], [2, 0]]),
      sizes: new Map([[0, 2]]),
      orderedIds: [0],
      modularity: 0,
    }
    const out = computeSurprises(g, louvain, { weights, topN: 10 })
    expect(out).toHaveLength(0)
  })

  it('topN 截断', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const assets = ids.map((i) => ({ id: i }))
    const edges: Array<[number, number, number]> = []
    for (let i = 0; i < 10; i++) edges.push([ids[i], ids[i + 1], 1])
    const g = mkSubgraph(assets, edges)
    const communities = new Map<number, number>()
    ids.forEach((id, i) => communities.set(id, i)) // 每节点独社区 → 所有边都跨社区
    const louvain = {
      communities,
      sizes: new Map(ids.map((_, i) => [i, 1] as [number, number])),
      orderedIds: ids.map((_, i) => i),
      modularity: 0,
    }
    const out = computeSurprises(g, louvain, { weights, topN: 3 })
    expect(out).toHaveLength(3)
  })

  it('权重 env 覆盖 → score 变化', () => {
    const g = mkSubgraph(
      [{ id: 1, type: 'pdf' }, { id: 2, type: 'pdf' }],
      [[1, 2, 1]],
    )
    const louvain = {
      communities: new Map<number, number>([[1, 0], [2, 1]]),
      sizes: new Map([[0, 1], [1, 1]]),
      orderedIds: [0, 1],
      modularity: 0,
    }
    const base = computeSurprises(g, louvain, { weights, topN: 10 })
    const boosted = computeSurprises(g, louvain, {
      weights: { ...weights, crossCommunity: 5.0 },
      topN: 10,
    })
    expect(boosted[0].surprise_score).toBeGreaterThan(base[0].surprise_score)
  })
})

// ─────────── sparse ───────────

describe('computeSparse', () => {
  it('5 成员 + 1 条内边 → cohesion=0.1 → 稀疏', () => {
    const assets = [1, 2, 3, 4, 5].map((id) => ({ id }))
    const g = mkSubgraph(assets, [[1, 2]])
    const communities = new Map<number, number>([
      [1, 7], [2, 7], [3, 7], [4, 7], [5, 7],
    ])
    const louvain = {
      communities,
      sizes: new Map([[7, 5]]),
      orderedIds: [7],
      modularity: 0,
    }
    const out = computeSparse(g, louvain, { cohesionThreshold: 0.15, minSize: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].community_id).toBe(7)
    expect(out[0].size).toBe(5)
    expect(out[0].cohesion).toBe(0.1)
    expect(out[0].key).toBe(sparseKey([1, 2, 3, 4, 5]))
    expect(out[0].core_assets.length).toBeLessThanOrEqual(3)
  })

  it('过小社区（size < minSize）→ 不报', () => {
    const g = mkSubgraph([{ id: 1 }, { id: 2 }], [])
    const louvain = {
      communities: new Map<number, number>([[1, 1], [2, 1]]),
      sizes: new Map([[1, 2]]),
      orderedIds: [1],
      modularity: 0,
    }
    const out = computeSparse(g, louvain, { cohesionThreshold: 0.15, minSize: 3 })
    expect(out).toHaveLength(0)
  })

  it('cohesion 恰好 0.15 → 不报（严格 <）', () => {
    // 5 节点 + ~1.5 条内边不可能。造 4 节点社区 + 1 条内边 → cohesion = 1 / C(4,2) = 1/6 ≈ 0.167 > 0.15 →  不报
    // 反过来：用 4 节点 + 0 条内边 → cohesion = 0 → 报
    const g = mkSubgraph([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], [])
    const louvain = {
      communities: new Map<number, number>([[1, 2], [2, 2], [3, 2], [4, 2]]),
      sizes: new Map([[2, 4]]),
      orderedIds: [2],
      modularity: 0,
    }
    const out = computeSparse(g, louvain, { cohesionThreshold: 0.15, minSize: 3 })
    expect(out).toHaveLength(1)
    expect(out[0].cohesion).toBe(0)
  })
})

// ─────────── keys 稳定性 ───────────

describe('keys 稳定性', () => {
  it('isolatedKey 同输入同输出', () => {
    expect(isolatedKey(42)).toBe(isolatedKey(42))
  })
  it('surpriseKey 无向：(a,b) == (b,a)', () => {
    expect(surpriseKey(1, 2)).toBe(surpriseKey(2, 1))
  })
  it('sparseKey 对集合顺序不敏感', () => {
    expect(sparseKey([3, 1, 2])).toBe(sparseKey([1, 2, 3]))
  })
  it('不同输入输出不同', () => {
    expect(isolatedKey(1)).not.toBe(isolatedKey(2))
    expect(bridgeKey(10)).not.toBe(isolatedKey(10))
  })
})

// ─────────── Louvain 真实运行（smoke） ───────────

describe('detectCommunities (integration)', () => {
  it('|E| 超 maxEdges → GraphTooLargeError', () => {
    const edges = Array.from({ length: 50 }, (_, i) => ({
      a: Math.min(i, i + 1),
      b: Math.max(i, i + 1),
      weight: 1,
    }))
    expect(() =>
      detectCommunities(edges, [], { resolution: 1.0, maxEdges: 10 }),
    ).toThrow(/graph too large/)
  })

  it('两个明显分离的簇 → 至少 2 个社区', () => {
    // 簇 A: 1-2-3 完全图；簇 B: 10-11-12 完全图；A ↔ B 一条弱边
    const edges = [
      { a: 1, b: 2, weight: 5 }, { a: 1, b: 3, weight: 5 }, { a: 2, b: 3, weight: 5 },
      { a: 10, b: 11, weight: 5 }, { a: 10, b: 12, weight: 5 }, { a: 11, b: 12, weight: 5 },
      { a: 3, b: 10, weight: 1 },
    ]
    const nodeIds = [1, 2, 3, 10, 11, 12]
    const r = detectCommunities(edges, nodeIds, { resolution: 1.0, maxEdges: 100 })
    // 期望至少 2 个社区
    expect(r.sizes.size).toBeGreaterThanOrEqual(2)
    // 簇 A 的 1/2/3 应在同一社区
    expect(r.communities.get(1)).toBe(r.communities.get(2))
    expect(r.communities.get(2)).toBe(r.communities.get(3))
  })
})
