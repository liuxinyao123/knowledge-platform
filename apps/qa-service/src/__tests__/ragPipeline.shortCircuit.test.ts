/**
 * H3 short-circuit · top-1 relevance 低于 NO_LLM_THRESHOLD 时跳过 LLM，直接兜底。
 * 对应 ADR 2026-04-23-22 · D-007（补丁）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EmitFn, SseEvent } from '../ragTypes.ts'
import type { AssetChunk } from '../services/knowledgeSearch.ts'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockChatStream = vi.fn(async function* () { yield 'should-not-be-called' })
const mockSearchChunks = vi.fn()
const mockRerank = vi.fn()
const mockIsRerankerConfigured = vi.fn().mockReturnValue(true)
const mockRerankerModel = vi.fn().mockReturnValue('bge-test')

// ragPipeline 的 gradeDocs / rewriteQuestion 都会 `await chatComplete(...)` 后解构 { toolCalls }。
// 默认必须给一个形状合法的返回，否则 rewriteQuestion 第 1 行就 "Cannot destructure property 'toolCalls' of undefined"。
const mockChatComplete = vi.fn().mockResolvedValue({
  content: '',
  toolCalls: [],
  rawMessage: { role: 'assistant', content: null },
})

vi.mock('../services/llm.ts', () => ({
  chatComplete: mockChatComplete,
  chatStream: mockChatStream,
  isLlmConfigured: vi.fn().mockReturnValue(true),
  getLlmFastModel: vi.fn().mockReturnValue('mock-fast'),
  getLlmModel: vi.fn().mockReturnValue('mock-main'),
}))

vi.mock('../services/knowledgeSearch.ts', () => ({
  searchKnowledgeChunks: (...args: unknown[]) => mockSearchChunks(...args),
  EmbeddingNotConfiguredError: class extends Error {},
}))

vi.mock('../services/reranker.ts', () => ({
  rerank: (...args: unknown[]) => mockRerank(...args),
  isRerankerConfigured: () => mockIsRerankerConfigured(),
  rerankerModel: () => mockRerankerModel(),
}))

vi.mock('../services/dataAdminAgent.ts', () => ({
  isDataAdminQuestion: vi.fn().mockReturnValue(false),
  runDataAdminPipeline: vi.fn(),
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

function collectEvents(): { events: SseEvent[]; emit: EmitFn } {
  const events: SseEvent[] = []
  const emit: EmitFn = (e) => events.push(e)
  return { events, emit }
}

function makeChunks(scores: number[]): AssetChunk[] {
  return scores.map((s, i) => ({
    asset_id: i + 1,
    asset_name: `A${i + 1}`,
    chunk_content: `content ${i + 1}`,
    score: s,
    metadata: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsRerankerConfigured.mockReturnValue(true)
  // vi.clearAllMocks() 会清掉 mockResolvedValue 的默认值，这里必须重置
  mockChatComplete.mockResolvedValue({
    content: '',
    toolCalls: [],
    rawMessage: { role: 'assistant', content: null },
  })
  delete process.env.RAG_NO_LLM_THRESHOLD
})

describe('runRagPipeline · H3 short-circuit', () => {
  it('top-1 < 0.05 且 reranker 开 → 不调 chatStream，直接兜底 content + done', async () => {
    mockSearchChunks.mockResolvedValue(makeChunks([0.9, 0.8, 0.7]))  // 初始召回（向量分）
    // rerank 把所有打回超低分（模拟库里全是乱码）
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.0002 },
      { index: 1, score: 0.0001 },
      { index: 2, score: 0.00005 },
    ])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { events, emit } = collectEvents()
    await runRagPipeline('knowledge graph', [], emit, new AbortController().signal)

    // 核心断言：chatStream 没被调
    expect(mockChatStream).not.toHaveBeenCalled()

    // short-circuit rag_step 被 emit
    const rs = events.filter((e) => e.type === 'rag_step')
    expect(rs.some((e) => 'label' in e && /跳过 LLM/.test(e.label as string))).toBe(true)

    // 兜底 content 事件出现
    const contentText = events.filter((e) => e.type === 'content')
      .map((e) => ('text' in e ? e.text : '')).join('')
    expect(contentText).toContain('暂时没有')
    expect(contentText).toContain('可能原因')

    // trace + done 都 emit
    expect(events.some((e) => e.type === 'trace')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('top-1 ≥ 0.05 → 正常走 chatStream（不 short-circuit）', async () => {
    mockSearchChunks.mockResolvedValue(makeChunks([0.9, 0.8, 0.7]))
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.3 },
    ])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { emit } = collectEvents()
    await runRagPipeline('q', [], emit, new AbortController().signal)

    expect(mockChatStream).toHaveBeenCalledTimes(1)
  })

  it('reranker 关 → 即使 top-1 低也不 short-circuit（向量原始分不可比）', async () => {
    mockIsRerankerConfigured.mockReturnValue(false)
    // 没 rerank 时 finalDocs[0].score 是向量相似度（可能天然就低）
    mockSearchChunks.mockResolvedValue(makeChunks([0.01, 0.005]))

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { emit } = collectEvents()
    await runRagPipeline('q', [], emit, new AbortController().signal)

    expect(mockChatStream).toHaveBeenCalledTimes(1)
  })

  it('env RAG_NO_LLM_THRESHOLD 可覆盖阈值', async () => {
    process.env.RAG_NO_LLM_THRESHOLD = '0.5'   // 严到 0.5
    // retrieveInitial 里 `filtered.length <= 1` 会跳过 rerank，必须给 2+ 条才能让 rerank 分数生效
    mockSearchChunks.mockResolvedValue(makeChunks([0.9, 0.85]))
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.3 },   // 0.3 < 0.5（env 阈值）
      { index: 1, score: 0.2 },
    ])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { emit } = collectEvents()
    await runRagPipeline('q', [], emit, new AbortController().signal)

    // 0.3 在默认 0.05 下不会 short-circuit；但 env=0.5 下会
    expect(mockChatStream).not.toHaveBeenCalled()
  })

  it('env RAG_NO_LLM_THRESHOLD 非法（非数字）→ 回落 0.05', async () => {
    process.env.RAG_NO_LLM_THRESHOLD = 'bogus'
    mockSearchChunks.mockResolvedValue(makeChunks([0.9]))
    mockRerank.mockResolvedValue([{ index: 0, score: 0.3 }])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { emit } = collectEvents()
    await runRagPipeline('q', [], emit, new AbortController().signal)

    expect(mockChatStream).toHaveBeenCalledTimes(1)   // 0.3 ≥ 0.05，正常走
  })

  // D-008 · 用户显式 scope（notebook 绑 sources）→ 不 short-circuit，即使 top-1 很低
  it('opts.assetIds 非空 + top-1 超低 → 仍调 chatStream（跳过阈值短路）', async () => {
    mockSearchChunks.mockResolvedValue(makeChunks([0.9, 0.8, 0.7]))
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.017 },  // 对应 notebook 里合成类查询的典型分数
      { index: 1, score: 0.013 },
      { index: 2, score: 0.011 },
    ])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { events, emit } = collectEvents()
    await runRagPipeline('根据资料给我产出测试要求', [], emit, new AbortController().signal, {
      assetIds: [101, 102, 103],
    })

    // 核心断言：chatStream 被调（不短路）
    expect(mockChatStream).toHaveBeenCalledTimes(1)

    // 解释性 rag_step 应该 emit
    const rs = events.filter((e) => e.type === 'rag_step')
    expect(rs.some((e) => 'label' in e && /用户显式 scope/.test(e.label as string))).toBe(true)

    // 兜底 content 不应出现
    const contentText = events.filter((e) => e.type === 'content')
      .map((e) => ('text' in e ? e.text : '')).join('')
    expect(contentText).not.toContain('暂时没有')
  })

  it('opts.assetIds 空数组 → 视为全局，继续 short-circuit', async () => {
    // retrieveInitial 里 `filtered.length <= 1` 会跳过 rerank，必须给 2+ 条才能让 rerank 分数生效
    mockSearchChunks.mockResolvedValue(makeChunks([0.9, 0.85]))
    mockRerank.mockResolvedValue([
      { index: 0, score: 0.001 },  // < 0.05 默认阈值 → 短路
      { index: 1, score: 0.0005 },
    ])

    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const { emit } = collectEvents()
    await runRagPipeline('q', [], emit, new AbortController().signal, { assetIds: [] })

    expect(mockChatStream).not.toHaveBeenCalled()
  })
})
