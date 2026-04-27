/**
 * xlsxExtractor.test.ts —— xlsx 行级聚合
 * 相关 bug：
 *   - BUG-xlsx-01（2026-04-24 · 0 chunks + 文件名乱码）
 *   - BUG-xlsx-02（2026-04-24 · 短行被 textHygiene.isBadChunk 全部过滤）
 *
 * 覆盖三条路径：
 *   A · 正常 AST（多 sheet，行聚合成 ~500 字 paragraph chunk）
 *   B · AST 空，降级到 toText() 聚合 split
 *   C · 仍 0 chunks → 抛错让 job 走 failed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const parseOfficeMock = vi.fn()
vi.mock('officeparser', () => ({
  parseOffice: (buf: Buffer, cfg: unknown) => parseOfficeMock(buf, cfg),
  default: { parseOffice: (buf: Buffer, cfg: unknown) => parseOfficeMock(buf, cfg) },
}))

function makeRow(cells: string[]) {
  return {
    type: 'row',
    children: cells.map((t) => ({ type: 'cell', text: t, children: [{ type: 'text', text: t }] })),
  }
}

describe('xlsxExtractor', () => {
  beforeEach(() => { parseOfficeMock.mockReset() })
  afterEach(() => { vi.resetModules() })

  it('A · 基本：每 sheet 一条 heading + 行聚合成 paragraph chunk', async () => {
    parseOfficeMock.mockResolvedValue({
      type: 'xlsx',
      content: [{
        type: 'sheet',
        metadata: { sheetName: '销售明细' },
        children: [
          makeRow(['日期', '销售额', '地区']),
          makeRow(['2026-01', '120000', '华东']),
          makeRow(['2026-02', '135000', '华南']),
        ],
      }],
      toText: () => '',
    })

    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    const out = await xlsxExtractor.extract(Buffer.from('x'), 'sales.xlsx')

    expect(out.extractorId).toBe('xlsx')
    // 1 heading + 1 聚合 paragraph（3 行共约 60 字，不超过 500 目标，合成一块）
    expect(out.chunks.length).toBe(2)
    expect(out.chunks[0]).toMatchObject({ kind: 'heading', text: 'Sheet: 销售明细' })
    expect(out.chunks[1].kind).toBe('paragraph')
    // paragraph 体内容自洽：带 sheet 前缀 + 所有行用 \n 分隔
    const body = out.chunks[1].text
    expect(body).toMatch(/^Sheet: 销售明细\n/)
    expect(body).toContain('日期 | 销售额 | 地区')
    expect(body).toContain('2026-01 | 120000 | 华东')
    expect(body).toContain('2026-02 | 135000 | 华南')
  })

  it('A · 大表按 ~500 字自动切成多个 chunk', async () => {
    // 40 行，每行约 30 字（cell1 + cell2 + cell3），预计切成 2~3 块
    const rows = []
    for (let i = 1; i <= 40; i++) {
      rows.push(makeRow([`问题${i}描述较长文字`, `答案${i}`, `分类${i}`]))
    }
    parseOfficeMock.mockResolvedValue({
      type: 'xlsx',
      content: [{ type: 'sheet', metadata: { sheetName: 'S' }, children: rows }],
      toText: () => '',
    })

    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    const out = await xlsxExtractor.extract(Buffer.from('x'), 't.xlsx')
    const paragraphs = out.chunks.filter(c => c.kind === 'paragraph')
    // 至少切成 2 块（40 行 × ~30 字 = ~1200 字，目标 500）
    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    // 每块都 ≥ MIN_CHUNK_CHARS=20（保证过 textHygiene）
    paragraphs.forEach(p => expect(p.text.length).toBeGreaterThanOrEqual(20))
    // 每块都以 `Sheet: S\n` 开头（语义自洽）
    paragraphs.forEach(p => expect(p.text).toMatch(/^Sheet: S\n/))
  })

  it('A · 多 sheet + 空行过滤', async () => {
    parseOfficeMock.mockResolvedValue({
      type: 'xlsx',
      content: [
        { type: 'sheet', metadata: { sheetName: 'S1' }, children: [
          makeRow(['Row1 content long enough']),
          makeRow(['', ' ']),                  // 全空
          makeRow(['Row2 content long enough']),
        ]},
        { type: 'sheet', metadata: { sheetName: 'S2' }, children: [
          makeRow(['Row3 content long enough']),
        ]},
      ],
      toText: () => '',
    })

    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    const out = await xlsxExtractor.extract(Buffer.from('x'), 't.xlsx')
    // S1 heading + S1 paragraph + S2 heading + S2 paragraph = 4
    const kinds = out.chunks.map(c => c.kind)
    expect(kinds).toEqual(['heading', 'paragraph', 'heading', 'paragraph'])
    // S1 的 paragraph 应该包含 Row1 和 Row2，但不包含空行
    const s1Body = out.chunks[1].text
    expect(s1Body).toContain('Row1')
    expect(s1Body).toContain('Row2')
  })

  it('B · AST 空 → 降级到 toText() 聚合 split', async () => {
    parseOfficeMock.mockResolvedValue({
      type: 'xlsx',
      content: [],
      toText: () => 'first line content\nsecond line content\nthird line content',
    })

    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    const out = await xlsxExtractor.extract(Buffer.from('x'), 't.xlsx')
    // 总字数 < 500，合成 1 块
    const paragraphs = out.chunks.filter(c => c.kind === 'paragraph')
    expect(paragraphs.length).toBe(1)
    expect(paragraphs[0].text).toContain('first line content')
    expect(paragraphs[0].text).toContain('third line content')
    expect(out.warnings.some(w => w.includes('AST empty'))).toBe(true)
  })

  it('C · 0 chunks 抛错（不再静默"完成"）', async () => {
    parseOfficeMock.mockResolvedValue({
      type: 'xlsx',
      content: [],
      toText: () => '',
    })

    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    await expect(xlsxExtractor.extract(Buffer.from('x'), 't.xlsx'))
      .rejects.toThrow(/yielded no chunks/)
  })

  it('C · officeparser 自身抛错', async () => {
    parseOfficeMock.mockRejectedValue(new Error('corrupt zip'))
    const { xlsxExtractor } = await import('../services/ingestPipeline/extractors/officeFamily.ts')
    await expect(xlsxExtractor.extract(Buffer.from('x'), 't.xlsx'))
      .rejects.toThrow(/officeparser xlsx failed/)
  })
})
