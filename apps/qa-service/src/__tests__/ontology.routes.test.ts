/**
 * routes/ontology.ts 三条新端点的集成测：/path 和 /match。
 *  /context 已有现成测试，不重复。
 *
 * /path：mock graphDb.runCypher 模拟 BFS；mock pgPool 模拟 fetchAssetNames
 * /match：mock pgPool 给一组 tags，验证打分排序
 *
 * 不依赖真实 AGE / PG。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── mocks 必须在 import target 之前 ───────────────────────────────

vi.mock('../auth/requireAuth.ts', () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.principal = { id: 1, email: 'admin@dsclaw.local', roles: ['admin'] }
    next()
  },
}))

const mockRunCypher = vi.fn()
const mockIsGraphEnabled = vi.fn(() => true)
vi.mock('../services/graphDb.ts', () => ({
  runCypher: (...args: unknown[]) => mockRunCypher(...args),
  isGraphEnabled: () => mockIsGraphEnabled(),
}))

const mockPgQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockPgQuery }),
}))

vi.mock('../services/ontologyContext.ts', () => ({
  expandOntologyContext: vi.fn(),
}))

import { ontologyRouter } from '../routes/ontology.ts'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/ontology', ontologyRouter)
  return app
}

describe('POST /api/ontology/path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsGraphEnabled.mockReturnValue(true)
  })

  it('400 when fromId missing', async () => {
    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ toId: '5' })
    expect(res.status).toBe(400)
  })

  it('503 when KG disabled', async () => {
    mockIsGraphEnabled.mockReturnValue(false)
    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ fromId: '1', toId: '2' })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'ontology_unavailable', paths: [] })
  })

  it('returns empty paths when no neighbors found', async () => {
    mockRunCypher.mockResolvedValue([])
    mockPgQuery.mockResolvedValue({ rows: [] })
    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ fromId: '1', toId: '99', maxDepth: 2 })
    expect(res.status).toBe(200)
    expect(res.body.paths).toEqual([])
  })

  it('returns 1-hop path when from→to direct edge', async () => {
    // 第一次 BFS 调用：fromId=1，邻居含 toId=2
    mockRunCypher.mockResolvedValueOnce([
      { id: '"2"', kind: '"CITED"' },
    ])
    // fetchAssetNames 调用：返回 1 和 2 的 name
    mockPgQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'doc-A' },
        { id: 2, name: 'doc-B' },
      ],
    })

    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ fromId: '1', toId: '2', maxDepth: 4 })

    expect(res.status).toBe(200)
    expect(res.body.paths).toHaveLength(1)
    expect(res.body.paths[0].length).toBe(1)
    expect(res.body.paths[0].nodes.map((n: any) => n.id)).toEqual(['1', '2'])
    expect(res.body.paths[0].edges[0]).toMatchObject({ from: '1', to: '2', kind: 'CITED' })
  })

  it('clamps maxDepth into [1,8]', async () => {
    mockRunCypher.mockResolvedValue([])
    mockPgQuery.mockResolvedValue({ rows: [] })
    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ fromId: '1', toId: '999', maxDepth: 99 })
    expect(res.status).toBe(200)
    // 不会因 maxDepth 越界导致 500
  })

  it('returns single-node path when fromId === toId', async () => {
    mockPgQuery.mockResolvedValue({ rows: [{ id: 7, name: 'x' }] })
    const res = await request(buildApp())
      .post('/api/ontology/path')
      .send({ fromId: '7', toId: '7' })
    expect(res.status).toBe(200)
    expect(res.body.paths).toHaveLength(1)
    expect(res.body.paths[0].length).toBe(0)
    expect(res.body.paths[0].nodes).toHaveLength(1)
  })
})

describe('POST /api/ontology/match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400 when text empty', async () => {
    const res = await request(buildApp())
      .post('/api/ontology/match')
      .send({ topK: 5 })
    expect(res.status).toBe(400)
  })

  it('returns top-K tags ranked by score', async () => {
    mockPgQuery.mockResolvedValueOnce({
      rows: [
        { name: '知识图谱' },
        { name: '语义网络' },
        { name: '权限管理' },
        { name: '图谱' },
      ],
    })
    const res = await request(buildApp())
      .post('/api/ontology/match')
      .send({ text: '图谱', topK: 3 })

    expect(res.status).toBe(200)
    const names = res.body.tags.map((t: any) => t.name)
    expect(names).toContain('图谱')      // 完全匹配
    expect(names).toContain('知识图谱')  // 包含查询
    expect(res.body.tags).toHaveLength(3)
    // 第一名应是完全匹配 "图谱"
    expect(res.body.tags[0].name).toBe('图谱')
    expect(res.body.tags[0].score).toBe(1)
  })

  it('filters out zero-score tags', async () => {
    mockPgQuery.mockResolvedValueOnce({
      rows: [{ name: '完全无关' }, { name: '与query无关' }],
    })
    const res = await request(buildApp())
      .post('/api/ontology/match')
      .send({ text: '图谱' })
    expect(res.status).toBe(200)
    expect(res.body.tags).toEqual([])
  })

  it('clamps topK', async () => {
    mockPgQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(buildApp())
      .post('/api/ontology/match')
      .send({ text: 'foo', topK: 999 })
    expect(res.status).toBe(200)
  })

  it('returns id with tag: prefix', async () => {
    mockPgQuery.mockResolvedValueOnce({ rows: [{ name: '审计' }] })
    const res = await request(buildApp())
      .post('/api/ontology/match')
      .send({ text: '审计' })
    expect(res.body.tags[0].id).toBe('tag:审计')
  })
})
