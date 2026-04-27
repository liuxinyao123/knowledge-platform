import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { verifyToken, authMode, isAuthConfigured, TokenError } from '../auth/verifyToken.ts'

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function signHs256(payload: Record<string, unknown>, secret: string, alg = 'HS256'): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  return `${header}.${body}.${b64url(sig)}`
}

describe('verifyToken — HS256', () => {
  const SECRET = 'test-secret'

  beforeEach(() => {
    process.env.AUTH_HS256_SECRET = SECRET
    delete process.env.AUTH_JWKS_URL
  })
  afterEach(() => {
    delete process.env.AUTH_HS256_SECRET
  })

  it('authMode / isAuthConfigured', () => {
    expect(authMode()).toBe('hs256')
    expect(isAuthConfigured()).toBe(true)
  })

  it('valid token returns user_id + email', async () => {
    const token = signHs256({ sub: 42, email: 'a@b.com' }, SECRET)
    const payload = await verifyToken(token)
    expect(payload.user_id).toBe(42)
    expect(payload.email).toBe('a@b.com')
  })

  it('wrong secret → bad signature', async () => {
    const token = signHs256({ sub: 1 }, 'other-secret')
    await expect(verifyToken(token)).rejects.toBeInstanceOf(TokenError)
  })

  it('expired token rejected', async () => {
    const token = signHs256({ sub: 1, exp: 1 }, SECRET)
    await expect(verifyToken(token)).rejects.toThrow(/expired/)
  })

  it('malformed token rejected', async () => {
    await expect(verifyToken('not.a.jwt.at.all')).rejects.toThrow(/malformed/)
  })

  it('invalid sub → rejected', async () => {
    const token = signHs256({ sub: 'nonnumeric' }, SECRET)
    await expect(verifyToken(token)).rejects.toThrow(/invalid sub/)
  })
})

describe('authMode — none', () => {
  beforeEach(() => {
    delete process.env.AUTH_HS256_SECRET
    delete process.env.AUTH_JWKS_URL
  })

  it('returns none when nothing configured', () => {
    expect(authMode()).toBe('none')
    expect(isAuthConfigured()).toBe(false)
  })

  it('verifyToken throws when no mode', async () => {
    await expect(verifyToken('x.y.z')).rejects.toBeInstanceOf(TokenError)
  })
})
