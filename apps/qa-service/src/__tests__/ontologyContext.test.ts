/**
 * ontologyContext.test.ts —— 覆盖 8 个 Scenario
 *
 * Spec: openspec/changes/ontology-oag-retrieval/specs/ontology-context-spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expandOntologyContext, type OntologyContext } from '../services/ontologyContext.ts'
import type { Principal } from '../auth/types.ts'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRunCypher = vi.fn()
const mockIsGraphEnabled = vi.fn().mockReturnValue(true)
const mockEvaluateAcl = vi.fn()

vi.mock('../services/graphDb.ts', () => ({
  runCypher: (...args: unknown[]) => mockRunCypher(...args),
  isGraphEnabled: () => mockIsGraphEnabled(),
  getGraphPool: vi.fn(),
  bootstrapGraph: vi.fn(),
}))

vi.mock('../auth/evaluateAcl.ts', () => ({
  evaluateAcl: (...args: unknown[]) => mockEvaluateAcl(...args),
}))

const devPrincipal: Principal = {
  user_id: 1,
  email: 'test@local',
  roles: ['admin'],
  permissions: [],
  team_ids: [],
  team_names: [],
}

function mockAllow(assetId: string) {
  mockEvaluateAcl.mockImplementation(async (_p, _a, r) => {
    if (typeof r === 'object' && r !== null && 'asset_id' in r) {
      return { allow: r.asset_id === assetId, reason: '' }
    }
    return { allow: false, reason: '' }
  })
}

function mockDeny() {
  mockEvaluateAcl.mockResolvedValue({ allow: false, reason: 'denied' })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('expandOntologyContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsGraphEnabled.mockReturnValue(true)
    mockRunCypher.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Scenario 1: 空 chunks 直接返回空 context
  it('Scenario 1: empty chunks returns empty context', async () => {
    const context = await expandOntologyContext({
      chunks: [],
      principal: devPrincipal,
      maxHop: 2,
    })

    expect(context.entities).toEqual([])
    expect(context.edges).toEqual([])
    expect(context.meta.hop_depth).toBe(2)
    expect(context.meta.source_chunks).toBe(0)
    expect(context.meta.fallback).toBe(false)
    expect(mockRunCypher).not.toHaveBeenCalled()
  })

  // Scenario 2: AGE 未启用返回空并标记 fallback=false
  it('Scenario 2: KG disabled returns empty with fallback=false', async () => {
    mockIsGraphEnabled.mockReturnValue(false)

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 1,
    })

    expect(context.entities).toEqual([])
    expect(context.edges).toEqual([])
    expect(context.meta.fallback).toBe(false)
  })

  // Scenario 3: Principal 过滤掉所有可见 asset
  it('Scenario 3: principal filters all assets returns fallback=true', async () => {
    mockDeny()

    const context = await expandOntologyContext({
      chunks: [
        { asset_id: 'a1', score: 0.9 },
        { asset_id: 'a2', score: 0.8 },
      ],
      principal: devPrincipal,
      maxHop: 1,
    })

    expect(context.entities).toEqual([])
    expect(context.edges).toEqual([])
    expect(context.meta.fallback).toBe(true)
  })

  // Scenario 4: hop=1 返回 Asset 自身 + Source + Tag 邻居
  it('Scenario 4: hop=1 returns Asset + Source + Tag neighbors', async () => {
    mockEvaluateAcl.mockResolvedValue({ allow: true, reason: '' })
    mockRunCypher.mockResolvedValue([
      {
        aid: 'a1',
        aname: 'Asset 1',
        a: null,
        xid: 's1',
        xkind: 'Source',
        xname: 'Source 1',
        x: null,
        r: { type: 'CONTAINS' },
      },
      {
        aid: 'a1',
        aname: 'Asset 1',
        a: null,
        xid: 't1',
        xkind: 'Tag',
        xname: 'Tag 1',
        x: null,
        r: { type: 'HAS_TAG' },
      },
    ])

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 1,
    })

    expect(context.entities).toHaveLength(3)
    const kinds = context.entities.map((e) => e.kind).sort()
    expect(kinds).toEqual(['Asset', 'Source', 'Tag'])

    const asset = context.entities.find((e) => e.kind === 'Asset')
    expect(asset?.distance).toBe(0)
    expect(asset?.id).toBe('a1')

    const source = context.entities.find((e) => e.kind === 'Source')
    expect(source?.distance).toBe(1)

    expect(context.edges).toHaveLength(2)
  })

  // Scenario 5: hop=2 追加 Space 与同标签 Asset
  it('Scenario 5: hop=2 adds Space and co-tagged Assets', async () => {
    mockEvaluateAcl.mockResolvedValue({ allow: true, reason: '' })
    mockRunCypher
      .mockResolvedValueOnce([
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 's1',
          xkind: 'Source',
          xname: 'Source 1',
          x: null,
          r: { type: 'CONTAINS' },
        },
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 't1',
          xkind: 'Tag',
          xname: 'Tag 1',
          x: null,
          r: { type: 'HAS_TAG' },
        },
      ])
      .mockResolvedValueOnce([
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 's1',
          xkind: 'Source',
          xname: 'Source 1',
          x: null,
          yid: 'sp1',
          ykind: 'Space',
          yname: 'Space 1',
          y: null,
          r: { type: 'CONTAINS' },
          r2: { type: 'SCOPES' },
        },
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 't1',
          xkind: 'Tag',
          xname: 'Tag 1',
          x: null,
          yid: 'a2',
          ykind: 'Asset',
          yname: 'Asset 2',
          y: null,
          r: { type: 'HAS_TAG' },
          r2: { type: 'HAS_TAG' },
        },
      ])

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 2,
    })

    expect(context.entities.length).toBeGreaterThan(3)
    expect(context.entities.some((e) => e.kind === 'Space')).toBe(true)
    expect(context.entities.some((e) => e.kind === 'Asset' && e.id === 'a2')).toBe(true)

    const a2 = context.entities.find((e) => e.id === 'a2')
    expect(a2?.distance).toBe(2)
  })

  // Scenario 6: 二次 ACL 剪枝（hop=2 结果里的 Asset 不可见）
  it('Scenario 6: hop=2 ACL filter removes unauthorized Assets', async () => {
    mockEvaluateAcl.mockImplementation(async (_p, _a, r) => {
      if (typeof r === 'object' && r !== null && 'asset_id' in r) {
        // a1 visible, a3 not
        return { allow: r.asset_id === 'a1', reason: '' }
      }
      return { allow: false, reason: '' }
    })

    mockRunCypher
      .mockResolvedValueOnce([
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 's1',
          xkind: 'Source',
          xname: 'Source 1',
          x: null,
          r: { type: 'CONTAINS' },
        },
      ])
      .mockResolvedValueOnce([
        {
          aid: 'a1',
          aname: 'Asset 1',
          a: null,
          xid: 't1',
          xkind: 'Tag',
          xname: 'Tag 1',
          x: null,
          yid: 'a3',
          ykind: 'Asset',
          yname: 'Asset 3',
          y: null,
          r: { type: 'HAS_TAG' },
          r2: { type: 'HAS_TAG' },
        },
      ])

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 2,
    })

    const a3 = context.entities.find((e) => e.id === 'a3')
    expect(a3).toBeUndefined()

    const edgesToA3 = context.edges.filter((e) => e.to === 'a3' || e.from === 'a3')
    expect(edgesToA3).toEqual([])
  })

  // Scenario 7: 超时触发 fallback
  it('Scenario 7: timeout triggers fallback', async () => {
    mockEvaluateAcl.mockResolvedValue({ allow: true, reason: '' })
    mockRunCypher.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([]), 500)
        }),
    )

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 1,
      timeoutMs: 50,
    })

    expect(context.meta.fallback).toBe(true)
    expect(context.meta.latency_ms).toBeLessThan(200)
  })

  // Scenario 8: Attrs 白名单（敏感字段不应出现）
  it('Scenario 8: attribute whitelist filters sensitive fields', async () => {
    mockEvaluateAcl.mockResolvedValue({ allow: true, reason: '' })
    mockRunCypher.mockResolvedValue([
      {
        aid: 'a1',
        aname: 'Asset 1',
        a: {
          status: 'active',
          source_id: 'src1',
          mime: 'text/plain',
          updated_at: '2026-01-01',
          summary_text: 'summary',
          raw_path: '/secret/path.pdf', // Should be filtered
          embeddings: [1, 2, 3], // Should be filtered
        },
        xid: 's1',
        xkind: 'Source',
        xname: 'Source 1',
        x: {
          name: 'Source 1',
          kind: 'file',
          offline: false,
        },
        r: { type: 'CONTAINS' },
      },
    ])

    const context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 1,
    })

    const asset = context.entities.find((e) => e.kind === 'Asset')
    expect(asset?.attrs).toBeDefined()
    expect(asset?.attrs?.raw_path).toBeUndefined()
    expect(asset?.attrs?.embeddings).toBeUndefined()
    expect(asset?.attrs?.status).toBe('active')

    const source = context.entities.find((e) => e.kind === 'Source')
    expect(source?.attrs?.name).toBe('Source 1')
  })

  // Scenario 9: maxHop 非法值 clamp
  it('Scenario 9: illegal maxHop values clamp to [1,2]', async () => {
    mockEvaluateAcl.mockResolvedValue({ allow: true, reason: '' })
    mockRunCypher.mockResolvedValue([])

    // maxHop=5 → clamps to 2
    let context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 5 as any,
    })
    expect(context.meta.hop_depth).toBe(2)

    // maxHop=0 → clamps to 1
    context = await expandOntologyContext({
      chunks: [{ asset_id: 'a1', score: 0.9 }],
      principal: devPrincipal,
      maxHop: 0 as any,
    })
    expect(context.meta.hop_depth).toBe(1)
  })
})
