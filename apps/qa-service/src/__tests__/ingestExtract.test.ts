import { describe, it, expect } from 'vitest'
import { extractDocument } from '../services/ingestExtract.ts'

describe('ingestExtract', () => {
  it('returns utf-8 text for .txt', async () => {
    const out = await extractDocument('note.txt', Buffer.from('hello 世界', 'utf8'))
    expect(out.kind).toBe('text')
    if (out.kind === 'text') expect(out.text).toBe('hello 世界')
  })

  it('rejects unknown extension', async () => {
    await expect(extractDocument('x.exe', Buffer.from('a'))).rejects.toThrow(/不支持/)
  })
})
