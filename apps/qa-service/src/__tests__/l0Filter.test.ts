/**
 * l0Filter.ts 单测 —— ingest-l0-abstract change
 *
 * 验：
 *   1. L0_FILTER_ENABLED=false → undefined
 *   2. 表空 → undefined
 *   3. embed 失败 → undefined
 *   4. 0 命中 → []
 *   5. 命中 → 返回 distinct asset_ids
 *   6. SQL 抛 → undefined（永不抛上层）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn(),
  isEmbeddingConfigured: () => true,
}))

const mockQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockQuery }),
}))

import { embedTexts } from '../services/embeddings.ts'
import {
  chunksMissingL0,
  coarseFilterByL0,
  isL0FilterEnabled,
} from '../services/l0Filter.ts'

const mockEmbed = embedTexts as unknown as ReturnType<typeof vi.fn>

function makeEmit() {
  const events: unknown[] = []
  return { emit: (e: unknown) => events.push(e), events }
}

describe('l0Filter', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.L0_FILTER_ENABLED
    delete process.env.L0_LAZY_BACKFILL_ENABLED
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isL0FilterEnabled', () => {
    it('default off', () => {
      expect(isL0FilterEnabled()).toBe(false)
    })
    it('on by env', () => {
      process.env.L0_FILTER_ENABLED = 'true'
      expect(isL0FilterEnabled()).toBe(true)
    })
  })

  describe('coarseFilterByL0', () => {
    it('disabled returns undefined without query', async () => {
      const { emit, events } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toBeUndefined()
      expect(events).toEqual([])
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('empty table returns undefined', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] }) // count = 0
      const { emit, events } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toBeUndefined()
      expect(events).toEqual([])
    })

    it('embed failure returns undefined', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 5 }] })
      mockEmbed.mockResolvedValue([])
      const { emit } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toBeUndefined()
    })

    it('zero hits returns []', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery
        .mockResolvedValueOnce({ rows: [{ n: 5 }] })
        .mockResolvedValueOnce({ rows: [] })
      mockEmbed.mockResolvedValue([[0.1, 0.2]])
      const { emit, events } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toEqual([])
      expect(events.some((e: any) => e.label?.includes?.('0 命中'))).toBe(true)
    })

    it('hits return distinct asset_ids sorted by dist', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery
        .mockResolvedValueOnce({ rows: [{ n: 100 }] })
        .mockResolvedValueOnce({
          rows: [
            { asset_id: 7, dist: 0.05 },
            { asset_id: 11, dist: 0.10 },
            { asset_id: 19, dist: 0.20 },
          ],
        })
      mockEmbed.mockResolvedValue([[0.1, 0.2]])
      const { emit, events } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toEqual([7, 11, 19])
      expect(events.some((e: any) => e.label?.includes?.('L0 粗筛'))).toBe(true)
    })

    it('SQL throw → undefined (no rethrow)', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery.mockRejectedValueOnce(new Error('relation does not exist'))
      const { emit } = makeEmit()
      const r = await coarseFilterByL0('q', emit, {})
      expect(r).toBeUndefined()
    })

    it('respects topAssets cap', async () => {
      process.env.L0_FILTER_ENABLED = 'true'
      mockQuery
        .mockResolvedValueOnce({ rows: [{ n: 200 }] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 100 }, (_, i) => ({ asset_id: i + 1, dist: i * 0.01 })),
        })
      mockEmbed.mockResolvedValue([[0.1]])
      const { emit } = makeEmit()
      const r = await coarseFilterByL0('q', emit, { topAssets: 5 })
      expect(r).toHaveLength(5)
    })
  })

  describe('chunksMissingL0', () => {
    it('empty input → []', async () => {
      const r = await chunksMissingL0([])
      expect(r).toEqual([])
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('returns chunk ids from DB', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 3 }] })
      const r = await chunksMissingL0([1, 2, 3])
      expect(r).toEqual([1, 3])
    })

    it('SQL throw → []', async () => {
      mockQuery.mockRejectedValueOnce(new Error('boom'))
      const r = await chunksMissingL0([1])
      expect(r).toEqual([])
    })
  })
})
