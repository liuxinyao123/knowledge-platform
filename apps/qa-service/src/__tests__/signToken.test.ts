import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signHS256 } from '../auth/signToken.ts'
import { verifyToken } from '../auth/verifyToken.ts'

describe('signToken <-> verifyToken round-trip', () => {
  const SECRET = 'test-secret-xyz'

  beforeEach(() => {
    process.env.AUTH_HS256_SECRET = SECRET
    delete process.env.AUTH_JWKS_URL
  })
  afterEach(() => {
    delete process.env.AUTH_HS256_SECRET
  })

  it('sign then verify returns matching payload', async () => {
    const tok = signHS256({
      sub: 42,
      email: 'a@b.com',
      roles: ['editor'],
      permissions: ['knowledge:qa'],
    }, SECRET)

    const out = await verifyToken(tok)
    expect(out.user_id).toBe(42)
    expect(out.email).toBe('a@b.com')
    expect(out.roles).toEqual(['editor'])
    expect(out.permissions).toEqual(['knowledge:qa'])
  })

  it('token 过期被拒', async () => {
    const tok = signHS256({ sub: 1 }, SECRET, -10)   // 立刻过期
    await expect(verifyToken(tok)).rejects.toThrow()
  })

  it('不同 secret 不能验通', async () => {
    const tok = signHS256({ sub: 1 }, 'other-secret')
    await expect(verifyToken(tok)).rejects.toThrow()
  })
})
