/**
 * answerIntent · 5 类答案意图分类（档 B 核心）
 *
 * 覆盖：
 *   1. env B_HANDLER_ROUTING_ENABLED=false → 返回 factual_lookup + fallback
 *   2. LLM 未配置 → 返回 factual_lookup + fallback
 *   3. 空问题 → 返回 factual_lookup + fallback
 *   4. tool 无返回 → 返回 factual_lookup + fallback
 *   5. tool 返回非合法 intent → 返回 factual_lookup + fallback
 *   6. tool 返回合法 intent → 返回该 intent + fallback=false
 *   7. LLM 抛异常 → 返回 factual_lookup + fallback
 *   8. ANSWER_INTENTS / isAnswerIntent 守卫
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetChunk } from '../services/knowledgeSearch.ts'

const mockChatComplete = vi.fn()
const mockIsLlmConfigured = vi.fn().mockReturnValue(true)
vi.mock('../services/llm.ts', () => ({
  chatComplete: (...args: unknown[]) => mockChatComplete(...args),
  getLlmFastModel: vi.fn().mockReturnValue('mock-fast'),
  isLlmConfigured: () => mockIsLlmConfigured(),
}))

import {
  classifyAnswerIntent,
  isAnswerIntent,
  isHandlerRoutingEnabled,
  isObviousLanguageOp,
  ANSWER_INTENTS,
} from '../services/answerIntent.ts'

const FAKE_DOCS: AssetChunk[] = [
  { asset_id: 1, asset_name: 'doc1', chunk_content: 'sample content one', score: 0.8 } as AssetChunk,
  { asset_id: 2, asset_name: 'doc2', chunk_content: 'sample content two', score: 0.7 } as AssetChunk,
]

describe('isObviousLanguageOp · 规则前置（V3B 修复）', () => {
  it('"把上面这段翻译成中文" → true（V3B 关键 case）', () => {
    expect(isObviousLanguageOp('把上面这段翻译成中文')).toBe(true)
  })
  it('"translate the above answer to english" → true（V3B\' 中→英）', () => {
    expect(isObviousLanguageOp('translate the above answer to english')).toBe(true)
  })
  it('"总结一下今日头条这份文档的要点" → true（短句 + 含"这份"）', () => {
    expect(isObviousLanguageOp('总结一下今日头条这份文档的要点')).toBe(true)
  })
  it('"给上面这段做白话解释" → true', () => {
    expect(isObviousLanguageOp('给上面这段做白话解释')).toBe(true)
  })
  it('"给他的原文的解释" → true（之前 case2a）', () => {
    expect(isObviousLanguageOp('给他的原文的解释')).toBe(true)
  })
  it('"提炼一下这份文档的关键点" → true', () => {
    expect(isObviousLanguageOp('提炼一下这份文档的关键点')).toBe(true)
  })
  it('"summarize the report" → true（短英文 meta）', () => {
    expect(isObviousLanguageOp('summarize the report')).toBe(true)
  })
  it('短的 meta 动词 → true（≤30 字符兜底）', () => {
    expect(isObviousLanguageOp('翻译')).toBe(true)
    expect(isObviousLanguageOp('解释一下')).toBe(true)
    expect(isObviousLanguageOp('请总结')).toBe(true)
  })
  it('"道德经的作者是谁" → false（无 meta 动词）', () => {
    expect(isObviousLanguageOp('道德经的作者是谁')).toBe(false)
  })
  it('"缓冲块设计间隙是多少" → false（无 meta）', () => {
    expect(isObviousLanguageOp('缓冲块设计间隙是多少')).toBe(false)
  })
  it('"库里有哪些汽车工程相关的资料" → false（无 meta）', () => {
    expect(isObviousLanguageOp('库里有哪些汽车工程相关的资料')).toBe(false)
  })
  it('"什么是道？" → false（无 meta + 短）', () => {
    expect(isObviousLanguageOp('什么是道？')).toBe(false)
  })
  it('查询型起手 + 含 meta 词 → false（不算指令）', () => {
    expect(isObviousLanguageOp('我想了解机器翻译这门技术的发展历史详细情况和当下的应用场景')).toBe(false)
    expect(isObviousLanguageOp('什么是翻译')).toBe(false)
    expect(isObviousLanguageOp('请问 NMT 翻译效果好吗')).toBe(false)
    expect(isObviousLanguageOp('what is paraphrasing')).toBe(false)
    expect(isObviousLanguageOp('tell me what summarization means')).toBe(false)
  })
  it('空字符串 → false', () => {
    expect(isObviousLanguageOp('')).toBe(false)
    expect(isObviousLanguageOp('   ')).toBe(false)
  })
})

describe('isAnswerIntent', () => {
  it('5 个合法值都 true', () => {
    for (const i of ANSWER_INTENTS) expect(isAnswerIntent(i)).toBe(true)
  })
  it('其它字符串 / 非字符串 false', () => {
    expect(isAnswerIntent('foo')).toBe(false)
    expect(isAnswerIntent('')).toBe(false)
    expect(isAnswerIntent(null)).toBe(false)
    expect(isAnswerIntent(undefined)).toBe(false)
    expect(isAnswerIntent(42)).toBe(false)
  })
})

describe('isHandlerRoutingEnabled', () => {
  const orig = process.env.B_HANDLER_ROUTING_ENABLED
  afterEach(() => {
    if (orig === undefined) delete process.env.B_HANDLER_ROUTING_ENABLED
    else process.env.B_HANDLER_ROUTING_ENABLED = orig
  })

  it('默认 on', () => {
    delete process.env.B_HANDLER_ROUTING_ENABLED
    expect(isHandlerRoutingEnabled()).toBe(true)
  })
  it('false / 0 / off / no 关闭', () => {
    for (const v of ['false', '0', 'off', 'no', 'FALSE']) {
      process.env.B_HANDLER_ROUTING_ENABLED = v
      expect(isHandlerRoutingEnabled()).toBe(false)
    }
  })
})

describe('classifyAnswerIntent', () => {
  beforeEach(() => {
    mockChatComplete.mockReset()
    mockIsLlmConfigured.mockReturnValue(true)
    delete process.env.B_HANDLER_ROUTING_ENABLED
  })

  it('env 关闭 → factual_lookup + fallback', async () => {
    process.env.B_HANDLER_ROUTING_ENABLED = 'false'
    const r = await classifyAnswerIntent('随便问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('LLM 未配置 → factual_lookup + fallback', async () => {
    mockIsLlmConfigured.mockReturnValue(false)
    const r = await classifyAnswerIntent('随便问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('空问题 → factual_lookup + fallback', async () => {
    const r = await classifyAnswerIntent('   ', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('tool 无返回 → factual_lookup + fallback', async () => {
    mockChatComplete.mockResolvedValue({ content: '', toolCalls: [], rawMessage: { role: 'assistant', content: null } })
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
  })

  it('tool 返回非法 intent → factual_lookup + fallback', async () => {
    mockChatComplete.mockResolvedValue({
      content: '',
      toolCalls: [{ function: { name: 'classify_answer_intent', arguments: '{"intent":"foo","reason":"x"}' } }],
      rawMessage: { role: 'assistant', content: null },
    })
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('foo')
  })

  it('tool 返回合法 intent → 该 intent + fallback=false', async () => {
    mockChatComplete.mockResolvedValue({
      content: '',
      toolCalls: [{ function: { name: 'classify_answer_intent', arguments: '{"intent":"language_op","reason":"asks for translation"}' } }],
      rawMessage: { role: 'assistant', content: null },
    })
    const r = await classifyAnswerIntent('给我翻译一下', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.fallback).toBe(false)
    expect(r.reason).toBe('asks for translation')
  })

  it('LLM 抛异常 → factual_lookup + fallback', async () => {
    mockChatComplete.mockRejectedValue(new Error('LLM 502 bad gateway'))
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('LLM 502')
  })

  it('规则前置命中 → 不调 LLM 直接 language_op', async () => {
    // mockChatComplete 不该被调用
    const r = await classifyAnswerIntent('把上面这段翻译成中文', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.fallback).toBe(false)
    expect(r.reason).toBe('rule:meta+imperative')
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('规则不命中 → 走 LLM', async () => {
    mockChatComplete.mockResolvedValue({
      content: '',
      toolCalls: [{ function: { name: 'classify_answer_intent', arguments: '{"intent":"factual_lookup","reason":"x"}' } }],
      rawMessage: { role: 'assistant', content: null },
    })
    // "道德经的作者是谁"无 meta 动词，规则不命中
    const r = await classifyAnswerIntent('道德经的作者是谁', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(false)
    expect(mockChatComplete).toHaveBeenCalledTimes(1)
  })

  it('5 类 intent 都能正确返回', async () => {
    for (const i of ANSWER_INTENTS) {
      mockChatComplete.mockResolvedValueOnce({
        content: '',
        toolCalls: [{ function: { name: 'classify_answer_intent', arguments: JSON.stringify({ intent: i, reason: 'test' }) } }],
        rawMessage: { role: 'assistant', content: null },
      })
      const r = await classifyAnswerIntent('Q', FAKE_DOCS)
      expect(r.intent).toBe(i)
      expect(r.fallback).toBe(false)
    }
  })

  it('prompt 包含 question + 召回前 3 段 preview', async () => {
    mockChatComplete.mockResolvedValue({
      content: '',
      toolCalls: [{ function: { name: 'classify_answer_intent', arguments: '{"intent":"factual_lookup","reason":"x"}' } }],
      rawMessage: { role: 'assistant', content: null },
    })
    const docs: AssetChunk[] = [
      { asset_id: 11, asset_name: 'A', chunk_content: 'AAA AAA AAA', score: 0.9 } as AssetChunk,
      { asset_id: 22, asset_name: 'B', chunk_content: 'BBB BBB BBB', score: 0.8 } as AssetChunk,
      { asset_id: 33, asset_name: 'C', chunk_content: 'CCC CCC CCC', score: 0.7 } as AssetChunk,
      { asset_id: 44, asset_name: 'D', chunk_content: 'DDD DDD DDD', score: 0.6 } as AssetChunk,
    ]
    await classifyAnswerIntent('给我 A 的内容', docs)
    const callArgs = mockChatComplete.mock.calls[0]
    const prompt = (callArgs[0] as Array<{ content: string }>)[0].content
    expect(prompt).toContain('给我 A 的内容')
    expect(prompt).toContain('AAA')
    expect(prompt).toContain('BBB')
    expect(prompt).toContain('CCC')
    // 第 4 段超出 DOC_PREVIEW_COUNT=3，不应出现
    expect(prompt).not.toContain('DDD')
  })
})
