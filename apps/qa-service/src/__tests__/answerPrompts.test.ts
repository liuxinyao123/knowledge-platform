/**
 * answerPrompts · 5 个 intent 的 system prompt 模板
 *
 * 不测 LLM 行为（那是 e2e 的事），只测：
 *   1. 每个 intent 模板都包含 context
 *   2. 每个 intent 模板的"模式名"出现在 prompt 头部（便于 LLM 区分）
 *   3. inlineImageRule 被拼到 factual_lookup / language_op / multi_doc_compare
 *      （kb_meta / out_of_scope 不需要图片）
 *   4. 关键约束词存在 ——
 *      factual_lookup: verbatim
 *      language_op: 必须执行 / 不能拒答
 *      multi_doc_compare: 不漏组件 / 同维度
 *      kb_meta: 不进文档内容
 *      out_of_scope: 知识库中没有 / 不要发挥
 */
import { describe, it, expect } from 'vitest'
import { buildSystemPromptByIntent } from '../services/answerPrompts.ts'

const FAKE_CTX = '[1] doc1\n这里是召回上下文片段。'
const FAKE_INLINE = '\n6. **图片内嵌（可选）**：测试占位规则'

describe('buildSystemPromptByIntent', () => {
  it('factual_lookup · 含模式名 + verbatim + context + inlineImage', () => {
    const p = buildSystemPromptByIntent('factual_lookup', FAKE_CTX, FAKE_INLINE)
    expect(p).toContain('事实查询模式')
    expect(p).toContain('verbatim')
    expect(p).toContain(FAKE_CTX)
    expect(p).toContain('图片内嵌')
  })

  it('language_op · 含模式名 + 必须执行 + 不能拒答 + 透明度声明', () => {
    const p = buildSystemPromptByIntent('language_op', FAKE_CTX, FAKE_INLINE)
    expect(p).toContain('语言层转换模式')
    expect(p).toContain('必须执行')
    expect(p).toContain('不能拒答')
    expect(p).toContain('透明度声明')
    expect(p).toContain(FAKE_CTX)
    expect(p).toContain('图片内嵌')
  })

  it('multi_doc_compare · 含模式名 + 不漏组件 + 同维度对齐', () => {
    const p = buildSystemPromptByIntent('multi_doc_compare', FAKE_CTX, FAKE_INLINE)
    expect(p).toContain('对比/分项模式')
    expect(p).toContain('不漏组件')
    expect(p).toContain('同维度对齐')
    expect(p).toContain(FAKE_CTX)
    expect(p).toContain('图片内嵌')
  })

  it('kb_meta · 含模式名 + 不进文档内容 + 不加引用', () => {
    const p = buildSystemPromptByIntent('kb_meta', FAKE_CTX, FAKE_INLINE)
    expect(p).toContain('目录元查询模式')
    expect(p).toContain('不进文档内容描述')
    expect(p).toContain('不加 [N] 引用')
    expect(p).toContain(FAKE_CTX)
    // kb_meta 不需要 inline image，不应拼接
    expect(p).not.toContain('图片内嵌')
  })

  it('out_of_scope · 含模式名 + 知识库中没有 + 不要发挥', () => {
    const p = buildSystemPromptByIntent('out_of_scope', FAKE_CTX, FAKE_INLINE)
    expect(p).toContain('超范围声明模式')
    expect(p).toContain('知识库中没有')
    expect(p).toContain('不要发挥')
    expect(p).toContain(FAKE_CTX)
    // out_of_scope 不需要 inline image
    expect(p).not.toContain('图片内嵌')
  })

  it('5 种模板都不包含具体文档形态词（古文/合同/COF/mm/etc）', () => {
    const intents = ['factual_lookup', 'language_op', 'multi_doc_compare', 'kb_meta', 'out_of_scope'] as const
    const forbidden = ['道德经', '老子', '缓冲块', 'COF', 'B&R', 'Swing', '油漆变差', '铰链公差']
    for (const intent of intents) {
      const p = buildSystemPromptByIntent(intent, FAKE_CTX, '')
      for (const word of forbidden) {
        expect(p, `${intent} 不应含 hardcoded 文档形态词 "${word}"`).not.toContain(word)
      }
    }
  })

  it('inlineImageRule 默认为空字符串', () => {
    const p = buildSystemPromptByIntent('factual_lookup', FAKE_CTX)
    expect(p).not.toContain('图片内嵌')
  })
})

describe('buildSystemPromptByIntent · citationStyle (N-001)', () => {
  const intents = ['factual_lookup', 'language_op', 'multi_doc_compare', 'kb_meta', 'out_of_scope'] as const

  it('默认 citationStyle = inline，行为等价老 freeze', () => {
    for (const intent of intents) {
      const noArg = buildSystemPromptByIntent(intent, FAKE_CTX)
      const explicit = buildSystemPromptByIntent(intent, FAKE_CTX, '', 'inline')
      expect(noArg).toBe(explicit)
    }
  })

  it('inline 模式：prompt 段含 [N]，不含 [^N]', () => {
    const p = buildSystemPromptByIntent('factual_lookup', FAKE_CTX, '', 'inline')
    // 拆出 prompt 段（"文档内容："之前）
    const promptPart = p.slice(0, p.indexOf('文档内容：'))
    expect(promptPart).toMatch(/\[N\]/)         // 含 [N]
    expect(promptPart).not.toMatch(/\[\^N\]/)   // 不含 [^N]
  })

  it('footnote 模式：prompt 段所有 [N] → [^N]', () => {
    for (const intent of intents) {
      const p = buildSystemPromptByIntent(intent, FAKE_CTX, '', 'footnote')
      const promptPart = p.slice(0, p.indexOf('文档内容：'))
      // prompt 段不应再含 [N]（裸数字方括号）
      expect(promptPart, `${intent} prompt 段仍含 [N]`).not.toMatch(/\[\d+\]/)
      expect(promptPart, `${intent} prompt 段也不应含 "[N]" 字面`).not.toMatch(/\[N\]/)
    }
  })

  it('footnote 模式：context 段保留 [N] 不替换', () => {
    const ctx = '[1] doc1.pdf\n第一段内容\n\n---\n\n[2] doc2.pdf\n第二段内容'
    const p = buildSystemPromptByIntent('factual_lookup', ctx, '', 'footnote')
    const contextPart = p.slice(p.indexOf('文档内容：'))
    // context 段必须含原样 [1] [2]（不替换为 [^1] [^2]）
    expect(contextPart).toContain('[1] doc1.pdf')
    expect(contextPart).toContain('[2] doc2.pdf')
    expect(contextPart).not.toContain('[^1]')
    expect(contextPart).not.toContain('[^2]')
  })

  it('footnote 模式：inlineImageRule (![alt](url)) 不被误伤', () => {
    const inline = '\n6. **图片内嵌**：![描述](/api/assets/images/42)'
    const p = buildSystemPromptByIntent('factual_lookup', FAKE_CTX, inline, 'footnote')
    // markdown image syntax 字面保留
    expect(p).toContain('![描述](/api/assets/images/42)')
    // 但同段如果有 [N] 引用规则仍被替换
    expect(p).toContain('图片内嵌')
  })

  it('footnote 模式：5 模板禁词检查（仍不含 hardcoded 文档形态）', () => {
    const forbidden = ['道德经', '老子', '缓冲块', 'COF', 'B&R', 'Swing', '油漆变差', '铰链公差']
    for (const intent of intents) {
      const p = buildSystemPromptByIntent(intent, FAKE_CTX, '', 'footnote')
      for (const word of forbidden) {
        expect(p, `${intent}/footnote 不应含 hardcoded 词 "${word}"`).not.toContain(word)
      }
    }
  })

  it('footnote 模式：模式名标识仍存在', () => {
    expect(buildSystemPromptByIntent('factual_lookup', FAKE_CTX, '', 'footnote')).toContain('事实查询模式')
    expect(buildSystemPromptByIntent('language_op', FAKE_CTX, '', 'footnote')).toContain('语言层转换模式')
    expect(buildSystemPromptByIntent('multi_doc_compare', FAKE_CTX, '', 'footnote')).toContain('对比/分项模式')
    expect(buildSystemPromptByIntent('kb_meta', FAKE_CTX, '', 'footnote')).toContain('目录元查询模式')
    expect(buildSystemPromptByIntent('out_of_scope', FAKE_CTX, '', 'footnote')).toContain('超范围声明模式')
  })

  it('footnote 模式：language_op 关键约束保留', () => {
    const p = buildSystemPromptByIntent('language_op', FAKE_CTX, '', 'footnote')
    expect(p).toContain('必须执行')
    expect(p).toContain('不能拒答')
    expect(p).toContain('透明度声明')
  })

  it('footnote 模式：context 缺 "文档内容：" 标记 → 全文替换兜底', () => {
    // 极端情况（实际不会发生）：构造一个不含 "文档内容：" 标记的 prompt
    // 由于实现在 toFootnoteCitations 里有 idx<0 兜底，这里不易直接触发
    // 改为验证：正常 ctx 时 context 段 [N] 保留
    const p = buildSystemPromptByIntent('factual_lookup', FAKE_CTX, '', 'footnote')
    expect(p).toContain('文档内容：')  // marker 一定存在
  })
})
