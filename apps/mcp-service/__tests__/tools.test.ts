import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSearch, mockGetPage } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockGetPage: vi.fn(),
}))
vi.mock('../src/services/bookstack.ts', () => ({
  searchKnowledge: mockSearch,
  getPageContent: mockGetPage,
}))

import { runSearchKnowledge } from '../src/tools/search_knowledge.ts'
import { runGetPageContent } from '../src/tools/get_page_content.ts'

beforeEach(() => vi.clearAllMocks())

describe('runSearchKnowledge', () => {
  it('calls searchKnowledge with defaults and returns JSON', async () => {
    mockSearch.mockResolvedValue([
      { name: 'A', excerpt: 'ex', url: 'u', type: 'page', book_name: 'KB' },
    ])
    const res = await runSearchKnowledge({ query: 'hello' })
    expect(mockSearch).toHaveBeenCalledWith('hello', 10, undefined)
    expect(JSON.parse(res)).toMatchObject({ results: [{ name: 'A' }] })
  })

  it('passes count and shelf_id', async () => {
    mockSearch.mockResolvedValue([])
    await runSearchKnowledge({ query: 'x', count: 5, shelf_id: 3 })
    expect(mockSearch).toHaveBeenCalledWith('x', 5, 3)
  })
})

describe('runGetPageContent', () => {
  it('calls getPageContent and returns JSON string', async () => {
    mockGetPage.mockResolvedValue({
      name: 'P', content: 'c', url: 'u', tags: [], updated_at: '',
    })
    const res = await runGetPageContent({ page_id: 42 })
    expect(mockGetPage).toHaveBeenCalledWith(42)
    expect(JSON.parse(res)).toMatchObject({ name: 'P' })
  })
})
