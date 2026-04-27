import { describe, it, expect, beforeEach } from 'vitest'
import { checkJava, isJavaAvailable, resetJavaCheck } from '../services/pdfPipeline/javaCheck.ts'

describe('javaCheck', () => {
  beforeEach(() => resetJavaCheck())

  it('detects java availability without throwing', () => {
    const r = checkJava()
    expect(typeof r.ok).toBe('boolean')
    if (r.ok) {
      expect(r.version).toMatch(/version/i)
      expect(isJavaAvailable()).toBe(true)
    } else {
      expect(r.version).toBe('')
      expect(isJavaAvailable()).toBe(false)
    }
  })

  it('caches result; second call returns same', () => {
    const a = checkJava()
    const b = checkJava()
    expect(a.ok).toBe(b.ok)
    expect(a.version).toBe(b.version)
  })
})
