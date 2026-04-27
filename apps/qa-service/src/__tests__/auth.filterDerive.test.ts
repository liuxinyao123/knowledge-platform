import { describe, it, expect } from 'vitest'
import { deriveFilter } from '../auth/filterDerive.ts'
import type { AclRuleRow } from '../auth/types.ts'

function r(partial: Partial<AclRuleRow>): AclRuleRow {
  return {
    id: 0, source_id: null, asset_id: null, field_id: null,
    role: null, permission: 'READ', condition: null,
    ...partial,
  }
}

describe('deriveFilter', () => {
  it('global rule → no filter', () => {
    expect(deriveFilter([r({ permission: 'READ' })])).toBeUndefined()
  })

  it('source-only rules → ma.source_id = ANY(...)', () => {
    const f = deriveFilter([r({ source_id: 1 }), r({ source_id: 3 })])
    expect(f?.where).toContain('ma.source_id')
    expect(f?.params[0]).toEqual([1, 3])
  })

  it('asset-only rules → mf.asset_id = ANY(...)', () => {
    const f = deriveFilter([r({ asset_id: 5 }), r({ asset_id: 9 })])
    expect(f?.where).toContain('mf.asset_id')
    expect(f?.params[0]).toEqual([5, 9])
  })

  it('mixed → OR of both', () => {
    const f = deriveFilter([r({ asset_id: 5 }), r({ source_id: 1 })])
    expect(f?.where).toMatch(/asset_id.*source_id/)
    expect(f?.params[0]).toEqual([5])
    expect(f?.params[1]).toEqual([1])
  })
})
