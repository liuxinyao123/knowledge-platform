import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ sql: string; params: unknown[] }> = []
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] })
      return { rows: [], rowCount: 0 }
    }),
  }),
}))

import { writeAudit } from '../services/audit.ts'

describe('writeAudit', () => {
  beforeEach(() => { calls.length = 0 })

  it('inserts one row with principal + detail serialized as json', async () => {
    await writeAudit({
      action: 'acl_rule_create',
      targetType: 'rule',
      targetId: 7,
      detail: { permission: 'READ' },
      principal: { user_id: 3, email: 'a@b', roles: ['admin'], permissions: [] },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toMatch(/INSERT INTO audit_log/)
    const p = calls[0].params
    expect(p[0]).toBe(3)                              // user_id
    expect(p[1]).toBe('a@b')                          // email
    expect(p[2]).toBe('acl_rule_create')
    expect(p[3]).toBe('rule')
    expect(p[4]).toBe('7')                            // stringified id
    expect(p[5]).toBe(JSON.stringify({ permission: 'READ' }))
  })

  it('swallows DB errors and does not throw', async () => {
    const bad = await import('../services/pgDb.ts')
    vi.spyOn(bad, 'getPgPool').mockReturnValueOnce({
      query: vi.fn().mockRejectedValue(new Error('db down')),
    } as any)
    await expect(writeAudit({ action: 'x' })).resolves.toBeUndefined()
  })

  it('handles optional fields', async () => {
    await writeAudit({ action: 'minimal' })
    expect(calls.length).toBe(1)
    const p = calls[calls.length - 1].params
    expect(p[0]).toBeNull()                           // no user
    expect(p[2]).toBe('minimal')
    expect(p[3]).toBeNull()
    expect(p[5]).toBeNull()                           // no detail
  })
})
