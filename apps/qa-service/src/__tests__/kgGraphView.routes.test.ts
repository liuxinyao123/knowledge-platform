/**
 * kgGraphView.routes.test.ts —— GET /api/kg/graph 路由
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

let _aclAllow = true
let _kgEnabled = true

vi.mock('../auth/requireAuth.ts', () => ({
  requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    ;(req as unknown as { principal: unknown }).principal = {
      user_id: 1,
      email: 'u@x',
      roles: ['admin'],
      permissions: [],
      team_ids: [],
    }
    next()
  },
}))

vi.mock('../auth/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/index.ts')
  return {
    ...actual,
    requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      ;(req as unknown as { principal: unknown }).principal = {
        user_id: 1,
        email: 'u@x',
        roles: ['admin'],
        permissions: [],
        team_ids: [],
      }
      next()
    },
  }
})

vi.mock('../auth/enforceAcl.ts', () => ({
  enforceAcl: () => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (_aclAllow) return next()
    return res.status(403).json({ error: 'forbidden' })
  },
}))

vi.mock('../services/graphDb.ts', () => ({
  isGraphEnabled: () => _kgEnabled,
  runCypher: vi.fn(async () => []),
}))

const mockLoad = vi.fn()
vi.mock('../services/kgGraphView/loader.ts', () => ({
  loadSpaceGraphForViz: mockLoad,
}))

vi.mock('../services/kgGraphView/config.ts', () => ({
  loadKgGraphViewLimits: () => ({ maxNodes: 800, maxEdges: 3000 }),
}))

// knowledgeGraph.ts 也被 routes/kg.ts 引用
vi.mock('../services/knowledgeGraph.ts', () => ({
  getAssetNeighborhood: vi.fn(async () => ({ nodes: [], edges: [] })),
}))

async function makeApp(): Promise<express.Express> {
  const { kgRouter } = await import('../routes/kg.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/kg', kgRouter)
  return app
}

const SAMPLE = {
  space_id: 12,
  generated_at: '2026-04-25T13:00:00Z',
  empty: false,
  truncated: false,
  stats: { node_count: 3, edge_count: 2 },
  nodes: [
    { id: 'asset:1', label: 'a.pdf', type: 'pdf', degree: 1 },
    { id: 'asset:2', label: 'b.md', type: 'md', degree: 1 },
    { id: 'tag:t', label: 't', type: '_tag', degree: 1 },
  ],
  edges: [
    { source: 'asset:1', target: 'asset:2', kind: 'CO_CITED', weight: 3 },
    { source: 'asset:1', target: 'tag:t', kind: 'HAS_TAG' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  _aclAllow = true
  _kgEnabled = true
})

describe('GET /api/kg/graph', () => {
  it('happy path 200 + payload', async () => {
    mockLoad.mockResolvedValue(SAMPLE)
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph?spaceId=12')
    expect(res.status).toBe(200)
    expect(res.body.space_id).toBe(12)
    expect(res.body.nodes).toHaveLength(3)
    expect(mockLoad).toHaveBeenCalledWith(12, { maxNodes: 800, maxEdges: 3000 })
  })

  it('缺 spaceId → 400', async () => {
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('SPACE_ID_REQUIRED')
  })

  it('spaceId 非整数 → 400', async () => {
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph?spaceId=abc')
    expect(res.status).toBe(400)
  })

  it('越权 → 403', async () => {
    _aclAllow = false
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph?spaceId=12')
    expect(res.status).toBe(403)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('AGE 未启用 → 503', async () => {
    _kgEnabled = false
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph?spaceId=12')
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('KG_UNAVAILABLE')
  })

  it('老 Space → 200 + empty:true', async () => {
    mockLoad.mockResolvedValue({
      space_id: 99,
      generated_at: '2026-04-25T13:00:00Z',
      empty: true,
      hint: 'space_not_in_graph',
      truncated: false,
      stats: { node_count: 0, edge_count: 0 },
      nodes: [],
      edges: [],
    })
    const app = await makeApp()
    const res = await request(app).get('/api/kg/graph?spaceId=99')
    expect(res.status).toBe(200)
    expect(res.body.empty).toBe(true)
    expect(res.body.hint).toBe('space_not_in_graph')
  })
})
