import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IntentVerdict } from '../agent/types.ts'

const mockLlmClassify = vi.fn()

vi.mock('../agent/intentClassifier.ts', () => ({
  classifyByLlm: (...args: unknown[]) => mockLlmClassify(...args),
}))

describe('classify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.AGENT_INTENT_THRESHOLD
  })

  it('uses LLM verdict when confidence >= threshold', async () => {
    mockLlmClassify.mockResolvedValue({
      intent: 'metadata_ops', confidence: 0.9, reason: 'ok', fallback: false,
    } satisfies IntentVerdict)

    const { classify } = await import('../agent/classify.ts')
    const v = await classify('xxx')
    expect(v.intent).toBe('metadata_ops')
    expect(v.fallback).toBe(false)
  })

  it('falls back when LLM confidence < threshold', async () => {
    mockLlmClassify.mockResolvedValue({
      intent: 'metadata_ops', confidence: 0.3, reason: 'unsure', fallback: false,
    } satisfies IntentVerdict)

    const { classify } = await import('../agent/classify.ts')
    const v = await classify('什么是知识图谱')
    expect(v.fallback).toBe(true)
    expect(v.intent).toBe('knowledge_qa')
  })

  it('falls back when LLM returns null', async () => {
    mockLlmClassify.mockResolvedValue(null)
    const { classify } = await import('../agent/classify.ts')
    const v = await classify('统计近 7 天用户增长')
    expect(v.fallback).toBe(true)
    expect(v.intent).toBe('data_admin')
  })

  it('respects AGENT_INTENT_THRESHOLD env', async () => {
    process.env.AGENT_INTENT_THRESHOLD = '0.95'
    mockLlmClassify.mockResolvedValue({
      intent: 'metadata_ops', confidence: 0.9, reason: '', fallback: false,
    } satisfies IntentVerdict)

    const { classify } = await import('../agent/classify.ts')
    const v = await classify('什么是 RAG')
    // 0.9 < 0.95 → fallback
    expect(v.fallback).toBe(true)
  })
})
