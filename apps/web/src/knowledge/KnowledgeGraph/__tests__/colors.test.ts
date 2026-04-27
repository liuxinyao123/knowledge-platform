import { describe, it, expect } from 'vitest'
import { colorForType } from '../colors'

describe('colorForType', () => {
  it('pdf → blue', () => {
    expect(colorForType('pdf')).toBe('#0ea5e9')
    expect(colorForType('PDF')).toBe('#0ea5e9') // 大小写不敏感
  })

  it('md / markdown → green', () => {
    expect(colorForType('md')).toBe('#10b981')
    expect(colorForType('markdown')).toBe('#10b981')
  })

  it('docx / doc → deep blue', () => {
    expect(colorForType('docx')).toBe('#3b82f6')
    expect(colorForType('doc')).toBe('#3b82f6')
  })

  it('xlsx / xls / csv / ods → amber', () => {
    expect(colorForType('xlsx')).toBe('#f59e0b')
    expect(colorForType('xls')).toBe('#f59e0b')
    expect(colorForType('csv')).toBe('#f59e0b')
    expect(colorForType('ods')).toBe('#f59e0b')
  })

  it('pptx / ppt → red', () => {
    expect(colorForType('pptx')).toBe('#ef4444')
    expect(colorForType('ppt')).toBe('#ef4444')
  })

  it('image* 模糊匹配 → purple', () => {
    expect(colorForType('png')).toBe('#a855f7')
    expect(colorForType('image/png')).toBe('#a855f7') // image* 前缀
    expect(colorForType('imagex')).toBe('#a855f7')
  })

  it('url / web / html → cyan', () => {
    expect(colorForType('url')).toBe('#06b6d4')
    expect(colorForType('web')).toBe('#06b6d4')
    expect(colorForType('html')).toBe('#06b6d4')
  })

  it('_tag → light amber', () => {
    expect(colorForType('_tag')).toBe('#fbbf24')
  })

  it('未知 type → fallback slate', () => {
    expect(colorForType('exotic')).toBe('#94a3b8')
    expect(colorForType('')).toBe('#94a3b8')
    expect(colorForType('unknown')).toBe('#94a3b8')
  })
})
