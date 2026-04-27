import { describe, it, expect } from 'vitest'
import { diffJson } from './diffJson'

describe('diffJson', () => {
  it('CREATE: before=null → 每个 after 字段标 (new)', () => {
    const out = diffJson(null, { permission: 'READ', effect: 'allow' })
    expect(out).toContain('permission: (new) READ')
    expect(out).toContain('effect: (new) allow')
  })

  it('CREATE: 跳过 after 里为 null/undefined 的字段', () => {
    const out = diffJson(null, { permission: 'READ', expires_at: null })
    expect(out).toContain('permission: (new) READ')
    expect(out.some((s) => s.startsWith('expires_at:'))).toBe(false)
  })

  it('DELETE: after=null → 每个 before 字段标 (deleted)', () => {
    const out = diffJson({ permission: 'READ' }, null)
    expect(out).toContain('permission: READ (deleted)')
  })

  it('UPDATE: 只显示改动的 key', () => {
    const out = diffJson(
      { permission: 'READ', effect: 'allow', expires_at: null },
      { permission: 'READ', effect: 'deny',  expires_at: '2026-05-01T00:00:00Z' },
    )
    expect(out).toContain('effect: allow → deny')
    expect(out).toContain('expires_at: NULL → 2026-05-01T00:00:00Z')
    expect(out.some((s) => s.startsWith('permission:'))).toBe(false)
  })

  it('UPDATE: 对象字段用 JSON 序列化比较', () => {
    const out = diffJson(
      { condition: { op: 'eq' } },
      { condition: { op: 'neq' } },
    )
    expect(out[0]).toMatch(/condition: \{"op":"eq"\} → \{"op":"neq"\}/)
  })

  it('空 diff：before 与 after 完全一致', () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([])
  })
})
