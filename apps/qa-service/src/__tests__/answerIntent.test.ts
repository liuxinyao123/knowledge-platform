/**
 * answerIntent · 5 类答案意图分类（档 B 核心）
 *
 * 测试矩阵：
 *   规则前置（V3B 修复）   isObviousLanguageOp 命中 / 不命中
 *   守卫                   isAnswerIntent / isHandlerRoutingEnabled / isIntentMultiToolEnabled
 *   multi-tool 路径（默认）MT-1..10：5 类 tool 选择 + 4 种兜底 + prompt 形状
 *   legacy 路径（env=off）  LEG-1..2 + 旧 fallback 兼容
 *   FAIL                   B_HANDLER_ROUTING_ENABLED / LLM 未配置 / LLM 异常
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
  isIntentMultiToolEnabled,
  isObviousLanguageOp,
  ANSWER_INTENTS,
  INTENT_TOOLS,
  TOOL_NAME_TO_INTENT,
} from '../services/answerIntent.ts'

const FAKE_DOCS: AssetChunk[] = [
  { asset_id: 1, asset_name: 'doc1', chunk_content: 'sample content one', score: 0.8 } as AssetChunk,
  { asset_id: 2, asset_name: 'doc2', chunk_content: 'sample content two', score: 0.7 } as AssetChunk,
]

/** 构造一个 multi-tool 路径下 LLM 返回的 toolCalls payload */
function mtCall(toolName: string, args: string = '{"reason":"x"}') {
  return {
    content: '',
    toolCalls: [{ function: { name: toolName, arguments: args } }],
    rawMessage: { role: 'assistant', content: null },
  }
}
/** 构造 legacy 路径下旧 single-tool 的 toolCalls payload */
function legacyCall(intent: string, reason = 'x') {
  return {
    content: '',
    toolCalls: [{ function: { name: 'classify_answer_intent', arguments: JSON.stringify({ intent, reason }) } }],
    rawMessage: { role: 'assistant', content: null },
  }
}

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

describe('isIntentMultiToolEnabled · D-002.3 env 守卫', () => {
  const orig = process.env.INTENT_MULTI_TOOL_ENABLED
  afterEach(() => {
    if (orig === undefined) delete process.env.INTENT_MULTI_TOOL_ENABLED
    else process.env.INTENT_MULTI_TOOL_ENABLED = orig
  })

  it('默认 on', () => {
    delete process.env.INTENT_MULTI_TOOL_ENABLED
    expect(isIntentMultiToolEnabled()).toBe(true)
  })
  it('false / 0 / off / no 关闭（大小写不敏感）', () => {
    for (const v of ['false', '0', 'off', 'no', 'FALSE', 'OFF']) {
      process.env.INTENT_MULTI_TOOL_ENABLED = v
      expect(isIntentMultiToolEnabled()).toBe(false)
    }
  })
  it('其它值（true/1/on/yes/空串）保持 on', () => {
    for (const v of ['true', '1', 'on', 'yes', '']) {
      process.env.INTENT_MULTI_TOOL_ENABLED = v
      expect(isIntentMultiToolEnabled()).toBe(true)
    }
  })
})

describe('INTENT_TOOLS · 5 个 tool 常量结构', () => {
  it('数量恰好 5', () => {
    expect(INTENT_TOOLS.length).toBe(5)
  })
  it('每个 tool name 都是 select_<intent>', () => {
    const names = INTENT_TOOLS.map((t) => t.function.name).sort()
    expect(names).toEqual([
      'select_factual_lookup',
      'select_kb_meta',
      'select_language_op',
      'select_multi_doc_compare',
      'select_out_of_scope',
    ])
  })
  it('每个 tool 都只暴露 reason: string 单字段', () => {
    for (const tool of INTENT_TOOLS) {
      const params = tool.function.parameters as Record<string, unknown>
      expect(params.type).toBe('object')
      const props = params.properties as Record<string, { type: string }>
      expect(Object.keys(props)).toEqual(['reason'])
      expect(props.reason.type).toBe('string')
      expect(params.required).toEqual(['reason'])
    }
  })
  it('每个 tool description 长度 ≤ 250（含示例 + 边界提示）', () => {
    for (const tool of INTENT_TOOLS) {
      expect(tool.function.description.length).toBeGreaterThan(20)
      expect(tool.function.description.length).toBeLessThan(250)
    }
  })
  it('TOOL_NAME_TO_INTENT 反查 5 项完整', () => {
    expect(Object.keys(TOOL_NAME_TO_INTENT).sort()).toEqual([
      'select_factual_lookup',
      'select_kb_meta',
      'select_language_op',
      'select_multi_doc_compare',
      'select_out_of_scope',
    ])
    expect(TOOL_NAME_TO_INTENT.select_factual_lookup).toBe('factual_lookup')
    expect(TOOL_NAME_TO_INTENT.select_language_op).toBe('language_op')
    expect(TOOL_NAME_TO_INTENT.select_multi_doc_compare).toBe('multi_doc_compare')
    expect(TOOL_NAME_TO_INTENT.select_kb_meta).toBe('kb_meta')
    expect(TOOL_NAME_TO_INTENT.select_out_of_scope).toBe('out_of_scope')
  })
})

describe('classifyAnswerIntent · multi-tool 路径（默认 env=on）', () => {
  beforeEach(() => {
    mockChatComplete.mockReset()
    mockIsLlmConfigured.mockReturnValue(true)
    delete process.env.B_HANDLER_ROUTING_ENABLED
    delete process.env.INTENT_MULTI_TOOL_ENABLED
  })

  it('FAIL-3: B_HANDLER_ROUTING_ENABLED=false → factual_lookup + fallback', async () => {
    process.env.B_HANDLER_ROUTING_ENABLED = 'false'
    const r = await classifyAnswerIntent('随便问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('FAIL-2: LLM 未配置 → factual_lookup + fallback', async () => {
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

  it('RULE-1: 规则前置命中（"把上面这段翻译成中文"）→ language_op, 不调 LLM', async () => {
    const r = await classifyAnswerIntent('把上面这段翻译成中文', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.fallback).toBe(false)
    expect(r.reason).toBe('rule:meta+imperative')
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('MT-1: select_factual_lookup → factual_lookup, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_factual_lookup', '{"reason":"asks for spec"}'))
    const r = await classifyAnswerIntent('道德经的作者是谁', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(false)
    expect(r.reason).toBe('asks for spec')
  })

  it('MT-2: select_language_op → language_op, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_language_op', '{"reason":"asks to translate"}'))
    const r = await classifyAnswerIntent('请将文中第二段译成英文', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.fallback).toBe(false)
  })

  it('MT-3: select_multi_doc_compare → multi_doc_compare, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_multi_doc_compare'))
    const r = await classifyAnswerIntent('A 和 B 有什么区别', FAKE_DOCS)
    expect(r.intent).toBe('multi_doc_compare')
    expect(r.fallback).toBe(false)
  })

  it('MT-4: select_kb_meta → kb_meta, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_kb_meta'))
    const r = await classifyAnswerIntent('库里有哪些 PDF 文档', FAKE_DOCS)
    expect(r.intent).toBe('kb_meta')
    expect(r.fallback).toBe(false)
  })

  it('MT-5: select_out_of_scope → out_of_scope, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_out_of_scope'))
    const r = await classifyAnswerIntent('为什么 GM 要写这份文档', FAKE_DOCS)
    expect(r.intent).toBe('out_of_scope')
    expect(r.fallback).toBe(false)
  })

  it('MT-6: unknown tool name → factual_lookup + fallback, reason 含 unknown', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_does_not_exist'))
    const r = await classifyAnswerIntent('问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('unknown tool')
    expect(r.reason).toContain('select_does_not_exist')
  })

  it('MT-7: 多 tool calls → 取首个，reason 含 multi-tool', async () => {
    mockChatComplete.mockResolvedValue({
      content: '',
      toolCalls: [
        { function: { name: 'select_kb_meta', arguments: '{"reason":"first pick"}' } },
        { function: { name: 'select_language_op', arguments: '{"reason":"second pick"}' } },
      ],
      rawMessage: { role: 'assistant', content: null },
    })
    const r = await classifyAnswerIntent('问个啥', FAKE_DOCS)
    expect(r.intent).toBe('kb_meta')   // 首个赢
    expect(r.fallback).toBe(false)
    expect(r.reason).toContain('first pick')
    expect(r.reason).toContain('multi-tool')
  })

  it('MT-8: tool name 合法但 args 解析失败 → 接受 intent, fallback=false, reason 含 parse failed', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_kb_meta', 'malformed{'))
    const r = await classifyAnswerIntent('库里有 X 吗', FAKE_DOCS)
    expect(r.intent).toBe('kb_meta')   // name 决断成功，不降级
    expect(r.fallback).toBe(false)
    expect(r.reason).toContain('parse failed')
  })

  it('MT-9: 0 tool calls → factual_lookup + fallback', async () => {
    mockChatComplete.mockResolvedValue({ content: '', toolCalls: [], rawMessage: { role: 'assistant', content: null } })
    const r = await classifyAnswerIntent('问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('no tool call')
  })

  it('MT-10: prompt 是瘦身版（不含旧"边界例子"段，但含问题 + preview）', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_factual_lookup'))
    await classifyAnswerIntent('独立问题用于断言 prompt', FAKE_DOCS)
    const callArgs = mockChatComplete.mock.calls[0]
    const prompt = (callArgs[0] as Array<{ content: string }>)[0].content
    // 瘦身：保留问题 + preview + 调用指引
    expect(prompt).toContain('独立问题用于断言 prompt')
    expect(prompt).toContain('select_*')
    expect(prompt).toContain('召回文档预览')
    // 不再含旧 prompt 的"边界例子"判定段（那些规则已下沉到 tool description）
    expect(prompt).not.toContain('道德经第一章原文')
    expect(prompt).not.toContain('判定窍门')
    expect(prompt).not.toContain('kb_meta vs factual_lookup 关键区分')
    // 也不再 inline 重复 5 类 intent 的判定准则
    expect(prompt).not.toContain('factual_lookup: 用户在文档里**找事实**')
  })

  it('MT-10b: chatComplete 调用传 INTENT_TOOLS（5 个）+ tool_choice=required', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_factual_lookup'))
    await classifyAnswerIntent('问个啥', FAKE_DOCS)
    const opts = mockChatComplete.mock.calls[0][1] as {
      tools: Array<{ function: { name: string } }>
      toolChoice: unknown
    }
    expect(opts.tools.length).toBe(5)
    expect(opts.tools.map((t) => t.function.name).sort()).toEqual([
      'select_factual_lookup',
      'select_kb_meta',
      'select_language_op',
      'select_multi_doc_compare',
      'select_out_of_scope',
    ])
    expect(opts.toolChoice).toBe('required')
  })

  it('FAIL-1: LLM 抛异常 → factual_lookup + fallback, reason 含原 error', async () => {
    mockChatComplete.mockRejectedValue(new Error('LLM 502 bad gateway'))
    const r = await classifyAnswerIntent('问个啥', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('LLM 502')
  })

  it('prompt 包含 question + 召回前 3 段，第 4 段不出现', async () => {
    mockChatComplete.mockResolvedValue(mtCall('select_factual_lookup'))
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
    expect(prompt).not.toContain('DDD')
  })

  it('5 类 tool 都能正确返回（驱动表）', async () => {
    const cases: Array<[string, string]> = [
      ['select_factual_lookup', 'factual_lookup'],
      ['select_language_op', 'language_op'],
      ['select_multi_doc_compare', 'multi_doc_compare'],
      ['select_kb_meta', 'kb_meta'],
      ['select_out_of_scope', 'out_of_scope'],
    ]
    for (const [toolName, expectedIntent] of cases) {
      mockChatComplete.mockResolvedValueOnce(mtCall(toolName))
      const r = await classifyAnswerIntent('问个啥', FAKE_DOCS)
      expect(r.intent).toBe(expectedIntent)
      expect(r.fallback).toBe(false)
    }
  })
})

describe('classifyAnswerIntent · legacy 路径（INTENT_MULTI_TOOL_ENABLED=false）', () => {
  beforeEach(() => {
    mockChatComplete.mockReset()
    mockIsLlmConfigured.mockReturnValue(true)
    delete process.env.B_HANDLER_ROUTING_ENABLED
    process.env.INTENT_MULTI_TOOL_ENABLED = 'false'
  })
  afterEach(() => {
    delete process.env.INTENT_MULTI_TOOL_ENABLED
  })

  it('LEG-1: 走旧 single-tool，调用 schema 是 classify_answer_intent', async () => {
    mockChatComplete.mockResolvedValue(legacyCall('factual_lookup', 'asks about author'))
    await classifyAnswerIntent('道德经的作者是谁', FAKE_DOCS)
    const opts = mockChatComplete.mock.calls[0][1] as {
      tools: Array<{ function: { name: string } }>
      toolChoice: { type: string; function: { name: string } }
    }
    expect(opts.tools.length).toBe(1)
    expect(opts.tools[0].function.name).toBe('classify_answer_intent')
    expect(opts.toolChoice.function.name).toBe('classify_answer_intent')
  })

  it('LEG-2: 旧 args 解析合法 intent → 该 intent, fallback=false', async () => {
    mockChatComplete.mockResolvedValue(legacyCall('language_op', 'asks for translation'))
    const r = await classifyAnswerIntent('道德经的作者是谁', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.fallback).toBe(false)
    expect(r.reason).toBe('asks for translation')
  })

  it('legacy: tool 无返回 → factual_lookup + fallback', async () => {
    mockChatComplete.mockResolvedValue({ content: '', toolCalls: [], rawMessage: { role: 'assistant', content: null } })
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
  })

  it('legacy: tool 返回非法 intent → factual_lookup + fallback, reason 含原值', async () => {
    mockChatComplete.mockResolvedValue(legacyCall('foo'))
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('foo')
  })

  it('legacy: LLM 异常 → factual_lookup + fallback', async () => {
    mockChatComplete.mockRejectedValue(new Error('LLM 502 bad gateway'))
    const r = await classifyAnswerIntent('Q', FAKE_DOCS)
    expect(r.intent).toBe('factual_lookup')
    expect(r.fallback).toBe(true)
    expect(r.reason).toContain('LLM 502')
  })

  it('legacy: prompt 是旧版（含"边界例子"段）', async () => {
    mockChatComplete.mockResolvedValue(legacyCall('factual_lookup'))
    await classifyAnswerIntent('问个啥', FAKE_DOCS)
    const prompt = (mockChatComplete.mock.calls[0][0] as Array<{ content: string }>)[0].content
    // 旧 prompt inline 重复了 5 类 intent 判定准则 + 边界例子
    expect(prompt).toContain('factual_lookup: 用户在文档里')
    expect(prompt).toContain('道德经第一章原文')
    expect(prompt).toContain('判定窍门')
  })

  it('legacy: 规则前置仍优先于 LLM', async () => {
    const r = await classifyAnswerIntent('把上面这段翻译成中文', FAKE_DOCS)
    expect(r.intent).toBe('language_op')
    expect(r.reason).toBe('rule:meta+imperative')
    expect(mockChatComplete).not.toHaveBeenCalled()
  })
})
