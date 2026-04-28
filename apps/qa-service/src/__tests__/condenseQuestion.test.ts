/**
 * condenseQuestion · follow-up 改写
 *
 * 覆盖：
 *   1. history 为空 → 不调 LLM，原样返回
 *   2. 触发条件不满足（长且无指代/元词）→ 不调 LLM
 *   3. 短问题 + 非空 history → 改写并 emit rag_step
 *   4. 含代词（这本/它）→ 改写
 *   5. 含元词（原文/解释一下）→ 改写
 *   6. env RAG_CONDENSE_QUESTION_ENABLED=false → 强制跳过
 *   7. LLM 抛异常 → 静默回落原句，不阻塞
 *   8. LLM 返回空 / 等于原句 / 超长 → 回落原句，不 emit
 *   9. 引号包裹 / "改写后：" 前缀清理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmitFn, SseEvent, HistoryMessage } from '../ragTypes.ts'

const mockChatComplete = vi.fn()
vi.mock('../services/llm.ts', () => ({
  chatComplete: (...args: unknown[]) => mockChatComplete(...args),
  getLlmFastModel: vi.fn().mockReturnValue('mock-fast'),
}))

import { condenseQuestion, looksLikeFollowUp, isCondenseEnabled } from '../services/condenseQuestion.ts'

function collectEvents(): { events: SseEvent[]; emit: EmitFn } {
  const events: SseEvent[] = []
  const emit: EmitFn = (e) => events.push(e)
  return { events, emit }
}

const HISTORY: HistoryMessage[] = [
  { role: 'user', content: '道德经是谁写的' },
  { role: 'assistant', content: '《道德经》的作者是老子。' },
  { role: 'user', content: '你给我道德经第一章的内容' },
  { role: 'assistant', content: '道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母。' },
]

describe('looksLikeFollowUp', () => {
  it('短问题（≤12 字）触发', () => {
    expect(looksLikeFollowUp('原文')).toBe(true)
    expect(looksLikeFollowUp('那你把原文发我')).toBe(true)
    expect(looksLikeFollowUp('给我解释一下')).toBe(true)
  })

  it('长且无信号词不触发', () => {
    expect(looksLikeFollowUp('道德经的作者是谁，请详细说明背景')).toBe(true) // "详细" 命中元词
    expect(looksLikeFollowUp('请告诉我世界上最长的一条河流是什么名字呢')).toBe(false)
  })

  it('含代词触发（即便长）', () => {
    expect(looksLikeFollowUp('它的作者是谁啊我想了解一下背景资料')).toBe(true)
  })

  it('含元词触发（即便长）', () => {
    expect(looksLikeFollowUp('帮我把上面那段内容翻译成英文版本好吗')).toBe(true)
  })

  it('空字符串不触发', () => {
    expect(looksLikeFollowUp('')).toBe(false)
    expect(looksLikeFollowUp('   ')).toBe(false)
  })
})

describe('isCondenseEnabled', () => {
  const origEnv = process.env.RAG_CONDENSE_QUESTION_ENABLED
  afterEach(() => {
    if (origEnv === undefined) delete process.env.RAG_CONDENSE_QUESTION_ENABLED
    else process.env.RAG_CONDENSE_QUESTION_ENABLED = origEnv
  })

  it('默认 on', () => {
    delete process.env.RAG_CONDENSE_QUESTION_ENABLED
    expect(isCondenseEnabled()).toBe(true)
  })

  it('false / 0 / off / no 全部关闭', () => {
    for (const v of ['false', '0', 'off', 'no', 'FALSE', 'Off']) {
      process.env.RAG_CONDENSE_QUESTION_ENABLED = v
      expect(isCondenseEnabled()).toBe(false)
    }
  })
})

describe('condenseQuestion', () => {
  beforeEach(() => {
    mockChatComplete.mockReset()
    delete process.env.RAG_CONDENSE_QUESTION_ENABLED
  })

  it('history 为空 → 不调 LLM，原样返回', async () => {
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('那你把原文发我', [], emit)
    expect(out).toBe('那你把原文发我')
    expect(mockChatComplete).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('触发条件不满足（长且无信号词）→ 不调 LLM', async () => {
    const { events, emit } = collectEvents()
    const longSelfContained = '请告诉我世界上最长的一条河流是什么名字呢谢谢'
    const out = await condenseQuestion(longSelfContained, HISTORY, emit)
    expect(out).toBe(longSelfContained)
    expect(mockChatComplete).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('短指代型 + 非空 history → 改写并 emit', async () => {
    mockChatComplete.mockResolvedValue({
      content: '请提供《道德经》第一章的原文',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('那你把原文发我', HISTORY, emit)
    expect(out).toBe('请提供《道德经》第一章的原文')
    expect(mockChatComplete).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'rag_step',
      icon: '🪄',
    })
    expect((events[0] as { label: string }).label).toContain('那你把原文发我')
    expect((events[0] as { label: string }).label).toContain('请提供《道德经》第一章的原文')
  })

  it('env=false → 强制跳过', async () => {
    process.env.RAG_CONDENSE_QUESTION_ENABLED = 'false'
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('原文', HISTORY, emit)
    expect(out).toBe('原文')
    expect(mockChatComplete).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('LLM 抛异常 → 静默回落原句', async () => {
    mockChatComplete.mockRejectedValue(new Error('LLM 502'))
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('给我解释一下', HISTORY, emit)
    expect(out).toBe('给我解释一下')
    expect(events).toHaveLength(0)
  })

  it('LLM 返回空字符串 → 回落原句，不 emit', async () => {
    mockChatComplete.mockResolvedValue({
      content: '   ',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('原文', HISTORY, emit)
    expect(out).toBe('原文')
    expect(events).toHaveLength(0)
  })

  it('LLM 返回与原句相同 → 不 emit', async () => {
    mockChatComplete.mockResolvedValue({
      content: '原文',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('原文', HISTORY, emit)
    expect(out).toBe('原文')
    expect(events).toHaveLength(0)
  })

  it('LLM 返回 > 200 字符 → 回落原句', async () => {
    mockChatComplete.mockResolvedValue({
      content: 'X'.repeat(201),
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('原文', HISTORY, emit)
    expect(out).toBe('原文')
    expect(events).toHaveLength(0)
  })

  it('引号包裹 / "改写后：" 前缀会被清理', async () => {
    mockChatComplete.mockResolvedValue({
      content: '改写后：「请提供《道德经》第一章的原文」',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { events, emit } = collectEvents()
    const out = await condenseQuestion('原文', HISTORY, emit)
    expect(out).toBe('请提供《道德经》第一章的原文')
    expect(events).toHaveLength(1)
  })

  it('prompt 包含历史 + 当前问题', async () => {
    mockChatComplete.mockResolvedValue({
      content: '请提供《道德经》第一章的原文',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: null },
    })
    const { emit } = collectEvents()
    await condenseQuestion('原文', HISTORY, emit)
    const callArgs = mockChatComplete.mock.calls[0]
    const prompt = (callArgs[0] as Array<{ content: string }>)[0].content
    expect(prompt).toContain('道德经是谁写的')
    expect(prompt).toContain('老子')
    expect(prompt).toContain('原文')
  })
})
