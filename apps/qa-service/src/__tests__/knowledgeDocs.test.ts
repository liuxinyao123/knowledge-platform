import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockQuery }),
}))
vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn().mockResolvedValue([[...Array(1024)].map(() => 0.1)]),
  isEmbeddingConfigured: vi.fn().mockReturnValue(true),
}))

// ADR-30 fortified DELETE with requireAuth + enforceAcl. Replace them with
// pass-through middleware so this unit test can focus on the route logic.
vi.mock('../auth/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/index.ts')
  const devPrincipal = {
    user_id: 1,
    email: 'dev@test',
    roles: ['admin'],
    permissions: [],
    team_ids: [],
  }
  return {
    ...actual,
    requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      ;(req as unknown as { principal: typeof devPrincipal }).principal = devPrincipal
      next()
    },
    enforceAcl: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    shapeResultByAcl: <T>(_req: unknown, rows: T): T => rows,
  }
})

async function buildApp() {
  const { knowledgeDocsRouter } = await import('../routes/knowledgeDocs.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/knowledge', knowledgeDocsRouter)
  return app
}

describe('GET /api/knowledge/documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns document list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] })
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 1, name: 'Doc A', type: 'document', path: null, indexed_at: null, tags: [] },
      { id: 2, name: 'Doc B', type: 'document', path: null, indexed_at: null, tags: [] },
    ]})
    const app = await buildApp()
    const res = await request(app).get('/api/knowledge/documents')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.items).toHaveLength(2)
  })
})

describe('DELETE /api/knowledge/documents/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok on delete (ADR-30 + ADR-40 cancel ingest_job)', async () => {
    // ADR-30 + ADR-40 flow（test 文件里 enforceAcl 已 mock 成 next() no-op，
    // 不会触发 ACL gateway loadResource，故无 ACL pre-SELECT）：
    //   1) handler pre-SELECT name/source_id
    //   2) UPDATE ingest_job SET status='cancelled' WHERE asset_id=...
    //   3) DELETE FROM metadata_asset
    //   4) audit_log INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Doc', source_id: null }], rowCount: 1 }) // handler pre-SELECT
    mockQuery.mockResolvedValueOnce({ rowCount: 2 })                                           // UPDATE ingest_job
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })                                           // DELETE
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })                                           // audit_log
    const app = await buildApp()
    const res = await request(app).delete('/api/knowledge/documents/1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.cancelledJobs).toBe(2)

    // 验证 UPDATE ingest_job 用了正确的 WHERE 条件（包含 status IN ('queued','in_progress')）
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]))
    const cancelCall = sqls.find((s) => /UPDATE ingest_job\s+SET status = 'cancelled'/.test(s))
    expect(cancelCall, 'expected an UPDATE ingest_job SET cancelled call').toBeTruthy()
    expect(cancelCall).toMatch(/WHERE asset_id = \$1/)
    expect(cancelCall).toMatch(/status IN \('queued', 'in_progress'\)/)
  })

  it('cancel-pending-jobs failure is best-effort and does not block DELETE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Doc', source_id: null }], rowCount: 1 }) // handler pre-SELECT
    mockQuery.mockRejectedValueOnce(new Error('ingest_job table missing'))                     // UPDATE 抛
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })                                           // DELETE 仍要成功
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })                                           // audit_log
    const app = await buildApp()
    const res = await request(app).delete('/api/knowledge/documents/2')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.cancelledJobs).toBe(0)
  })

  it('returns 404 when not found (pre-SELECT empty short-circuits before UPDATE/DELETE)', async () => {
    // pre-SELECT 返回空 rows → handler 直接 404，不会跑后续 UPDATE / DELETE / audit
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const app = await buildApp()
    const res = await request(app).delete('/api/knowledge/documents/99')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/knowledge/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns search results', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { asset_id: 1, asset_name: 'Doc A', chunk_content: '测试内容', score: 0.92, metadata: null },
    ]})
    const app = await buildApp()
    const res = await request(app)
      .post('/api/knowledge/search')
      .send({ query: '测试查询', top_k: 5 })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].score).toBeGreaterThan(0.8)
  })

  it('returns 400 if query missing', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/knowledge/search').send({})
    expect(res.status).toBe(400)
  })
})
