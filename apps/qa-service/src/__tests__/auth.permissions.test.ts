import { describe, it, expect } from 'vitest'
import {
  ROLE_TO_PERMS, USER_PERMS, ADMIN_PERMS, EDITOR_PERMS,
  expandRolesToPermissions, hasPermission,
} from '../auth/permissions.ts'
import type { Principal } from '../auth/types.ts'

describe('ROLE_TO_PERMS —— PRD §2.3 表', () => {
  it('viewer/user = USER_PERMS 7 条', () => {
    expect(ROLE_TO_PERMS.viewer).toEqual(USER_PERMS)
    expect(ROLE_TO_PERMS.user).toEqual(USER_PERMS)
    expect(USER_PERMS).toHaveLength(7)
  })
  it('admin 含 iam:manage / permission:manage', () => {
    expect(ROLE_TO_PERMS.admin).toContain('iam:manage')
    expect(ROLE_TO_PERMS.admin).toContain('permission:manage')
    expect(ROLE_TO_PERMS.admin).toContain('audit:view')
  })
  it('editor 含 ops:manage 但不含 iam:manage', () => {
    expect(EDITOR_PERMS).toContain('knowledge:ops:manage')
    expect(EDITOR_PERMS).not.toContain('iam:manage')
  })
  it('ADMIN_PERMS 是 USER_PERMS 超集', () => {
    for (const p of USER_PERMS) expect(ADMIN_PERMS).toContain(p)
  })
})

describe('expandRolesToPermissions', () => {
  it('单个 role', () => {
    const r = expandRolesToPermissions(['viewer'])
    expect(r).toEqual([...USER_PERMS])
  })
  it('多 role 去重合并', () => {
    const r = expandRolesToPermissions(['viewer', 'editor'])
    // editor 含 USER_PERMS + knowledge:ops:manage；merge 去重
    expect(r).toContain('knowledge:ops:manage')
    expect(r.filter((p) => p === 'knowledge:search')).toHaveLength(1)
  })
  it('未知 role 忽略', () => {
    const r = expandRolesToPermissions(['viewer', 'nobody'])
    expect(r).toEqual([...USER_PERMS])
  })
  it('空 → []', () => {
    expect(expandRolesToPermissions([])).toEqual([])
  })
})

describe('hasPermission', () => {
  const p: Principal = {
    user_id: 1, email: 'a@b', roles: ['viewer'],
    permissions: ['knowledge:qa'],
  }
  it('含 = true', () => {
    expect(hasPermission(p, 'knowledge:qa')).toBe(true)
  })
  it('不含 = false', () => {
    expect(hasPermission(p, 'iam:manage')).toBe(false)
  })
})
