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
