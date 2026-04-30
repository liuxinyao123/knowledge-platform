/**
 * kbMetaHandler · D-002.2 · 直查 metadata_asset 目录
 *
 * 覆盖：
 *   1. isObviousKbMeta · 命中 ≥ 8 case
 *   2. isObviousKbMeta · 不误伤 ≥ 7 case（关键回归：D003-cn-fact 不能被抢）
 *   3. extractKbMetaKeywords · 抽词正确 + 类型词不当关键词
 *   4. queryAssetCatalog · keywords 空走全列；非空生成 ILIKE ANY；DB 错回 []
 *   5. renderKbMetaAnswer · 0 候选 / ≤ 10 / > 10 三分支 + LLM 失败兜底
 *   6. runKbMetaHandler · 完整 SSE 序列；omitDoneAndTrace + omitIntentEmit 行为
 *   7. isKbMetaHandlerEnabled · env 默认 on / false 关闭
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SseEvent } from '../ragTypes.ts'

// ── mocks ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn()
const mockChatComplete = vi.fn()
let mockLlmConfigured = true

vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: (...args: unknown[]) => mockQuery(...args) }),
}))

vi.mock('../services/llm.ts', () => ({
  chatComplete: (...args: unknown[]) => mockChatComplete(...args),
  getLlmFastModel: vi.fn().mockReturnValue('mock-fast'),
  isLlmConfigured: () => mockLlmConfigured,
}))

import {
  isObviousKbMeta,
  extractKbMetaKeywords,
  queryAssetCatalog,
  renderKbMetaAnswer,
  runKbMetaHandler,
  isKbMetaHandlerEnabled,
} from '../services/kbMetaHandler.ts'

beforeEach(() => {
  mockQuery.mockReset()
  mockChatComplete.mockReset()
  mockLlmConfigured = true
  delete process.env.KB_META_HANDLER_ENABLED
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── 1. isObviousKbMeta · 命中 ───────────────────────────────────────────────

describe('isObviousKbMeta · 命中', () => {
  const HITS = [
    '我这库里有道德经吗',
    '知识库中包不包含 LFTGATE 的资料',
    '库里有没有汽车工程相关的资料',
    '列出所有 pdf 文档',
    '找一下汽车制造相关的文件',
    '有哪些跟尾门设计相关的资料',
    'list documents about cars',
    'do you have any documents on liftgate design',
  ]
  for (const q of HITS) {
    it(`命中: "${q}"`, () => expect(isObviousKbMeta(q)).toBe(true))
  }
})

// ── 2. isObviousKbMeta · 不误伤 ─────────────────────────────────────────────

describe('isObviousKbMeta · 不误伤', () => {
  const MISSES = [
    '知识中台的核心模块有哪些',  // ★ D003-cn-fact 关键回归（factual_lookup 不该被抢）
    '道德经的作者是谁',           // factual_lookup（"X 的作者"是属性查询）
    'LFTGATE 的间隙参数',         // factual_lookup
    '翻译第一章',                  // language_op
    '总结一下要点',                // language_op
    '为什么作者要这么写',           // out_of_scope
    'alpha angle and beta angle clearance requirements',  // factual_lookup
  ]
  for (const q of MISSES) {
    it(`不误伤: "${q}"`, () => expect(isObviousKbMeta(q)).toBe(false))
  }
  it('过长输入（>200 字符） → false', () => {
    expect(isObviousKbMeta('a'.repeat(201))).toBe(false)
  })
  it('空字符串 → false', () => {
    expect(isObviousKbMeta('')).toBe(false)
    expect(isObviousKbMeta('  ')).toBe(false)
  })
})

// ── 3. extractKbMetaKeywords ────────────────────────────────────────────────

describe('extractKbMetaKeywords', () => {
  it('"我这库里有道德经吗" → ["道德经"]', () => {
    expect(extractKbMetaKeywords('我这库里有道德经吗')).toEqual(['道德经'])
  })
  it('"列出汽车工程相关的资料" → 含 "汽车工程"', () => {
    const out = extractKbMetaKeywords('列出汽车工程相关的资料')
    expect(out).toContain('汽车工程')
  })
  it('"列出所有 pdf 文档" → 类型词 pdf 不当关键词', () => {
    const out = extractKbMetaKeywords('列出所有 pdf 文档')
    expect(out).not.toContain('pdf')
    // "所有"是停用词；"文档"是后缀剥掉了 → 剩空数组（合法："列全部"语义）
  })
  it('英文 "find documents about cars" → ["cars"]', () => {
    const out = extractKbMetaKeywords('find documents about cars')
    expect(out).toContain('cars')
  })
  it('空输入 → []', () => {
    expect(extractKbMetaKeywords('')).toEqual([])
  })
})

// ── 4. queryAssetCatalog ────────────────────────────────────────────────────

describe('queryAssetCatalog', () => {
  it('keywords 空 → 不加 name filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await queryAssetCatalog({ keywords: [], limit: 10 })
    const sql = String(mockQuery.mock.calls[0][0])
    expect(sql).not.toContain('name ILIKE')
    expect(sql).toContain('FROM metadata_asset')
    expect(sql).toContain('LIMIT 10')
  })
  it('keywords 非空 → 生成 ILIKE ANY (unnest)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await queryAssetCatalog({ keywords: ['道德经'] })
    const sql = String(mockQuery.mock.calls[0][0])
    const params = mockQuery.mock.calls[0][1]
    expect(sql).toContain('name ILIKE ANY')
    expect(sql).toContain('unnest($1::text[])')
    expect(params[0]).toEqual(['道德经'])
  })
  it('assetIds 非空 → 加 id = ANY 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await queryAssetCatalog({ keywords: [], assetIds: [1, 2, 3] })
    const sql = String(mockQuery.mock.calls[0][0])
    expect(sql).toContain('id = ANY($1::int[])')
  })
  it('DB 错 → 返回 [] 不抛', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'))
    const out = await queryAssetCatalog({ keywords: ['x'] })
    expect(out).toEqual([])
  })
  it('limit 边界 · 上限 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await queryAssetCatalog({ keywords: [], limit: 999 })
    expect(String(mockQuery.mock.calls[0][0])).toContain('LIMIT 200')
  })
})

// ── 5. renderKbMetaAnswer ───────────────────────────────────────────────────

const fakeRow = (id: number, name: string, type = 'pdf') => ({
  id, name, type,
  indexed_at: '2026-04-25',
  tags: null,
})

describe('renderKbMetaAnswer', () => {
  it('0 候选 → 拒答 + 引导', async () => {
    const out = await renderKbMetaAnswer({
      question: '我这库里有道德经吗',
      candidates: [],
      signal: new AbortController().signal,
    })
    expect(out).toContain('似乎没有')
    expect(out).toContain('资产目录')
  })
  it('≤ 10 候选 → 直接 markdown 列表', async () => {
    const out = await renderKbMetaAnswer({
      question: '汽车文档',
      candidates: [fakeRow(1, '道德经.md'), fakeRow(2, 'LFTGATE-32.pdf')],
      signal: new AbortController().signal,
    })
    expect(out).toMatch(/找到以下/)
    expect(out).toContain('道德经.md')
    expect(out).toContain('LFTGATE-32.pdf')
    expect(mockChatComplete).not.toHaveBeenCalled()
  })
  it('> 10 候选且 LLM 配置 OK → 调 LLM 语义筛 (v2-A: 2 次并发)', async () => {
    // v2-A: N=2 LLM 调用. 两次都返 "1, 3, 5" → 并集仍 [1,3,5]
    mockChatComplete.mockResolvedValue({ content: '1, 3, 5', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X 相关', candidates: cands, signal: new AbortController().signal,
    })
    expect(mockChatComplete).toHaveBeenCalledTimes(2)   // v2-A: 2 次
    expect(out).toContain('doc1.pdf')
    expect(out).toContain('doc3.pdf')
    expect(out).toContain('doc5.pdf')
    expect(out).not.toContain('doc7.pdf')
  })
  it('> 10 候选 + 两次 LLM 都抛 → 退化前 8 条', async () => {
    // v2-A: callOnce 内 catch 单次失败返 '' 不抛; Promise.all 整体不会被单次 reject
    // 但用 mockRejectedValue 测试两次都抛 → 内部 callOnce 都返 '' → allNums=[] + 两次都非 '0'
    // → fallbackMarkdownList(candidates)
    mockChatComplete.mockRejectedValue(new Error('llm timeout'))
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X', candidates: cands, signal: new AbortController().signal,
    })
    expect(out).toMatch(/找到以下/)
    expect(out).toContain('doc1.pdf')
  })
  it('> 10 候选 + 两次 LLM 都说全无关 (输出 "0") → 拒答', async () => {
    // v2-A: 两次都返 "0" 才走 emptyAnswer (单次 "0" 不算)
    mockChatComplete.mockResolvedValue({ content: '0', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: '完全不沾边的问题', candidates: cands, signal: new AbortController().signal,
    })
    expect(out).toContain('似乎没有')
  })
  it('LLM 未配置 → 直接退化 fallback list（不调 LLM）', async () => {
    mockLlmConfigured = false
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X', candidates: cands, signal: new AbortController().signal,
    })
    expect(mockChatComplete).not.toHaveBeenCalled()
    expect(out).toContain('doc1.pdf')
  })

  // D-002.5 · V3D 修复 · 0 < picks < 3 时代码兜底补齐到 ≥ 3 条
  it('> 10 候选 + 两次 LLM 都只挑 1 条 → 代码兜底补齐到 ≥ 3 条（V3D 修复）', async () => {
    mockChatComplete.mockResolvedValue({ content: '4', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: '汽车工程相关的资料',
      candidates: cands,
      signal: new AbortController().signal,
    })
    // 两次都返 "4" → 并集 [4] → picked=[doc4] → 补 doc1, doc2 → 共 3 条
    expect(out).toContain('doc4.pdf')
    expect(out).toContain('doc1.pdf')
    expect(out).toContain('doc2.pdf')
    expect(out).not.toContain('doc5.pdf')
    expect(out).not.toContain('似乎没有')
  })
  // D-002.5 v2-A · self-consistency 核心 case: 两次 LLM 互补
  it('v2-A: 两次 LLM 互补 → picks 并集扩 (run1 选 [1], run2 选 [5])', async () => {
    // 第一次 temperature=0.1 选 [1], 第二次 temperature=0.5 选 [5] (LFTGATE-32 类边界 candidate)
    mockChatComplete
      .mockResolvedValueOnce({ content: '1', toolCalls: [] })
      .mockResolvedValueOnce({ content: '5', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X 相关', candidates: cands, signal: new AbortController().signal,
    })
    // 并集 [1, 5] → picked=[doc1, doc5] → 补 doc2 (1 已用) → [1, 5, 2]
    expect(out).toContain('doc1.pdf')
    expect(out).toContain('doc5.pdf')
    expect(out).toContain('doc2.pdf')
    expect((out.match(/doc1\.pdf/g) || []).length).toBe(1)   // 去重
  })
  it('v2-A: 一次 LLM 抛 + 一次返结果 → 仍接受未抛的 picks', async () => {
    // 模拟单次失败: 第一次抛, 第二次成功
    mockChatComplete
      .mockRejectedValueOnce(new Error('llm timeout'))
      .mockResolvedValueOnce({ content: '7', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X', candidates: cands, signal: new AbortController().signal,
    })
    // 第一次内部 catch 返 '' → nums1=[]; 第二次 nums2=[7] → 并集 [7] → 补 doc1, doc2 → [7, 1, 2]
    expect(out).toContain('doc7.pdf')
    expect(out).toContain('doc1.pdf')
    expect(out).toContain('doc2.pdf')
  })
  it('v2-A: 两次都说 "0" 才 emptyAnswer (单次 "0" 不触发)', async () => {
    // 边界: 一次 "0" + 一次 "5" → 不应 emptyAnswer
    mockChatComplete
      .mockResolvedValueOnce({ content: '0', toolCalls: [] })
      .mockResolvedValueOnce({ content: '5', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X', candidates: cands, signal: new AbortController().signal,
    })
    // nums1=[] (0 滤掉) + nums2=[5] → 并集 [5] → picked=[doc5] → 补 doc1, doc2
    expect(out).not.toContain('似乎没有')
    expect(out).toContain('doc5.pdf')
    expect(out).toContain('doc1.pdf')
  })
  it('> 10 候选 + 两次 LLM 都输出乱码 → 退化前 8 条（不走 emptyAnswer）', async () => {
    mockChatComplete.mockResolvedValue({ content: 'asdjkl 不是数字', toolCalls: [] })
    const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
    const out = await renderKbMetaAnswer({
      question: 'X', candidates: cands, signal: new AbortController().signal,
    })
    expect(out).not.toContain('似乎没有')
    expect(out).toContain('doc1.pdf')
  })
})

// ── 6. runKbMetaHandler · 完整编排 ──────────────────────────────────────────

describe('runKbMetaHandler', () => {
  it('完整 SSE 序列：📚 → 🔑 → 📋 → 🎭 → content → trace → done', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [fakeRow(20, '道德经.md', 'markdown')],
    })
    const events: SseEvent[] = []
    const ac = new AbortController()
    await runKbMetaHandler('我这库里有道德经吗', (e) => events.push(e), ac.signal)

    const icons = events
      .filter((e) => e.type === 'rag_step')
      .map((e) => (e as { icon: string }).icon)
    expect(icons).toEqual(['📚', '🔑', '📋', '🎭'])

    const types = events.map((e) => e.type)
    expect(types).toContain('content')
    expect(types).toContain('trace')
    expect(types[types.length - 1]).toBe('done')

    const content = events.find((e) => e.type === 'content') as { text: string }
    expect(content.text).toContain('道德经.md')
  })

  it('omitDoneAndTrace=true → 不 emit trace + done（caller 自己 emit）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow(1, 'a.pdf')] })
    const events: SseEvent[] = []
    await runKbMetaHandler(
      '库里有 a 吗', (e) => events.push(e), new AbortController().signal,
      { omitDoneAndTrace: true },
    )
    expect(events.find((e) => e.type === 'trace')).toBeUndefined()
    expect(events.find((e) => e.type === 'done')).toBeUndefined()
    expect(events.find((e) => e.type === 'content')).toBeDefined()
  })

  it('omitIntentEmit=true → 不 emit 🎭', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow(1, 'a.pdf')] })
    const events: SseEvent[] = []
    await runKbMetaHandler(
      '库里有 a 吗', (e) => events.push(e), new AbortController().signal,
      { omitIntentEmit: true },
    )
    const icons = events
      .filter((e) => e.type === 'rag_step')
      .map((e) => (e as { icon: string }).icon)
    expect(icons).not.toContain('🎭')
  })

  it('signal aborted → 早返回，不 emit content/done', async () => {
    const ac = new AbortController()
    ac.abort()
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow(1, 'a.pdf')] })
    const events: SseEvent[] = []
    await runKbMetaHandler('库里有 a 吗', (e) => events.push(e), ac.signal)
    expect(events.find((e) => e.type === 'content')).toBeUndefined()
    expect(events.find((e) => e.type === 'done')).toBeUndefined()
  })

  it('V3D 修复：keywords 非空但 SQL 0 命中 → 退化全库再查（emit 🔄）', async () => {
    // 第一次 query 用 keywords → 返回 0 行
    mockQuery.mockResolvedValueOnce({ rows: [] })
    // 第二次 query 退化（无 keywords） → 返回 12 行模拟全库
    const fullList = Array.from({ length: 12 }, (_, i) => fakeRow(100 + i, `LFTGATE-${i}.pdf`))
    mockQuery.mockResolvedValueOnce({ rows: fullList })
    // v2-A: 12 > 10 触发 LLM 语义筛 N=2 self-consistency, 两次都返同样 picks
    mockChatComplete.mockResolvedValue({ content: '1, 2, 3', toolCalls: [] })

    const events: SseEvent[] = []
    await runKbMetaHandler(
      '库里有哪些汽车工程相关的资料',
      (e) => events.push(e),
      new AbortController().signal,
    )

    // 必须 emit 🔄 退化标记
    const icons = events.filter((e) => e.type === 'rag_step').map((e) => (e as { icon: string }).icon)
    expect(icons).toContain('🔄')

    // 必须真的查了两次 DB
    expect(mockQuery).toHaveBeenCalledTimes(2)

    // 答案必须含 LFTGATE 文件名 + .pdf 后缀
    const content = events.find((e) => e.type === 'content') as { text: string }
    expect(content.text).toContain('LFTGATE')
    expect(content.text).toContain('.pdf')
    expect(content.text).toMatch(/找到以下/)
  })
})

// ── 7. isKbMetaHandlerEnabled ──────────────────────────────────────────────

describe('isKbMetaHandlerEnabled', () => {
  it('默认 → true', () => expect(isKbMetaHandlerEnabled()).toBe(true))
  it('=false → false', () => {
    process.env.KB_META_HANDLER_ENABLED = 'false'
    expect(isKbMetaHandlerEnabled()).toBe(false)
  })
  it('=0 / off / no → false', () => {
    for (const v of ['0', 'off', 'no']) {
      process.env.KB_META_HANDLER_ENABLED = v
      expect(isKbMetaHandlerEnabled()).toBe(false)
    }
  })
  it('=true / on → true', () => {
    process.env.KB_META_HANDLER_ENABLED = 'true'
    expect(isKbMetaHandlerEnabled()).toBe(true)
  })
})
