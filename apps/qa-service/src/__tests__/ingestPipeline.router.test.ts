import { describe, it, expect } from 'vitest'
import { routeExtractor, isKnownExt } from '../services/ingestPipeline/router.ts'

describe('routeExtractor', () => {
  it('routes pdf / PDF', () => {
    expect(routeExtractor('a.pdf').id).toBe('pdf')
    expect(routeExtractor('A.PDF').id).toBe('pdf')
  })
  it('routes docx / pptx / xlsx', () => {
    expect(routeExtractor('x.docx').id).toBe('docx')
    expect(routeExtractor('x.pptx').id).toBe('pptx')
    expect(routeExtractor('x.xlsx').id).toBe('xlsx')
  })
  it('routes markdown family', () => {
    expect(routeExtractor('x.md').id).toBe('markdown')
    expect(routeExtractor('x.markdown').id).toBe('markdown')
    expect(routeExtractor('x.html').id).toBe('markdown')
  })
  it('routes plaintext family', () => {
    expect(routeExtractor('x.txt').id).toBe('plaintext')
    expect(routeExtractor('x.csv').id).toBe('plaintext')
  })
  it('routes images', () => {
    expect(routeExtractor('x.png').id).toBe('image')
    expect(routeExtractor('x.JPG').id).toBe('image')
  })
  it('falls back to plaintext for unknown', () => {
    expect(routeExtractor('x.xyz').id).toBe('plaintext')
    expect(isKnownExt('x.xyz')).toBe(false)
    expect(isKnownExt('x.pdf')).toBe(true)
  })
})
