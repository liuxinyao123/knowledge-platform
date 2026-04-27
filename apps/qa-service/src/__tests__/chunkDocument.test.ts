import { describe, it, expect } from 'vitest'
import { chunkDocument } from '../services/chunkDocument.ts'

describe('chunkDocument', () => {
  it('produces L1, L2, L3 chunks', () => {
    const text = Array(20).fill('这是一句完整的测试句子。').join('\n')
    const { l1, l2, l3 } = chunkDocument(text)
    expect(l1.length).toBeGreaterThanOrEqual(1)
    expect(l2.length).toBeGreaterThanOrEqual(l1.length)
    expect(l3.length).toBeGreaterThanOrEqual(l2.length)
  })

  it('L3 chunks are shorter than L2', () => {
    const text = Array(200).fill('测试文本内容。').join('\n')
    const { l2, l3 } = chunkDocument(text)
    const avgL2 = l2.reduce((s, c) => s + c.length, 0) / (l2.length || 1)
    const avgL3 = l3.reduce((s, c) => s + c.length, 0) / (l3.length || 1)
    expect(avgL3).toBeLessThan(avgL2)
  })

  it('returns empty arrays for empty text', () => {
    const { l1, l2, l3 } = chunkDocument('')
    expect(l1).toHaveLength(0)
    expect(l2).toHaveLength(0)
    expect(l3).toHaveLength(0)
  })
})
