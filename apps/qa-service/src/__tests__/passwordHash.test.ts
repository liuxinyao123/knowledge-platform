import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../services/passwordHash.ts'

describe('passwordHash', () => {
  it('round-trip 正确密码通过', async () => {
    const h = await hashPassword('hunter2-secure')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('hunter2-secure', h)).toBe(true)
  })

  it('错误密码不通过', async () => {
    const h = await hashPassword('correct-horse')
    expect(await verifyPassword('wrong-horse', h)).toBe(false)
  })

  it('同一密码两次 hash 结果不同（不同 salt）', async () => {
    const pw = 'same-password'
    const h1 = await hashPassword(pw)
    const h2 = await hashPassword(pw)
    expect(h1).not.toBe(h2)
    expect(await verifyPassword(pw, h1)).toBe(true)
    expect(await verifyPassword(pw, h2)).toBe(true)
  })

  it('非法 stored 格式 → false', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-hash')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$only-two-parts')).toBe(false)
  })

  it('空密码抛错', async () => {
    await expect(hashPassword('')).rejects.toThrow()
  })
})
