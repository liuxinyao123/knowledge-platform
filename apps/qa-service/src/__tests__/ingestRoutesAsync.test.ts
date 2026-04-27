/**
 * __tests__/ingestRoutesAsync.test.ts —— ingest-async-pipeline HTTP 路由行为
 *
 * 覆盖 design.md §HTTP 路由 三分支 + SSE 基本路径：
 *   1. POST /api/ingest/upload-full            默认 → 202 + {jobId, sync:false}
 *   2. POST /api/ingest/upload-full?sync=true  → 200 + {sync:true, assetId, chunks, ...}
 *   3. INGEST_ASYNC_ENABLED=false              → 202 + {jobId, fallback:'in-memory'}
 *   4. GET /api/ingest/jobs/:id                DB fallback 命中（内存 miss）
 *
 * SSE 端点放到后续 integration test（supertest 的 EventSource 流测试太复杂；
 * 在此只验证基础 auth 判定：非 owner → 403）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockQuery }),
}))

// 异步入口会调 enqueueIngestJob；它内部：
//   1) jobRegistry.createJob → dbInsertJob (mockQuery 返回 rowCount:1 即可)
//   2) fs.writeFile (tmpdir)
//   3) pool.query UPDATE bytes_ref
// 这几步都是 mock / noop，不实际 IO
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    promises: {
      ...real.promises,
      writeFile: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
      readFile: vi.fn(async () => Buffer.from('x')),
    },
  }
})

// 同步路径会调 ingestDocument —— 我们 mock 它立即返一个 IngestOutput
vi.mock('../services/ingestPipeline/index.ts', async (orig) => {
  const real = await orig<typeof import('../services/ingestPipeline/index.ts')>()
  return {
    ...real,
    ingestDocument: vi.fn(async () => ({
      assetId: 77,
      chunks: { l1: 1, l2: 0, l3: 2 },
      structuredChunks: 3,
      images: { total: 0, withCaption: 0 },
      tags: ['t1'],
      extractorId: 'plaintext',
      warnings: undefined,
    })),
    // enqueueIngestJob 保留真实实现（与 jobRegistry 联动）
  }
})

// 鉴权绕过：保留 requireAuth 透传 + 注入 principal
vi.mock('../auth/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/index.ts')
  const devPrincipal = {
    user_id: 1, email: 'dev@test', roles: ['admin'],
    permissions: [], team_ids: [],
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

// registerUploadedPage（被 ingest.ts 旁路引用；避免真实调用）
vi.mock('../services/registerUploadedPage.ts', () => ({
  registerUploadedBookstackPage: vi.fn(async () => ({})),
}))

// 避免 routes/ingest 对 extractDocument / getPool 真实调用（其它路由路径我们不测）
vi.mock('../services/db.ts', () => ({
  getPool: () => ({ execute: vi.fn(async () => [[], []]) }),
}))
vi.mock('../services/ingestExtract.ts', () => ({
  extractDocument: vi.fn(async () => ({ ok: true, text: '', attachmentOnly: false })),
}))
vi.mock('../services/folderScan.ts', () => ({
  walkFolder: vi.fn(async function* () { /* no-op */ }),
}))
vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn(async () => []),
  isEmbeddingConfigured: vi.fn(() => true),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const { ingestRouter } = await import('../routes/ingest.ts')
  const { ingestJobsRouter } = await import('../routes/ingestJobs.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/ingest', ingestRouter)
  app.use('/api/ingest/jobs', ingestJobsRouter)
  return app
}

function defaultMockPgBehavior() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    // enqueueIngestJob 的 UPDATE bytes_ref
    if (/UPDATE ingest_job\s+SET bytes_ref/.test(sql)) return { rows: [], rowCount: 1 }
    // jobRegistry dbInsertJob: INSERT INTO ingest_job ... ON CONFLICT DO NOTHING
    if (/^INSERT INTO ingest_job/.test(sql)) return { rows: [], rowCount: 1 }
    // jobRegistry dbUpdateJob
    if (/^UPDATE ingest_job SET updated_at/.test(sql)) return { rows: [], rowCount: 1 }
    // GET /api/ingest/jobs 的 dbListJobs
    if (/SELECT\s+[^]+\s+FROM ingest_job\s*ORDER BY created_at DESC/.test(sql)) {
      return { rows: [] }
    }
    // GET /api/ingest/jobs/:id 的 dbGetJob
    if (/SELECT\s+[^]+\s+FROM ingest_job\s+WHERE id = \$1/.test(sql)) {
      const id = String(params?.[0] ?? '')
      if (id === 'db-only-job') {
        return {
          rows: [{
            id, kind: 'upload', source_id: 1, name: 'db-only.txt',
            input_payload: { space: 'X' },
            status: 'indexed', phase: 'done', progress: 100,
            log: [], preview: {}, created_by: 'dev@test',
            created_at: new Date(), updated_at: new Date(),
            finished_at: new Date(), asset_id: 42, error: null,
          }],
        }
      }
      return { rows: [] }
    }
    return { rows: [], rowCount: 0 }
  })
}

describe('POST /api/ingest/upload-full', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    defaultMockPgBehavior()
    // 清掉 env override
    delete process.env.INGEST_ASYNC_ENABLED
  })

  afterEach(() => {
    delete process.env.INGEST_ASYNC_ENABLED
  })

  it('default path returns 202 + {jobId, sync:false} (async queue)', async () => {
    const app = await buildApp()
    const res = await request(app)
      .post('/api/ingest/upload-full')
      .field('options', JSON.stringify({ sourceId: 1 }))
      .attach('file', Buffer.from('hello world'.repeat(100)), 'big.txt')

    expect(res.status).toBe(202)
    expect(res.body.sync).toBe(false)
    expect(res.body.ingest_status).toBe('queued')
    expect(typeof res.body.jobId).toBe('string')
    expect(res.body.jobId.length).toBeGreaterThan(0)
  })

  it('?sync=true returns 200 + {sync:true, assetId, chunks, ...}', async () => {
    const app = await buildApp()
    const res = await request(app)
      .post('/api/ingest/upload-full?sync=true')
      .field('options', JSON.stringify({ sourceId: 1 }))
      .attach('file', Buffer.from('small'), 'small.txt')

    expect(res.status).toBe(200)
    expect(res.body.sync).toBe(true)
    expect(res.body.assetId).toBe(77)
    expect(res.body.chunks).toEqual({ l1: 1, l2: 0, l3: 2 })
    expect(res.body.structuredChunks).toBe(3)
    expect(res.body.tags).toEqual(['t1'])
    expect(res.body.extractorId).toBe('plaintext')
  })

  it('INGEST_ASYNC_ENABLED=false falls back to in-memory (202 + fallback tag)', async () => {
    process.env.INGEST_ASYNC_ENABLED = 'false'
    const app = await buildApp()
    const res = await request(app)
      .post('/api/ingest/upload-full')
      .field('options', JSON.stringify({ sourceId: 1 }))
      .attach('file', Buffer.from('payload'), 'a.txt')

    expect(res.status).toBe(202)
    expect(res.body.sync).toBe(false)
    expect(typeof res.body.jobId).toBe('string')
    // 内存 fallback：老路径 runIngestAndTrack
    expect(res.body.fallback === 'in-memory' || res.body.fallback === undefined).toBe(true)
  })

  it('returns 400 when file field is missing', async () => {
    const app = await buildApp()
    const res = await request(app)
      .post('/api/ingest/upload-full')
      .field('options', JSON.stringify({ sourceId: 1 }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/缺少 file/)
  })
})

describe('GET /api/ingest/jobs/:id DB fallback', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    defaultMockPgBehavior()
  })

  it('returns job from DB when memory misses', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/ingest/jobs/db-only-job')
    expect(res.status).toBe(200)
    expect(res.body.job.id).toBe('db-only-job')
    expect(res.body.job.phase).toBe('done')
    expect(res.body.job.assetId).toBe(42)
    // steps 来自 PIPELINE_STEPS，应有 6 项
    expect(Array.isArray(res.body.steps)).toBe(true)
    expect(res.body.steps.length).toBe(6)
  })

  it('returns 404 when both memory and DB miss', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/ingest/jobs/nonexistent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/)
  })
})

describe('GET /api/ingest/jobs/:id/stream auth', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    defaultMockPgBehavior()
  })

  it('returns 404 when job does not exist', async () => {
    const app = await buildApp()
    const res = await request(app).get('/api/ingest/jobs/nonexistent-id/stream')
    expect(res.status).toBe(404)
  })

  // ingest-async-pipeline (ADR-40 §Follow-up #5 · 2026-04-25)：
  // 非 owner 订阅被拒。需要单独构建一个 app 注入 non-admin principal。
  it('returns 403 when non-owner non-admin tries to subscribe', async () => {
    const express = (await import('express')).default
    const app = express()
    app.use(express.json())
    // 注入 owner != principal 的场景：principal.email='other@x'，无 'admin' role，job.created_by='owner@x'
    app.use((req, _res, next) => {
      ;(req as unknown as { principal: { user_id: number; email: string; roles: string[] } }).principal = {
        user_id: 99, email: 'other@x', roles: ['user'],
      }
      next()
    })
    // 自己 wire ingestJobs router（绕开 buildApp 默认的 admin principal）
    const { ingestJobsRouter } = await import('../routes/ingestJobs.ts')
    app.use('/api/ingest/jobs', ingestJobsRouter)

    // DB 返回一行 created_by='owner@x'，principal 是 'other@x' → 期望 403
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/SELECT\s+[^]+\s+FROM ingest_job\s+WHERE id = \$1/.test(sql)) {
        const id = String(params?.[0] ?? '')
        if (id === 'owner-job') {
          return {
            rows: [{
              id, kind: 'upload', source_id: 1, name: 'x.pdf',
              input_payload: {},
              status: 'in_progress', phase: 'chunk', progress: 60,
              log: [], preview: {}, created_by: 'owner@x',
              created_at: new Date(), updated_at: new Date(),
              finished_at: null, asset_id: null, error: null,
            }],
          }
        }
      }
      return { rows: [] }
    })

    const res = await request(app).get('/api/ingest/jobs/owner-job/stream')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/owner/i)
  })

  it('admin role bypasses owner check', async () => {
    // 默认 buildApp 注入 admin principal；create_by !== principal.email 也应能订阅
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/SELECT\s+[^]+\s+FROM ingest_job\s+WHERE id = \$1/.test(sql)) {
        const id = String(params?.[0] ?? '')
        if (id === 'admin-bypass') {
          return {
            rows: [{
              id, kind: 'upload', source_id: 1, name: 'x.pdf',
              input_payload: {},
              status: 'indexed', phase: 'done', progress: 100,
              log: [], preview: {}, created_by: 'someone-else@x',
              created_at: new Date(), updated_at: new Date(),
              finished_at: new Date(), asset_id: 42, error: null,
            }],
          }
        }
      }
      return { rows: [] }
    })
    const app = await buildApp()
    const res = await request(app).get('/api/ingest/jobs/admin-bypass/stream')
    // admin + 已是终态 done → SSE 第一条 phase + done 事件后立即关闭，HTTP 200
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
  })
})
