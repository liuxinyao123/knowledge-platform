/**
 * routes/qa.ts 的新端点 /retrieve（ontology.query_chunks 后端）
 *
 * 不打 LLM/embedding/真实 PG，全 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../auth/requireAuth.ts', () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.principal = { id: 1, email: 'admin@dsclaw.local', roles: ['admin'] }
    next()
  },
}))

const mockSearchKnowledgeChunks = vi.fn()
class MockEmbeddingNotConfiguredError extends Error {
  constructor() {
    super('embedding not configured')
    this.name = 'EmbeddingNotConfiguredError'
  }
}
vi.mock('../services/knowledgeSearch.ts', () => ({
  searchKnowledgeChunks: (...args: unknown[]) => mockSearchKnowledgeChunks(...args),
  EmbeddingNotConfiguredError: MockEmbeddingNotConfiguredError,
}))

const mockPgQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockPgQuery }),
}))

vi.mock('../auth/index.ts', () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.principal = { id: 1, email: 'a@a', roles: ['admin'] }
    next()
  },
  enforceAcl: () => (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../agent/dispatchHandler.ts', () => ({
  dispatchHandler: (_req: any, res: any) => res.json({ ok: true }),
}))

import { qaRouter } from '../routes/qa.ts'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/qa', qaRouter)
  return app
}

describe('POST /api/qa/retrieve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400 when query missing', async () => {
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ topK: 5 })
    expect(res.status).toBe(400)
  })

  it('400 when query empty string', async () => {
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns chunks shaped per skill yaml contract', async () => {
    mockSearchKnowledgeChunks.mockResolvedValueOnce([
      { asset_id: 7, asset_name: 'A', chunk_content: 'this is the chunk content xxx', score: 0.92, metadata: null },
      { asset_id: 9, asset_name: 'B', chunk_content: 'another chunk', score: 0.81, metadata: null },
    ])
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: '知识图谱', topK: 5 })

    expect(res.status).toBe(200)
    expect(res.body.chunks).toHaveLength(2)
    expect(res.body.chunks[0]).toEqual({
      asset_id: '7',
      score: 0.92,
      preview: 'this is the chunk content xxx',
    })
  })

  it('clamps topK to [1, 50]', async () => {
    mockSearchKnowledgeChunks.mockResolvedValueOnce([])
    await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q', topK: 999 })
    expect(mockSearchKnowledgeChunks.mock.calls[0][0].top_k).toBe(50)

    mockSearchKnowledgeChunks.mockResolvedValueOnce([])
    await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q', topK: 0 })
    expect(mockSearchKnowledgeChunks.mock.calls[1][0].top_k).toBe(10)
  })

  it('503 when embedding not configured', async () => {
    mockSearchKnowledgeChunks.mockRejectedValueOnce(new MockEmbeddingNotConfiguredError())
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q' })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'embedding_not_configured' })
  })

  it('400 when spaceId is not a positive integer', async () => {
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q', spaceId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('returns empty chunks when space has no sources', async () => {
    mockPgQuery.mockResolvedValueOnce({ rows: [] }) // space_source 空
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q', spaceId: 5 })
    expect(res.status).toBe(200)
    expect(res.body.chunks).toEqual([])
    expect(mockSearchKnowledgeChunks).not.toHaveBeenCalled()
  })

  it('preview is truncated to 240 chars', async () => {
    const long = 'x'.repeat(500)
    mockSearchKnowledgeChunks.mockResolvedValueOnce([
      { asset_id: 1, asset_name: 'A', chunk_content: long, score: 0.5, metadata: null },
    ])
    const res = await request(buildApp())
      .post('/api/qa/retrieve')
      .send({ query: 'q' })
    expect(res.body.chunks[0].preview.length).toBe(240)
  })
})
