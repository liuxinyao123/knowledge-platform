import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}))

vi.mock('../../src/services/bookstack.ts', () => ({
  searchKnowledge: mockSearch,
}))

import { run } from '../../skills/search_knowledge.hook.ts'

beforeEach(() => vi.clearAllMocks())

describe('search_knowledge hook', () => {
  it('basic search returns results list', async () => {
    mockSearch.mockResolvedValue([
      {
        name: 'Doc A',
        excerpt: 'Hello',
        url: 'http://bs/p/1',
        type: 'page',
        book_name: '技术库',
      },
    ])

    const result = await run({ query: 'Hello' }, { requestId: 'req1' })

    expect(mockSearch).toHaveBeenCalledWith('Hello', 10, undefined)
    expect(result).toEqual({
      results: [
        {
          name: 'Doc A',
          excerpt: 'Hello',
          url: 'http://bs/p/1',
          type: 'page',
          book_name: '技术库',
        },
      ],
    })
  })

  it('passes count parameter', async () => {
    mockSearch.mockResolvedValue([])
    await run({ query: 'test', count: 5 }, { requestId: 'req1' })
    expect(mockSearch).toHaveBeenCalledWith('test', 5, undefined)
  })

  it('passes shelf_id parameter', async () => {
    mockSearch.mockResolvedValue([])
    await run({ query: 'test', shelf_id: 3 }, { requestId: 'req1' })
    expect(mockSearch).toHaveBeenCalledWith('test', 10, 3)
  })

  it('uses default count of 10', async () => {
    mockSearch.mockResolvedValue([])
    await run({ query: 'x' }, { requestId: 'req1' })
    expect(mockSearch).toHaveBeenCalledWith('x', 10, undefined)
  })

  it('returns empty results when no matches', async () => {
    mockSearch.mockResolvedValue([])
    const result = await run({ query: 'nonexistent' }, { requestId: 'req1' })
    expect(result.results).toEqual([])
  })
})
