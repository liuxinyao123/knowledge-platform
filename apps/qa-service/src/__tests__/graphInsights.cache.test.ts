/**
 * graphInsights.cache.test.ts —— 编排器 getInsights 的缓存 / 降级 / 并发行为
 *
 * Mock 下层：loader / louvain / cache IO / advisory lock。
 * 只关注 index.ts 的流程决策。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 固定 config（避免 env 泄露） ────────────────────────────────────────────
vi.mock('../services/graphInsights/config.ts', () => ({
  loadGraphInsightsConfig: () => ({
    enabled: true,
    ttlSec: 1800,
    louvainResolution: 1,
    maxEdges: 100, // 小一点方便触发 GraphTooLargeError
    topSurprises: 10,
    weights: { crossCommunity: 3, crossType: 1.5, edgeLog: 1 },
    topicModel: '',
    isolatedMinAgeDays: 7,
    sparseCohesionThreshold: 0.15,
    sparseMinSize: 3,
  }),
}))

// ── KG bootstrap 假装启用 ───────────────────────────────────────────────────
vi.mock('../services/graphDb.ts', () => ({
  isGraphEnabled: () => true,
  runCypher: vi.fn(async () => []),
}))

// ── loader: 可编程 ─────────────────────────────────────────────────────────
const mockLoadSubgraph = vi.fn()
vi.mock('../services/graphInsights/loader.ts', () => ({
  loadSpaceSubgraph: (...args: unknown[]) => mockLoadSubgraph(...args),
}))

// ── louvain: 可编程（包含抛错路径） ────────────────────────────────────────
const mockDetect = vi.fn()
vi.mock('../services/graphInsights/louvain.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../services/graphInsights/louvain.ts',
  )
  return {
    ...actual,
    detectCommunities: (...args: unknown[]) => mockDetect(...args),
  }
})

// ── cache & advisory lock：用进程内 fake 替代 PG ─────────────────────────────
let fakeCacheStore: Map<number, {
  computed_at: Date
  ttl_sec: number
  graph_signature: string
  payload: unknown
}>
let fakeLockHeld = false

const mockReadCache = vi.fn(async (spaceId: number) => {
  const row = fakeCacheStore.get(spaceId)
  if (!row) return null
  return {
    space_id: spaceId,
    computed_at: row.computed_at,
    ttl_sec: row.ttl_sec,
    graph_signature: row.graph_signature,
    payload: row.payload,
  }
})

const mockWriteCache = vi.fn(async (spaceId: number, payload: unknown, sig: string, ttl: number) => {
  fakeCacheStore.set(spaceId, {
    computed_at: new Date(),
    ttl_sec: ttl,
    graph_signature: sig,
    payload,
  })
})

// isFresh 走真实实现（纯函数）
vi.mock('../services/graphInsights/cache.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../services/graphInsights/cache.ts',
  )
  return {
    ...actual,
    readCache: (spaceId: number) => mockReadCache(spaceId),
    writeCache: (spaceId: number, payload: unknown, sig: string, ttl: number) =>
      mockWriteCache(spaceId, payload, sig, ttl),
  }
})

// pgDb: 给 advisory lock 的 query 假实现
vi.mock('../services/pgDb.ts', () => {
  const mkQuery = vi.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) {
      if (fakeLockHeld) return { rows: [{ got: false }] }
      fakeLockHeld = true
      return { rows: [{ got: true }] }
    }
    if (sql.includes('pg_advisory_unlock')) {
      fakeLockHeld = false
      return { rows: [] }
    }
    return { rows: [] }
  })
  return { getPgPool: () => ({ query: mkQuery }) }
})

// ── 测试体 ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  fakeCacheStore = new Map()
  fakeLockHeld = false
})

const SIMPLE_SUBGRAPH = {
  assets: [
    { id: 1, name: 'a', type: 'pdf', created_at: new Date(Date.now() - 30 * 86400000).toISOString(), indexed_at: null },
    { id: 2, name: 'b', type: 'md', created_at: new Date(Date.now() - 30 * 86400000).toISOString(), indexed_at: null },
  ],
  coCitedEdges: [{ a: 1, b: 2, weight: 1 }],
  tagLinks: [],
  signature: 'a=2,e=1,t=0,m=',
  maxIndexedAt: null,
}

const SIMPLE_LOUVAIN = {
  communities: new Map<number, number>([[1, 0], [2, 1]]),
  sizes: new Map([[0, 1], [1, 1]]),
  orderedIds: [0, 1],
  modularity: 0.1,
}

describe('getInsights', () => {
  it('首次请求：无缓存 → 计算 + 写入缓存', async () => {
    mockLoadSubgraph.mockResolvedValue(SIMPLE_SUBGRAPH)
    mockDetect.mockReturnValue(SIMPLE_LOUVAIN)

    const { getInsights } = await import('../services/graphInsights/index.ts')
    const r = await getInsights(42)
    expect(r.space_id).toBe(42)
    expect(r.degraded).toBe(false)
    expect(r.stats.asset_count).toBe(2)
    expect(mockWriteCache).toHaveBeenCalledTimes(1)
  })

  it('缓存命中（TTL 内 + signature 一致）→ 不重算', async () => {
    mockLoadSubgraph.mockResolvedValue(SIMPLE_SUBGRAPH)
    mockDetect.mockReturnValue(SIMPLE_LOUVAIN)

    const { getInsights } = await import('../services/graphInsights/index.ts')
    await getInsights(42) // 第一次：计算+写
    mockDetect.mockClear()
    mockWriteCache.mockClear()

    const r = await getInsights(42) // 第二次：应命中
    expect(r.space_id).toBe(42)
    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockWriteCache).not.toHaveBeenCalled()
  })

  it('signature 不一致 → 强制重算', async () => {
    mockLoadSubgraph.mockResolvedValue(SIMPLE_SUBGRAPH)
    mockDetect.mockReturnValue(SIMPLE_LOUVAIN)

    const { getInsights } = await import('../services/graphInsights/index.ts')
    await getInsights(42)

    // 把缓存里的 signature 改了模拟图变化
    const cached = fakeCacheStore.get(42)!
    cached.graph_signature = 'stale'
    fakeCacheStore.set(42, cached)

    mockDetect.mockClear()
    await getInsights(42)
    expect(mockDetect).toHaveBeenCalled()
  })

  it('force=true → 忽略 TTL 重算', async () => {
    mockLoadSubgraph.mockResolvedValue(SIMPLE_SUBGRAPH)
    mockDetect.mockReturnValue(SIMPLE_LOUVAIN)

    const { getInsights } = await import('../services/graphInsights/index.ts')
    await getInsights(42)
    mockDetect.mockClear()

    await getInsights(42, { force: true })
    expect(mockDetect).toHaveBeenCalled()
  })

  it('降级：|E| 超限 → degraded=true, surprises/sparse 空', async () => {
    mockLoadSubgraph.mockResolvedValue(SIMPLE_SUBGRAPH)
    const { GraphTooLargeError } = await import('../services/graphInsights/louvain.ts')
    mockDetect.mockImplementation(() => {
      throw new GraphTooLargeError(50_000, 100)
    })

    const { getInsights } = await import('../services/graphInsights/index.ts')
    const r = await getInsights(42)
    expect(r.degraded).toBe(true)
    expect(r.degrade_reason).toBe('graph_too_large')
    expect(r.surprises).toEqual([])
    expect(r.sparse).toEqual([])
  })

  it('降级：Louvain 抛 → degraded=true, bridges 走 HAS_TAG 回退', async () => {
    mockLoadSubgraph.mockResolvedValue({
      ...SIMPLE_SUBGRAPH,
      tagLinks: [
        { asset_id: 1, tag: 't1' },
        { asset_id: 1, tag: 't2' },
        { asset_id: 1, tag: 't3' },
      ],
    })
    const { LouvainFailureError } = await import('../services/graphInsights/louvain.ts')
    mockDetect.mockImplementation(() => {
      throw new LouvainFailureError(new Error('boom'))
    })

    const { getInsights } = await import('../services/graphInsights/index.ts')
    const r = await getInsights(42)
    expect(r.degraded).toBe(true)
    expect(r.degrade_reason).toBe('louvain_exception')
    expect(r.bridges).toHaveLength(1)
    expect(r.bridges[0].mode).toBe('tag')
  })

  it('Space 无资产 → 200 空数组（非降级）', async () => {
    mockLoadSubgraph.mockResolvedValue({
      assets: [],
      coCitedEdges: [],
      tagLinks: [],
      signature: 'a=0,e=0,t=0,m=',
      maxIndexedAt: null,
    })
    mockDetect.mockReturnValue({
      communities: new Map(),
      sizes: new Map(),
      orderedIds: [],
      modularity: 0,
    })

    const { getInsights } = await import('../services/graphInsights/index.ts')
    const r = await getInsights(42)
    expect(r.degraded).toBe(false)
    expect(r.isolated).toEqual([])
    expect(r.stats.asset_count).toBe(0)
  })

  it('KG 不可用 → 抛 KgUnavailableError', async () => {
    vi.resetModules()
    vi.doMock('../services/graphDb.ts', () => ({
      isGraphEnabled: () => false,
      runCypher: vi.fn(async () => []),
    }))
    const { getInsights, KgUnavailableError } = await import('../services/graphInsights/index.ts')
    await expect(getInsights(42)).rejects.toBeInstanceOf(KgUnavailableError)
  })
})
