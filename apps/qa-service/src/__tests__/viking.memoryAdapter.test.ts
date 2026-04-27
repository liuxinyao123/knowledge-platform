/**
 * viking/memoryAdapter.ts 单测
 *
 * 验：
 *   1. recallMemory disabled 时返回空且不调 client
 *   2. recallMemory enabled 时把 query/principalId 翻译成 viking://user/<id>/ 前缀
 *   3. saveMemory 强制 user prefix，sessionId 含特殊字符被 sanitize
 *   4. formatRecallAsContext 拼字符串符合契约（[memory] 块）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// mock client（注意 path 要和 memoryAdapter import 的一致）
vi.mock('../services/viking/client.ts', () => {
  return {
    isEnabled: vi.fn(),
    find: vi.fn(),
    write: vi.fn(),
    principalToPathSeg: (id: string | number) => {
      const s = String(id).trim()
      if (!s || /[\/\\:]/.test(s)) throw new Error('invalid')
      return s
    },
    health: vi.fn(),
    read: vi.fn(),
    ls: vi.fn(),
    __resetVikingConfigForTest: vi.fn(),
  }
})

import * as client from '../services/viking/client.ts'
import {
  formatRecallAsContext,
  recallMemory,
  saveMemory,
} from '../services/viking/memoryAdapter.ts'

describe('viking/memoryAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recallMemory', () => {
    it('returns empty when disabled', async () => {
      ;(client.isEnabled as any).mockReturnValue(false)
      const r = await recallMemory({ question: 'q', principalId: 1 })
      expect(r.count).toBe(0)
      expect(r.hits).toEqual([])
      expect(client.find).not.toHaveBeenCalled()
    })

    it('passes user prefix and topK', async () => {
      ;(client.isEnabled as any).mockReturnValue(true)
      ;(client.find as any).mockResolvedValue([
        { uri: 'viking://user/42/x.md', l1: 'memo' },
      ])
      const r = await recallMemory({ question: 'hello', principalId: 42, topK: 7 })
      expect(client.find).toHaveBeenCalledWith({
        query: 'hello',
        pathPrefix: 'viking://user/42/',
        topK: 7,
        layer: 'l1',
      })
      expect(r.count).toBe(1)
      expect(r.hits[0].l1).toBe('memo')
    })

    it('uses topK=5 default', async () => {
      ;(client.isEnabled as any).mockReturnValue(true)
      ;(client.find as any).mockResolvedValue([])
      await recallMemory({ question: 'q', principalId: 'alice' })
      expect((client.find as any).mock.calls[0][0].topK).toBe(5)
    })
  })

  describe('saveMemory', () => {
    it('returns ok=false when disabled', async () => {
      ;(client.isEnabled as any).mockReturnValue(false)
      const r = await saveMemory({
        principalId: 1,
        sessionId: 's',
        question: 'q',
        answer: 'a',
      })
      expect(r.ok).toBe(false)
      expect(client.write).not.toHaveBeenCalled()
    })

    it('writes under viking://user/<id>/sessions/<sid>/', async () => {
      ;(client.isEnabled as any).mockReturnValue(true)
      ;(client.write as any).mockResolvedValue(true)
      const r = await saveMemory({
        principalId: 'alice',
        sessionId: 'sess-001',
        question: 'q1',
        answer: 'a1',
      })
      expect(r.ok).toBe(true)
      const callArg = (client.write as any).mock.calls[0]
      expect(callArg[0].uri).toMatch(
        /^viking:\/\/user\/alice\/sessions\/sess-001\/\d+\.md$/,
      )
      expect(callArg[1]).toBe('viking://user/alice/') // requiredPrefix
      expect(callArg[0].content).toContain('q1')
      expect(callArg[0].content).toContain('a1')
      expect(callArg[0].metadata.kind).toBe('qa-pair')
    })

    it('sanitizes weird sessionId', async () => {
      ;(client.isEnabled as any).mockReturnValue(true)
      ;(client.write as any).mockResolvedValue(true)
      await saveMemory({
        principalId: 1,
        sessionId: '../../etc/passwd',
        question: 'q',
        answer: 'a',
      })
      const uri = (client.write as any).mock.calls[0][0].uri
      expect(uri).not.toContain('..')
      expect(uri).not.toContain('/etc/')
    })

    it('returns ok=false when client.write fails', async () => {
      ;(client.isEnabled as any).mockReturnValue(true)
      ;(client.write as any).mockResolvedValue(false)
      const r = await saveMemory({
        principalId: 1,
        sessionId: 's',
        question: 'q',
        answer: 'a',
      })
      expect(r.ok).toBe(false)
      expect(r.uri).toBeUndefined()
    })
  })

  describe('formatRecallAsContext', () => {
    it('returns empty string for empty hits', () => {
      expect(formatRecallAsContext([])).toBe('')
    })

    it('formats hits as [memory] block', () => {
      const out = formatRecallAsContext([
        { uri: 'a', l1: 'first' },
        { uri: 'b', l0: 'fallback' },
      ])
      expect(out).toContain('[Long-term memory recalled')
      expect(out).toContain('[mem-1] first')
      expect(out).toContain('[mem-2] fallback')
      expect(out).toContain('[/memory]')
    })
  })
})
