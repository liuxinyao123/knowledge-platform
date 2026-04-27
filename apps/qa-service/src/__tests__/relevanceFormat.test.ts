import { describe, it, expect } from 'vitest'
import { formatRelevanceScore, relevanceBucket } from '../services/relevanceFormat.ts'

describe('formatRelevanceScore', () => {
  it('≥ 0.5 用两位小数', () => {
    expect(formatRelevanceScore(0.9996)).toBe('1.00')
    expect(formatRelevanceScore(0.75)).toBe('0.75')
    expect(formatRelevanceScore(0.5)).toBe('0.50')
  })

  it('[0.01, 0.5) 用三位小数', () => {
    expect(formatRelevanceScore(0.049)).toBe('0.049')
    expect(formatRelevanceScore(0.1)).toBe('0.100')
    expect(formatRelevanceScore(0.01)).toBe('0.010')
  })

  it('< 0.01 用科学记数', () => {
    expect(formatRelevanceScore(0.0000166)).toBe('1.66e-5')
    expect(formatRelevanceScore(0.009)).toBe('9.00e-3')
  })

  it('边界 0 也走科学记数分支', () => {
    expect(formatRelevanceScore(0)).toBe('0.00e+0')
  })

  it('非数字 → "—"', () => {
    expect(formatRelevanceScore(NaN)).toBe('—')
    expect(formatRelevanceScore(Infinity)).toBe('—')
    expect(formatRelevanceScore(null)).toBe('—')
    expect(formatRelevanceScore(undefined)).toBe('—')
  })
})

describe('relevanceBucket', () => {
  it('四档边界', () => {
    expect(relevanceBucket(0.9)).toBe('high')
    expect(relevanceBucket(0.5)).toBe('high')
    expect(relevanceBucket(0.3)).toBe('medium')
    expect(relevanceBucket(0.1)).toBe('medium')
    expect(relevanceBucket(0.05)).toBe('weak')
    expect(relevanceBucket(0.01)).toBe('weak')
    expect(relevanceBucket(0.005)).toBe('none')
    expect(relevanceBucket(0)).toBe('none')
    expect(relevanceBucket(NaN)).toBe('none')
    expect(relevanceBucket(null)).toBe('none')
  })
})
