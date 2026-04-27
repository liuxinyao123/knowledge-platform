import { describe, it, expect } from 'vitest'
import { chunkText } from '../services/chunkText.ts'

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello world', 100, 20)).toEqual(['hello world'])
  })

  it('produces overlapping windows', () => {
    const s = 'a'.repeat(100)
    const parts = chunkText(s, 30, 10)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].length).toBeLessThanOrEqual(30)
  })
})
