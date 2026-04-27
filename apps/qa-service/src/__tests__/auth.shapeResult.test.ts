import { describe, it, expect } from 'vitest'
import { shapeRow, shapeResultByAcl } from '../auth/shapeResult.ts'
import type { Decision } from '../auth/types.ts'

describe('shapeRow', () => {
  it('hide removes key', () => {
    const out = shapeRow({ id: 1, phone: '1380' }, [{ field: 'phone', mode: 'hide' }])
    expect('phone' in out).toBe(false)
    expect(out.id).toBe(1)
  })
  it('star replaces value', () => {
    const out = shapeRow({ phone: '1380' }, [{ field: 'phone', mode: 'star' }])
    expect(out.phone).toBe('***')
  })
  it('hash returns 8 hex chars', () => {
    const out = shapeRow({ email: 'a@b.com' }, [{ field: 'email', mode: 'hash' }])
    expect(String(out.email)).toMatch(/^[0-9a-f]{8}$/)
  })
  it('truncate keeps first 4 + ...', () => {
    const out = shapeRow({ text: 'hello world' }, [{ field: 'text', mode: 'truncate' }])
    expect(out.text).toBe('hell...')
  })
  it('truncate short unchanged', () => {
    const out = shapeRow({ text: 'abc' }, [{ field: 'text', mode: 'truncate' }])
    expect(out.text).toBe('abc')
  })
  it('missing field no-op', () => {
    const out = shapeRow({ a: 1 }, [{ field: 'b', mode: 'star' }])
    expect(out).toEqual({ a: 1 })
  })
})

describe('shapeResultByAcl', () => {
  it('no decision.mask → rows unchanged', () => {
    const rows = [{ a: 1 }, { a: 2 }]
    const out = shapeResultByAcl(undefined, rows)
    expect(out).toBe(rows) // same ref
  })
  it('applies mask to each row', () => {
    const dec: Decision = { allow: true, mask: [{ field: 'email', mode: 'star' }] }
    const out = shapeResultByAcl(dec, [{ email: 'a@b' }, { email: 'c@d' }])
    expect(out).toEqual([{ email: '***' }, { email: '***' }])
  })
})
