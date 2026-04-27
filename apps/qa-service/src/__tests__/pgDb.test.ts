import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { default: { Pool: vi.fn().mockImplementation(() => ({ connect, query })) } }
})

describe('getPgPool', () => {
  beforeEach(() => vi.resetModules())

  it('returns a pool instance', async () => {
    const { getPgPool } = await import('../services/pgDb.ts')
    const pool = getPgPool()
    expect(pool).toBeDefined()
  })

  it('reuses the same pool on repeated calls', async () => {
    const { getPgPool } = await import('../services/pgDb.ts')
    expect(getPgPool()).toBe(getPgPool())
  })
})
