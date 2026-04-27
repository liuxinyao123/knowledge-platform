/**
 * D3 · chatStream 空流守护
 *
 * 对应 spec: openspec/changes/rag-relevance-hygiene/specs/stream-guard-spec.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 伪造 fetch，返回构造好的 ReadableStream
function makeStream(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, { status: 200 })
}

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.SILICONFLOW_API_KEY = 'test-key'
})

async function drain(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const t of gen) out.push(t)
  return out
}

describe('chatStream · D3 空流守护', () => {
  it('立即 [DONE] + 0 content → throw "no content chunks"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStream(['data: [DONE]\n'])))
    const { chatStream } = await import('../services/llm.ts')
    await expect(drain(chatStream([{ role: 'user', content: 'hi' }]))).rejects.toThrow(
      /LLM stream returned no content chunks/,
    )
  })

  it('reader done 前没收到 [DONE] 也 → throw', async () => {
    // 只返一个空字符串 delta（不会被 yield，yielded=0），然后 reader 自然结束
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStream([
      'data: {"choices":[{"delta":{"content":""}}]}\n',
    ])))
    const { chatStream } = await import('../services/llm.ts')
    await expect(drain(chatStream([{ role: 'user', content: 'hi' }]))).rejects.toThrow(
      /LLM stream returned no content chunks/,
    )
  })

  it('一个 delta → 正常 yield "知识" 不 throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStream([
      'data: {"choices":[{"delta":{"content":"知识"}}]}\n',
      'data: [DONE]\n',
    ])))
    const { chatStream } = await import('../services/llm.ts')
    const out = await drain(chatStream([{ role: 'user', content: 'hi' }]))
    expect(out).toEqual(['知识'])
  })

  it('非法 SSE 行被忽略 + 正常 content yield', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStream([
      'data: not-json\n',
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      'data: [DONE]\n',
    ])))
    const { chatStream } = await import('../services/llm.ts')
    const out = await drain(chatStream([{ role: 'user', content: 'hi' }]))
    expect(out).toEqual(['hi'])
  })

  it('reader 抛异常 → throw "interrupted"', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() { throw new Error('network lost') },
    })
    const res = new Response(stream, { status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    const { chatStream } = await import('../services/llm.ts')
    await expect(drain(chatStream([{ role: 'user', content: 'hi' }]))).rejects.toThrow(
      /LLM stream interrupted/,
    )
  })
})
