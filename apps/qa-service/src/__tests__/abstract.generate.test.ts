/**
 * abstract.ts 单测 —— ingest-l0-abstract change
 *
 * 验：
 *   1. parseAbstractJson 解析正确 / 越界丢弃 / 包裹 ```json``` 容错
 *   2. L0_GENERATE_ENABLED=false 整段 no-op
 *   3. 短 chunk → skipped
 *   4. LLM 抛 / JSON 解析失败 → failed
 *   5. 成功 → INSERT
 *
 * 用 vitest 的 vi.mock 隔离 chatComplete + embedTexts + pgPool。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/llm.ts', () => ({
  chatComplete: vi.fn(),
  getLlmFastModel: () => 'mock-fast',
}))
vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn(),
  isEmbeddingConfigured: () => true,
}))

import { chatComplete } from '../services/llm.ts'
import { embedTexts } from '../services/embeddings.ts'
import {
  generateAbstractsForAsset,
  generateAbstractsForChunks,
  parseAbstractJson,
} from '../services/ingestPipeline/abstract.ts'

const mockComplete = chatComplete as unknown as ReturnType<typeof vi.fn>
const mockEmbed = embedTexts as unknown as ReturnType<typeof vi.fn>

function makePool(rows: Array<{ id: number; asset_id: number; content: string }>) {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  return {
    queries,
    async query(sql: string, params: unknown[]) {
      queries.push({ sql, params })
      if (sql.includes('INSERT INTO chunk_abstract')) return { rows: [] }
      // SELECT 拉 chunk
      return { rows }
    },
  } as never
}

describe('parseAbstractJson', () => {
  it('parses well-formed JSON', () => {
    const r = parseAbstractJson('{"l0":"概要","l1":"结论\\n关键事实\\n适用"}')
    expect(r).toEqual({ l0: '概要', l1: '结论\n关键事实\n适用' })
  })

  it('handles ```json``` wrapper', () => {
    const r = parseAbstractJson('```json\n{"l0":"x","l1":"y"}\n```')
    expect(r).toEqual({ l0: 'x', l1: 'y' })
  })

  it('rejects missing l0', () => {
    expect(parseAbstractJson('{"l1":"only"}')).toBeNull()
  })

  it('rejects empty l0', () => {
    expect(parseAbstractJson('{"l0":"","l1":"x"}')).toBeNull()
  })

  it('rejects oversize l0 (>200 chars)', () => {
    const big = '一'.repeat(201)
    expect(parseAbstractJson(`{"l0":"${big}","l1":"x"}`)).toBeNull()
  })

  it('rejects oversize l1 (>600 chars)', () => {
    const big = 'x'.repeat(601)
    expect(parseAbstractJson(`{"l0":"ok","l1":"${big}"}`)).toBeNull()
  })

  it('treats missing l1 as null', () => {
    expect(parseAbstractJson('{"l0":"only"}')).toEqual({ l0: 'only', l1: null })
  })

  it('rejects non-JSON', () => {
    expect(parseAbstractJson('not json at all')).toBeNull()
  })
})

describe('generateAbstractsForAsset', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.L0_GENERATE_ENABLED = 'true'
    process.env.L0_GENERATE_MIN_CHARS = '10'
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('disabled → no-op', async () => {
    process.env.L0_GENERATE_ENABLED = 'false'
    const pool = makePool([{ id: 1, asset_id: 9, content: '足够长的 chunk 内容用于生成 L0/L1' }])
    const r = await generateAbstractsForAsset(9, pool)
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0 })
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('skips short chunks', async () => {
    const pool = makePool([
      { id: 1, asset_id: 9, content: '短' },
      { id: 2, asset_id: 9, content: '另一个很短' },
    ])
    const r = await generateAbstractsForAsset(9, pool)
    expect(r.skipped).toBe(2)
    expect(r.generated).toBe(0)
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('counts failed when LLM throws', async () => {
    mockComplete.mockRejectedValue(new Error('429 rate limit'))
    const pool = makePool([{ id: 1, asset_id: 9, content: '足够长的 chunk 内容用于生成 L0' }])
    const r = await generateAbstractsForAsset(9, pool)
    expect(r.failed).toBe(1)
    expect(r.generated).toBe(0)
  })

  it('counts failed on JSON parse error', async () => {
    mockComplete.mockResolvedValue({ content: 'not a json', toolCalls: [], rawMessage: { role: 'assistant', content: 'not a json' } })
    const pool = makePool([{ id: 1, asset_id: 9, content: '足够长的 chunk 内容用于生成 L0' }])
    const r = await generateAbstractsForAsset(9, pool)
    expect(r.failed).toBe(1)
  })

  it('inserts on success', async () => {
    mockComplete.mockResolvedValue({
      content: '{"l0":"知识图谱是X","l1":"结论:..."}',
      toolCalls: [],
      rawMessage: { role: 'assistant', content: '{"l0":"知识图谱是X","l1":"结论:..."}' },
    })
    mockEmbed.mockResolvedValue([[0.1, 0.2, 0.3]])
    const pool = makePool([{ id: 1, asset_id: 9, content: '足够长的 chunk 内容用于生成 L0' }])
    const r = await generateAbstractsForAsset(9, pool)
    expect(r.generated).toBe(1)
    expect(r.failed).toBe(0)
    const insertCall = (pool as unknown as { queries: Array<{ sql: string }> }).queries.find(
      (q) => q.sql.includes('INSERT INTO chunk_abstract'),
    )
    expect(insertCall).toBeDefined()
  })
})

describe('generateAbstractsForChunks', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.L0_GENERATE_ENABLED = 'true'
    process.env.L0_GENERATE_MIN_CHARS = '10'
  })
  afterEach(() => { process.env = { ...originalEnv } })

  it('empty list → zero counters, no DB hit', async () => {
    const pool = makePool([])
    const r = await generateAbstractsForChunks([], pool)
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0 })
  })

  it('disabled → no-op', async () => {
    process.env.L0_GENERATE_ENABLED = 'false'
    const pool = makePool([{ id: 1, asset_id: 9, content: '足够长的 chunk 内容' }])
    const r = await generateAbstractsForChunks([1], pool)
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0 })
  })
})
