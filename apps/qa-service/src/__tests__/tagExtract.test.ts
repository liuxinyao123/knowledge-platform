import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockChatComplete = vi.fn()

vi.mock('../services/llm.ts', () => ({
  chatComplete: mockChatComplete,
  getLlmFastModel: vi.fn().mockReturnValue('mock'),
  isLlmConfigured: vi.fn(() => true),
}))

function toolResp(tagsJson: unknown) {
  return {
    content: null,
    toolCalls: [{
      id: 't1', type: 'function' as const,
      function: { name: 'extract_tags', arguments: JSON.stringify(tagsJson) },
    }],
    rawMessage: { role: 'assistant' as const, content: null },
  }
}

describe('extractTags', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] when text is empty', async () => {
    const { extractTags } = await import('../services/tagExtract.ts')
    expect(await extractTags('')).toEqual([])
  })

  it('returns normalized tags from LLM (dedupe, lowercase EN, truncate long)', async () => {
    mockChatComplete.mockResolvedValue(toolResp({
      tags: ['RAG', 'rag', 'Knowledge Graph', 'VeryLongTagThatExceedsLimit', '向量检索'],
    }))
    const { extractTags } = await import('../services/tagExtract.ts')
    const out = await extractTags('some content body text to classify')
    // 'RAG' 和 'rag' 归一后去重
    expect(out).toContain('rag')
    expect(out.filter((t) => t === 'rag')).toHaveLength(1)
    // 中文原样
    expect(out).toContain('向量检索')
    // 长标签被截断（MAX_TAG_LEN=24，允许 "Body Side Clearance" 这种长术语完整保留）
    expect(out.every((t) => t.length <= 24)).toBe(true)
  })

  it('returns [] on LLM failure', async () => {
    mockChatComplete.mockRejectedValue(new Error('boom'))
    const { extractTags } = await import('../services/tagExtract.ts')
    expect(await extractTags('x')).toEqual([])
  })

  it('returns [] on unparseable JSON', async () => {
    mockChatComplete.mockResolvedValue({
      content: null,
      toolCalls: [{
        id: 't1', type: 'function' as const,
        function: { name: 'extract_tags', arguments: 'not-json' },
      }],
      rawMessage: { role: 'assistant' as const, content: null },
    })
    const { extractTags } = await import('../services/tagExtract.ts')
    expect(await extractTags('x')).toEqual([])
  })

  it('caps output at MAX_TAGS=8', async () => {
    // 用和测试 #2 同风格的英文词 tag（≥3 字符，纯字母，无歧义），
    // 保证每个 tag 都能穿过 cleanOne 的所有过滤（MIN_TAG_LEN / looksLikeOcrFragment / PUNCT）。
    mockChatComplete.mockResolvedValue(toolResp({
      tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'],
    }))
    const { extractTags } = await import('../services/tagExtract.ts')
    const out = await extractTags('x')
    expect(out.length).toBe(8)
  })
})
