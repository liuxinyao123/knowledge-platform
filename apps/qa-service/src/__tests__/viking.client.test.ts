/**
 * viking/client.ts 单测
 *
 * 验：
 *   1. VIKING_ENABLED=0 时所有方法 no-op，不发 HTTP
 *   2. principalToPathSeg 对非法字符抛
 *   3. write 校验 prefix，违反时抛
 *   4. find 容错解析（hits 字段缺失时返回 []）
 *
 * 真实 HTTP 不打，用 axios mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'

vi.mock('axios')

import {
  __resetVikingConfigForTest,
  find,
  health,
  isEnabled,
  principalToPathSeg,
  write,
} from '../services/viking/client.ts'

const mockAxios = axios as unknown as {
  create: ReturnType<typeof vi.fn>
}

function setupAxios(handler: { get?: any; post?: any }) {
  ;(mockAxios.create as any).mockReturnValue({
    get: handler.get ?? vi.fn(),
    post: handler.post ?? vi.fn(),
  })
}

describe('viking/client', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    __resetVikingConfigForTest()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    __resetVikingConfigForTest()
  })

  describe('disabled mode (VIKING_ENABLED unset)', () => {
    beforeEach(() => {
      delete process.env.VIKING_ENABLED
      __resetVikingConfigForTest()
    })

    it('isEnabled() returns false', () => {
      expect(isEnabled()).toBe(false)
    })

    it('health() returns disabled without HTTP', async () => {
      const r = await health()
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('disabled')
      expect(mockAxios.create).not.toHaveBeenCalled()
    })

    it('find() returns [] without HTTP', async () => {
      const r = await find({ query: 'q', pathPrefix: 'viking://user/1/' })
      expect(r).toEqual([])
      expect(mockAxios.create).not.toHaveBeenCalled()
    })

    it('write() returns false without HTTP', async () => {
      const r = await write(
        { uri: 'viking://user/1/x.md', content: 'hi' },
        'viking://user/1/',
      )
      expect(r).toBe(false)
      expect(mockAxios.create).not.toHaveBeenCalled()
    })
  })

  describe('enabled mode', () => {
    beforeEach(() => {
      process.env.VIKING_ENABLED = '1'
      process.env.VIKING_BASE_URL = 'http://openviking:1933'
      __resetVikingConfigForTest()
    })

    it('isEnabled() returns true', () => {
      expect(isEnabled()).toBe(true)
    })

    it('find() parses hits + falls back to overview/abstract field names', async () => {
      const post = vi.fn().mockResolvedValue({
        status: 200,
        data: {
          hits: [
            { uri: 'viking://user/1/a.md', l1: 'overview-A', score: 0.9 },
            { uri: 'viking://user/1/b.md', overview: 'overview-B', abstract: 'abs-B' },
            { uri: '' /* dropped */ },
          ],
        },
      })
      setupAxios({ post })
      const r = await find({ query: 'q', pathPrefix: 'viking://user/1/' })
      expect(r).toHaveLength(2)
      expect(r[0].l1).toBe('overview-A')
      expect(r[1].l1).toBe('overview-B')
      expect(r[1].l0).toBe('abs-B')
    })

    it('find() returns [] on non-2xx', async () => {
      setupAxios({ post: vi.fn().mockResolvedValue({ status: 500, data: {} }) })
      const r = await find({ query: 'q', pathPrefix: 'viking://user/1/' })
      expect(r).toEqual([])
    })

    it('find() returns [] on network error', async () => {
      setupAxios({ post: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) })
      const r = await find({ query: 'q', pathPrefix: 'viking://user/1/' })
      expect(r).toEqual([])
    })

    it('find() rejects non-viking pathPrefix', async () => {
      await expect(
        find({ query: 'q', pathPrefix: '/var/etc/passwd' as any }),
      ).rejects.toThrow(/pathPrefix/)
    })

    it('write() rejects URI violating prefix', async () => {
      // disabled 早返；这里启用后 prefix 检查在前
      await expect(
        write(
          { uri: 'viking://user/2/leak.md', content: 'x' },
          'viking://user/1/',
        ),
      ).rejects.toThrow(/violates required prefix/)
    })

    it('write() returns true on 2xx', async () => {
      setupAxios({ post: vi.fn().mockResolvedValue({ status: 201, data: { ok: true } }) })
      const r = await write(
        { uri: 'viking://user/1/x.md', content: 'hi' },
        'viking://user/1/',
      )
      expect(r).toBe(true)
    })

    it('write() returns false on 5xx', async () => {
      setupAxios({ post: vi.fn().mockResolvedValue({ status: 503, data: {} }) })
      const r = await write(
        { uri: 'viking://user/1/x.md', content: 'hi' },
        'viking://user/1/',
      )
      expect(r).toBe(false)
    })

    it('health() returns ok on 200', async () => {
      setupAxios({ get: vi.fn().mockResolvedValue({ status: 200, data: { version: '0.2.5' } }) })
      const r = await health()
      expect(r.ok).toBe(true)
      expect(r.version).toBe('0.2.5')
    })
  })

  describe('principalToPathSeg', () => {
    it('accepts plain string', () => {
      expect(principalToPathSeg('alice')).toBe('alice')
    })

    it('accepts plain number', () => {
      expect(principalToPathSeg(42)).toBe('42')
    })

    it('rejects slashes', () => {
      expect(() => principalToPathSeg('a/b')).toThrow()
      expect(() => principalToPathSeg('a\\b')).toThrow()
      expect(() => principalToPathSeg('a:b')).toThrow()
    })

    it('rejects empty', () => {
      expect(() => principalToPathSeg('')).toThrow()
      expect(() => principalToPathSeg('   ')).toThrow()
    })
  })
})
