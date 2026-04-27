import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../services/db.ts', () => ({
  getPool: () => ({ execute: vi.fn().mockResolvedValue([[{ role: 'admin' }], []]) }),
}))

vi.mock('../auth/evaluateAcl.ts', async (orig) => {
  const real = await orig<typeof import('../auth/evaluateAcl.ts')>()
  return {
    ...real,
    // 默认允许；特定测试里 override
    evaluateAcl: vi.fn().mockResolvedValue({ allow: true }),
  }
})

async function build() {
  const { requireAuth } = await import('../auth/requireAuth.ts')
  const { enforceAcl } = await import('../auth/enforceAcl.ts')
  const { aclCacheFlush } = await import('../auth/aclCache.ts')
  aclCacheFlush()

  const app = express()
  app.use(express.json())
  app.post('/go',
    requireAuth(),
    enforceAcl({
      action: 'READ',
      resourceExtractor: (req) => ({ source_id: req.body?.source_id }),
    }),
    (req, res) => res.json({ ok: true, decision: req.aclDecision }),
  )
  return app
}

describe('enforceAcl', () => {
  beforeEach(() => {
    delete process.env.AUTH_HS256_SECRET
    delete process.env.AUTH_JWKS_URL
    delete process.env.NODE_ENV
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.NODE_ENV
  })

  it('DEV BYPASS：未配 AUTH + 非生产 → 放行且 decision.allow=true', async () => {
    const app = await build()
    const res = await request(app).post('/go').send({ source_id: 1 })
    expect(res.status).toBe(200)
    expect(res.body.decision).toEqual({ allow: true })
  })

  it('配了 AUTH 但 deny → 403', async () => {
    process.env.AUTH_HS256_SECRET = 'x'
    const mod = await import('../auth/evaluateAcl.ts')
    const evalMock = mod.evaluateAcl as unknown as ReturnType<typeof vi.fn>
    evalMock.mockResolvedValueOnce({ allow: false, reason: 'blocked' })

    const app = await build()
    // 需要合法 token 才进 enforceAcl；用 DEV BYPASS 不行（会被第一条分支放行）
    // 这里简单改走 HS256 签的 token
    const crypto = await import('node:crypto')
    const b64url = (s: string) => Buffer.from(s).toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 1, email: 'a@b' }))
    const sig = crypto.createHmac('sha256', 'x').update(`${header}.${body}`).digest()
    const token = `${header}.${body}.${Buffer.from(sig).toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`

    const res = await request(app).post('/go')
      .set('Authorization', `Bearer ${token}`)
      .send({ source_id: 1 })
    expect(res.status).toBe(403)
    expect(res.body.reason).toBe('blocked')
  })
})
