/**
 * graphInsights.routes.test.ts —— HTTP 路由契约
 *
 * mock 下面三类：
 *   1. auth middleware（直注 principal）
 *   2. graphInsights 编排器（只关心路由的输入/输出）
 *   3. dismissed 仓储
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── mocks ────────────────────────────────────────────────────────────────────

let _principalEmail = 'u@x'
let _principalRoles: string[] = ['admin']
let _aclAllow = true

vi.mock('../auth/requireAuth.ts', () => ({
  requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    ;(req as unknown as { principal: unknown }).principal = {
      user_id: 1,
      email: _principalEmail,
      roles: _principalRoles,
      permissions: [],
      team_ids: [],
    }
    next()
  },
}))

vi.mock('../auth/enforceAcl.ts', () => ({
  enforceAcl: () => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (_aclAllow) return next()
    return res.status(403).json({ error: 'forbidden' })
  },
}))

const mockGetInsights = vi.fn()
const mockFindInsightByKey = vi.fn()
vi.mock('../services/graphInsights/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../services/graphInsights/index.ts',
  )
  return {
    ...actual,
    getInsights: mockGetInsights,
    findInsightByKey: mockFindInsightByKey,
  }
})

const mockListDismissed = vi.fn(async () => new Set<string>())
const mockAddDismissed = vi.fn(async () => undefined)
const mockRemoveDismissed = vi.fn(async () => undefined)
vi.mock('../services/graphInsights/dismissed.ts', () => ({
  listDismissed: mockListDismissed,
  addDismissed: mockAddDismissed,
  removeDismissed: mockRemoveDismissed,
}))

const mockGenerateTopic = vi.fn()
vi.mock('../services/graphInsights/deepResearchPrompt.ts', () => ({
  generateDeepResearchTopic: mockGenerateTopic,
}))

vi.mock('../services/graphInsights/config.ts', () => ({
  loadGraphInsightsConfig: () => ({
    enabled: true,
    ttlSec: 1800,
    louvainResolution: 1,
    maxEdges: 10000,
    topSurprises: 10,
    weights: { crossCommunity: 3, crossType: 1.5, edgeLog: 1 },
    topicModel: '',
    isolatedMinAgeDays: 7,
    sparseCohesionThreshold: 0.15,
    sparseMinSize: 3,
  }),
}))

// ── helper: build app ────────────────────────────────────────────────────────

async function makeApp(): Promise<express.Express> {
  const { insightsRouter } = await import('../routes/insights.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/insights', insightsRouter)
  return app
}

const SAMPLE_PAYLOAD = {
  space_id: 42,
  generated_at: '2026-04-24T13:00:00Z',
  computed_at: '2026-04-24T13:00:00Z',
  degraded: false,
  degrade_reason: null,
  stats: { asset_count: 10, edge_count: 20, community_count: 2 },
  isolated: [
    {
      key: 'abc123',
      asset_id: 1,
      name: 'iso.pdf',
      type: 'pdf',
      degree: 0,
      created_at: '2026-04-01T00:00:00Z',
    },
  ],
  bridges: [],
  surprises: [],
  sparse: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  _principalEmail = 'u@x'
  _principalRoles = ['admin']
  _aclAllow = true
  mockListDismissed.mockResolvedValue(new Set())
})

// ── tests ────────────────────────────────────────────────────────────────────

describe('GET /api/insights', () => {
  it('happy path 返回 payload shape', async () => {
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    const app = await makeApp()
    const res = await request(app).get('/api/insights?spaceId=42')
    expect(res.status).toBe(200)
    expect(res.body.space_id).toBe(42)
    expect(res.body.isolated).toHaveLength(1)
    expect(res.body.degraded).toBe(false)
    expect(mockGetInsights).toHaveBeenCalledWith(42)
  })

  it('缺 spaceId → 400', async () => {
    const app = await makeApp()
    const res = await request(app).get('/api/insights')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('SPACE_ID_REQUIRED')
  })

  it('越权 → 403', async () => {
    _aclAllow = false
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    const app = await makeApp()
    const res = await request(app).get('/api/insights?spaceId=42')
    expect(res.status).toBe(403)
    expect(mockGetInsights).not.toHaveBeenCalled()
  })

  it('dismissed payload 过滤', async () => {
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    mockListDismissed.mockResolvedValue(new Set(['abc123']))
    const app = await makeApp()
    const res = await request(app).get('/api/insights?spaceId=42')
    expect(res.status).toBe(200)
    expect(res.body.isolated).toHaveLength(0)
  })
})

describe('POST /api/insights/dismiss', () => {
  it('204 + 调 addDismissed', async () => {
    const app = await makeApp()
    const res = await request(app)
      .post('/api/insights/dismiss')
      .send({ spaceId: 42, insight_key: 'abc123' })
    expect(res.status).toBe(204)
    expect(mockAddDismissed).toHaveBeenCalledWith('u@x', 42, 'abc123')
  })

  it('缺 insight_key → 400', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/insights/dismiss').send({ spaceId: 42 })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INSIGHT_KEY_REQUIRED')
  })
})

describe('DELETE /api/insights/dismiss', () => {
  it('204 + 调 removeDismissed', async () => {
    const app = await makeApp()
    const res = await request(app)
      .delete('/api/insights/dismiss')
      .send({ spaceId: 42, insight_key: 'abc123' })
    expect(res.status).toBe(204)
    expect(mockRemoveDismissed).toHaveBeenCalledWith('u@x', 42, 'abc123')
  })
})

describe('POST /api/insights/refresh', () => {
  it('force=true 传给 getInsights', async () => {
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    const app = await makeApp()
    const res = await request(app).post('/api/insights/refresh').send({ spaceId: 42 })
    expect(res.status).toBe(200)
    expect(mockGetInsights).toHaveBeenCalledWith(42, { force: true })
  })
})

describe('POST /api/insights/topic', () => {
  it('insight_key 存在 → 调 generateTopic', async () => {
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    mockFindInsightByKey.mockReturnValue({ kind: 'isolated', data: SAMPLE_PAYLOAD.isolated[0] })
    mockGenerateTopic.mockResolvedValue({
      topic: '扩展 iso.pdf 的关联知识',
      query_hint: '',
      seed_asset_ids: [1],
    })
    const app = await makeApp()
    const res = await request(app).post('/api/insights/topic').send({ spaceId: 42, insight_key: 'abc123' })
    expect(res.status).toBe(200)
    expect(res.body.topic).toContain('iso.pdf')
    expect(res.body.kind).toBe('isolated')
  })

  it('insight_key 不存在 → 404', async () => {
    mockGetInsights.mockResolvedValue(SAMPLE_PAYLOAD)
    mockFindInsightByKey.mockReturnValue(null)
    const app = await makeApp()
    const res = await request(app).post('/api/insights/topic').send({ spaceId: 42, insight_key: 'notfound' })
    expect(res.status).toBe(404)
  })
})
