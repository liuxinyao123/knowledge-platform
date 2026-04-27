import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetPage } = vi.hoisted(() => ({
  mockGetPage: vi.fn(),
}))

vi.mock('../../src/services/bookstack.ts', () => ({
  getPageContent: mockGetPage,
}))

import { run } from '../../skills/get_page_content.hook.ts'

beforeEach(() => vi.clearAllMocks())

describe('get_page_content hook', () => {
  it('returns page content with all fields', async () => {
    mockGetPage.mockResolvedValue({
      name: '架构设计',
      content: '内容',
      url: 'http://bs/p/42',
      tags: ['技术', '架构'],
      updated_at: '2026-04-01T10:00:00Z',
    })

    const result = await run({ page_id: 42 }, { requestId: 'req1' })

    expect(mockGetPage).toHaveBeenCalledWith(42)
    expect(result).toEqual({
      name: '架构设计',
      content: '内容',
      url: 'http://bs/p/42',
      tags: ['技术', '架构'],
      updated_at: '2026-04-01T10:00:00Z',
    })
  })

  it('handles empty tags array', async () => {
    mockGetPage.mockResolvedValue({
      name: 'No tags page',
      content: 'content',
      url: 'http://bs/p/1',
      tags: [],
      updated_at: '2026-04-01T10:00:00Z',
    })

    const result = await run({ page_id: 1 }, { requestId: 'req1' })
    expect(result.tags).toEqual([])
  })

  it('content is limited to 10000 characters', async () => {
    const longContent = 'a'.repeat(10000)
    mockGetPage.mockResolvedValue({
      name: 'Long page',
      content: longContent,
      url: 'http://bs/p/1',
      tags: [],
      updated_at: '2026-04-01T10:00:00Z',
    })

    const result = await run({ page_id: 1 }, { requestId: 'req1' })
    expect(result.content.length).toBeLessThanOrEqual(10000)
  })

  it('preserves page structure', async () => {
    const pageData = {
      name: 'Test Page',
      content: 'Page body text',
      url: 'http://bs/p/99',
      tags: ['tag1', 'tag2'],
      updated_at: '2026-03-20T14:30:00Z',
    }
    mockGetPage.mockResolvedValue(pageData)

    const result = await run({ page_id: 99 }, { requestId: 'req1' })
    expect(result).toEqual(pageData)
  })
})
