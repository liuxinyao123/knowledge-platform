import { describe, it, expect, vi } from 'vitest'
import { plaintextExtractor } from '../services/ingestPipeline/extractors/plaintext.ts'
import { docxExtractor } from '../services/ingestPipeline/extractors/docx.ts'
import { markdownExtractor } from '../services/ingestPipeline/extractors/markdown.ts'

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(async () => ({
    value: '段落1\n\n段落2\n\n段落3',
    messages: [{ type: 'warning', message: 'unknown element' }],
  })),
}))

describe('plaintextExtractor', () => {
  it('short text → single generic chunk', async () => {
    const r = await plaintextExtractor.extract(Buffer.from('hello'), 'a.txt')
    expect(r.extractorId).toBe('plaintext')
    expect(r.chunks).toHaveLength(1)
    expect(r.chunks[0].kind).toBe('generic')
    expect(r.fullText).toBe('hello')
  })
  it('empty buffer → no chunks', async () => {
    const r = await plaintextExtractor.extract(Buffer.from(''), 'a.txt')
    expect(r.chunks).toHaveLength(0)
  })
  it('long text → multiple generic chunks via chunkText', async () => {
    // 3000 字符的长文本
    const longText = ('段落内容句子 '.repeat(60) + '\n\n').repeat(10)
    expect(longText.length).toBeGreaterThan(500)
    const r = await plaintextExtractor.extract(Buffer.from(longText), 'page.txt')
    expect(r.extractorId).toBe('plaintext')
    expect(r.chunks.length).toBeGreaterThan(1)
    expect(r.chunks.every((c) => c.kind === 'generic')).toBe(true)
  })
})

describe('docxExtractor', () => {
  it('splits paragraphs and surfaces warnings', async () => {
    const r = await docxExtractor.extract(Buffer.from('x'), 'spec.docx')
    expect(r.extractorId).toBe('docx')
    expect(r.chunks.map((c) => c.text)).toEqual(['段落1', '段落2', '段落3'])
    expect(r.warnings.some((w) => /mammoth/.test(w))).toBe(true)
  })
})

describe('markdownExtractor', () => {
  it('parses headings and nested structure', async () => {
    const md = [
      '# Title',
      '',
      '## Section A',
      '',
      'body of A',
      '',
      '### Sub',
      '',
      'body of Sub',
      '',
      '## Section B',
      '',
      'body of B',
    ].join('\n')
    const r = await markdownExtractor.extract(Buffer.from(md), 'x.md')
    const headings = r.chunks.filter((c) => c.kind === 'heading')
    expect(headings).toHaveLength(4)
    expect(headings[0].headingLevel).toBe(1)
    expect(headings[1].headingLevel).toBe(2)
    expect(headings[2].headingLevel).toBe(3)

    // headingPath 应该分层累积
    const sub = r.chunks.find((c) => c.text === 'Sub')!
    expect(sub.headingPath).toBe('Title / Section A / Sub')

    const bodyOfSub = r.chunks.find((c) => c.text === 'body of Sub')!
    expect(bodyOfSub.headingPath).toBe('Title / Section A / Sub')

    // Section B 下 headingPath 只剩两层
    const bodyOfB = r.chunks.find((c) => c.text === 'body of B')!
    expect(bodyOfB.headingPath).toBe('Title / Section B')
  })
})
