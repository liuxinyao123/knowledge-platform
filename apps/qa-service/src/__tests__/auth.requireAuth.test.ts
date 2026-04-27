import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import express from 'express'
import request from 'supertest'

// Mock DB pool：loadRolesFromDb 不连 MySQL
vi.mock('../services/db.ts', () => ({
  getPool: () => ({
    execute: vi.fn().mockResolvedValue([[{ role: 'editor' }], []]),
  }),
}))

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function sign(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  return `${header}.${body}.${b64url(sig)}`
}

async function buildApp() {
  const { requireAuth } = await import('../auth/requireAuth.ts')
  const app = express()
  app.get('/ok', requireAuth(), (req, res) => {
    res.json({ principal: req.principal })
  })
  return app
}

describe('requireAuth — HS256 mode', () => {
  const SECRET = 'secret-x'

  beforeEach(() => {
    process.env.AUTH_HS256_SECRET = SECRET
    delete process.env.AUTH_JWKS_URL
    delete process.env.NODE_ENV
  })
  afterEach(() => {
    delete process.env.AUTH_HS256_SECRET
  })

  it('missing token → 401', async () => {
    const app = await buildApp()
    const res = await request(app).get('/ok')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('missing token')
  })

  it('invalid signature → 401', async () => {
    const app = await buildApp()
    const bad = sign({ sub: 1 }, 'wrong-secret')
    const res = await request(app).get('/ok').set('Authorization', `Bearer ${bad}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid token')
  })

  it('valid token → principal injected with roles from DB', async () => {
    const app = await buildApp()
    const tok = sign({ sub: 7, email: 'a@b.com' }, SECRET)
    const res = await request(app).get('/ok').set('Authorization', `Bearer ${tok}`)
    expect(res.status).toBe(200)
    // G2: Principal 新增 permissions 字段（由 roles 展开），用 toMatchObject
    // 保留对 roles 的精确断言，permissions 只验基础 editor 权限到位
    expect(res.body.principal).toMatchObject({
      user_id: 7, email: 'a@b.com', roles: ['editor'],
    })
    expect(res.body.principal.permissions).toEqual(
      expect.arrayContaining(['knowledge:qa', 'knowledge:ops:manage']),
    )
    // editor 不应有 ADMIN 专属权限
    expect(res.body.principal.permissions).not.toContain('iam:manage')
  })
})

describe('requireAuth — DEV BYPASS', () => {
  beforeEach(() => {
    delete process.env.AUTH_HS256_SECRET
    delete process.env.AUTH_JWKS_URL
    delete process.env.NODE_ENV
  })

  it('no config + dev → principal is admin', async () => {
    const app = await buildApp()
    const res = await request(app).get('/ok')
    expect(res.status).toBe(200)
    expect(res.body.principal.roles).toEqual(['admin'])
    expect(res.body.principal.user_id).toBe(0)
  })

  it('no config + production → 500', async () => {
    process.env.NODE_ENV = 'production'
    const app = await buildApp()
    const res = await request(app).get('/ok')
    expect(res.status).toBe(500)
  })
})
