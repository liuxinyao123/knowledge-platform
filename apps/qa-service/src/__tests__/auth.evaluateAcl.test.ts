import { describe, it, expect, beforeEach } from 'vitest'
import { __setRulesForTest, evaluateAcl } from '../auth/evaluateAcl.ts'
import type { AclRuleRow, Principal } from '../auth/types.ts'

const editor: Principal = { user_id: 1, email: 'e@x.com', roles: ['editor'], permissions: [] }
const admin:  Principal = { user_id: 2, email: 'a@x.com', roles: ['admin'], permissions: [] }
const viewer: Principal = { user_id: 3, email: 'v@x.com', roles: ['viewer'], permissions: [] }

function rule(partial: Partial<AclRuleRow> & { permission: string }): AclRuleRow {
  return {
    id: Math.floor(Math.random() * 10000),
    source_id: partial.source_id ?? null,
    asset_id:  partial.asset_id  ?? null,
    field_id:  null,
    role:      partial.role ?? null,
    permission: partial.permission,
    condition: partial.condition ?? null,
  }
}

describe('evaluateAcl', () => {
  beforeEach(() => __setRulesForTest([]))

  it('empty rules → deny by default', async () => {
    __setRulesForTest([])
    const d = await evaluateAcl(editor, 'READ', { source_id: 1 })
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/no matching rule/)
  })

  it('role=NULL rule applies to all roles', async () => {
    __setRulesForTest([rule({ source_id: 1, role: null, permission: 'READ' })])
    const d = await evaluateAcl(editor, 'READ', { source_id: 1 })
    expect(d.allow).toBe(true)
  })

  it('union semantics — any allow yields allow', async () => {
    __setRulesForTest([
      rule({ asset_id: 10, role: 'viewer', permission: 'READ' }),
      rule({ asset_id: 10, role: 'editor', permission: 'WRITE' }),
    ])
    // viewer asking READ 10 → rule 1 matches
    const d = await evaluateAcl(viewer, 'READ', { asset_id: 10 })
    expect(d.allow).toBe(true)
  })

  it('ADMIN permission is superset of READ/WRITE/DELETE', async () => {
    __setRulesForTest([rule({ source_id: 1, role: 'admin', permission: 'ADMIN' })])
    expect((await evaluateAcl(admin, 'READ',   { source_id: 1 })).allow).toBe(true)
    expect((await evaluateAcl(admin, 'WRITE',  { source_id: 1 })).allow).toBe(true)
    expect((await evaluateAcl(admin, 'DELETE', { source_id: 1 })).allow).toBe(true)
  })

  it('condition must satisfy to match', async () => {
    __setRulesForTest([rule({
      source_id: 1, role: 'editor', permission: 'READ',
      condition: { field: 'principal.email', op: 'eq', value: 'e@x.com' },
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(true)
    const other = { ...editor, email: 'other@x.com' }
    expect((await evaluateAcl(other, 'READ', { source_id: 1 })).allow).toBe(false)
  })

  it('source-level rule derives ma.source_id filter', async () => {
    __setRulesForTest([rule({ source_id: 7, role: 'analyst', permission: 'READ' })])
    const analyst: Principal = { user_id: 9, email: 'x@y', roles: ['analyst'], permissions: [] }
    const d = await evaluateAcl(analyst, 'READ', {})
    expect(d.allow).toBe(true)
    expect(d.filter?.where).toContain('ma.source_id')
    expect(d.filter?.params[0]).toEqual([7])
  })

  it('mask is extracted from condition.mask', async () => {
    __setRulesForTest([rule({
      source_id: 1, role: null, permission: 'READ',
      condition: { mask: [{ field: 'phone', mode: 'star' }] },
    })])
    const d = await evaluateAcl(editor, 'READ', { source_id: 1 })
    expect(d.mask).toEqual([{ field: 'phone', mode: 'star' }])
  })
})
