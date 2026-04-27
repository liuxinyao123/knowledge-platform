import { describe, it, expect, beforeEach } from 'vitest'
import {
  aclCacheGet, aclCacheSet, aclCacheKey, aclCacheFlush, __aclCacheSize,
} from '../auth/aclCache.ts'
import type { Principal } from '../auth/types.ts'

const principal: Principal = { user_id: 1, email: 'a@b', roles: ['editor', 'admin'], permissions: [] }

describe('aclCache', () => {
  beforeEach(() => aclCacheFlush())

  it('key sorts roles and includes action', () => {
    const k1 = aclCacheKey(principal, 'READ', { source_id: 1 })
    const p2: Principal = { ...principal, roles: ['admin', 'editor'], permissions: [] }
    const k2 = aclCacheKey(p2, 'READ', { source_id: 1 })
    expect(k1).toBe(k2) // 角色排序后一致
    const k3 = aclCacheKey(principal, 'WRITE', { source_id: 1 })
    expect(k3).not.toBe(k1)
  })

  it('set / get round-trip', () => {
    const key = aclCacheKey(principal, 'READ', {})
    aclCacheSet(key, { allow: true })
    expect(aclCacheGet(key)?.allow).toBe(true)
  })

  it('flush empties store', () => {
    aclCacheSet('k', { allow: false })
    expect(__aclCacheSize()).toBeGreaterThan(0)
    aclCacheFlush()
    expect(__aclCacheSize()).toBe(0)
  })
})
