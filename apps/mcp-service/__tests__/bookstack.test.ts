import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))
vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ get: mockGet })) },
}))

import { stripHtml, searchKnowledge, getPageContent } from '../src/services/bookstack.ts'

beforeEach(() => vi.clearAllMocks())

describe('stripHtml', () => {
  it('removes html tags', () => {
    expect(stripHtml('<b>hello</b> world')).toBe('hello world')
  })
  it('collapses whitespace', () => {
    expect(stripHtml('<p>  a  </p>')).toBe('a')
  })
})

describe('searchKnowledge', () => {
  it('calls /search with query and count', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            name: 'A', type: 'page', url: 'http://bs/p/1',
            preview_html: { content: '<p>excerpt</p>' },
            book: { id: 1, name: 'KB' },
          },
        ],
      },
    })
    const result = await searchKnowledge('hello', 5)
    expect(mockGet).toHaveBeenCalledWith('/search', { params: { query: 'hello', count: 5 } })
    expect(result[0]).toMatchObject({ name: 'A', excerpt: 'excerpt', book_name: 'KB' })
  })

  it('filters by shelf_id when provided', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { books: [{ id: 10 }] } })
      .mockResolvedValueOnce({
        data: {
          data: [
            { name: 'Match', type: 'page', url: 'u1', preview_html: { content: '' }, book: { id: 10, name: 'KB' } },
            { name: 'Skip', type: 'page', url: 'u2', preview_html: { content: '' }, book: { id: 99, name: 'Other' } },
          ],
        },
      })
    const result = await searchKnowledge('x', 10, 5)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Match')
  })

  it('returns empty array when shelf_id has no matching books in results', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { books: [{ id: 10 }] } })
      .mockResolvedValueOnce({
        data: {
          data: [
            { name: 'Skip', type: 'page', url: 'u', preview_html: { content: '' }, book: { id: 99, name: 'X' } },
          ],
        },
      })
    const result = await searchKnowledge('x', 10, 5)
    expect(result).toHaveLength(0)
  })
})

describe('getPageContent', () => {
  it('returns parsed page fields', async () => {
    mockGet.mockResolvedValue({
      data: {
        name: '架构', html: '<h1>标题</h1>', url: 'http://bs/p/42',
        tags: [{ name: '技术' }, { name: '架构' }],
        updated_at: '2026-04-01T10:00:00Z',
      },
    })
    const result = await getPageContent(42)
    expect(result.name).toBe('架构')
    expect(result.content).toBe('标题')
    expect(result.tags).toEqual(['技术', '架构'])
    expect(result.updated_at).toBe('2026-04-01T10:00:00Z')
  })

  it('truncates content to 10000 chars', async () => {
    mockGet.mockResolvedValue({
      data: { name: 'X', html: 'a'.repeat(20000), url: 'u', tags: [], updated_at: '' },
    })
    const result = await getPageContent(1)
    expect(result.content.length).toBe(10000)
  })

  it('returns empty tags array when tags is missing', async () => {
    mockGet.mockResolvedValue({
      data: { name: 'Y', html: '', url: 'u', updated_at: '' },
    })
    const result = await getPageContent(1)
    expect(result.tags).toEqual([])
  })
})
