import { describe, it, expect } from 'vitest'
import { evalCondition } from '../auth/conditionEval.ts'
import type { Principal, AclResource } from '../auth/types.ts'

const p: Principal = { user_id: 1, email: 'a@b.com', roles: ['editor'], permissions: [] }
const r: AclResource = { source_id: 5, asset_id: 10 }
const ctx = { principal: p, resource: r }

describe('evalCondition — leaf predicates', () => {
  it('eq', () => {
    expect(evalCondition({ field: 'principal.email', op: 'eq', value: 'a@b.com' }, ctx)).toBe(true)
    expect(evalCondition({ field: 'principal.email', op: 'eq', value: 'x@y.com' }, ctx)).toBe(false)
  })
  it('in / nin', () => {
    expect(evalCondition({ field: 'resource.asset_id', op: 'in', value: [10, 11] }, ctx)).toBe(true)
    expect(evalCondition({ field: 'resource.asset_id', op: 'nin', value: [99] }, ctx)).toBe(true)
  })
  it('gt / lt', () => {
    expect(evalCondition({ field: 'resource.source_id', op: 'gt', value: 1 }, ctx)).toBe(true)
    expect(evalCondition({ field: 'resource.source_id', op: 'lt', value: 1 }, ctx)).toBe(false)
  })
  it('startsWith / endsWith', () => {
    expect(evalCondition({ field: 'principal.email', op: 'startsWith', value: 'a@' }, ctx)).toBe(true)
    expect(evalCondition({ field: 'principal.email', op: 'endsWith',   value: '.com' }, ctx)).toBe(true)
  })
  it('regex basic', () => {
    expect(evalCondition({ field: 'principal.email', op: 'regex', value: '^a@' }, ctx)).toBe(true)
    expect(evalCondition({ field: 'principal.email', op: 'regex', value: '^z@' }, ctx)).toBe(false)
  })
  it('invalid regex → false', () => {
    expect(evalCondition({ field: 'principal.email', op: 'regex', value: '(' }, ctx)).toBe(false)
  })
})

describe('evalCondition — composite', () => {
  it('and', () => {
    expect(evalCondition({
      op: 'and',
      args: [
        { field: 'principal.email', op: 'endsWith', value: '.com' },
        { field: 'resource.asset_id', op: 'eq', value: 10 },
      ],
    }, ctx)).toBe(true)
  })
  it('or', () => {
    expect(evalCondition({
      op: 'or',
      args: [
        { field: 'principal.email', op: 'eq', value: 'x@y' },
        { field: 'resource.asset_id', op: 'eq', value: 10 },
      ],
    }, ctx)).toBe(true)
  })
  it('null condition → always true', () => {
    expect(evalCondition(null, ctx)).toBe(true)
    expect(evalCondition(undefined, ctx)).toBe(true)
  })
})
