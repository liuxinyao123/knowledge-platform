import { describe, it, expect, vi } from 'vitest'

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue([[], []]),
      getConnection: vi.fn(),
    })),
  },
}))

describe('db pool', () => {
  it('exports a pool object', async () => {
    const { pool } = await import('../services/db.ts')
    expect(pool).toBeDefined()
    expect(typeof pool.execute).toBe('function')
  })
})
