import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as bsApiModule from '@/api/bookstack'
import Overview from './index'

vi.mock('@/api/bookstack', () => ({
  bsApi: {
    getShelves: vi.fn(),
    getBooks: vi.fn(),
    getPages: vi.fn(),
    getShelf: vi.fn(),
  },
}))

const mockBsApi = bsApiModule.bsApi as unknown as {
  getShelves: ReturnType<typeof vi.fn>
  getBooks: ReturnType<typeof vi.fn>
  getPages: ReturnType<typeof vi.fn>
  getShelf: ReturnType<typeof vi.fn>
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('Overview — Skeleton', () => {
  it('shows skeleton cards while loading', async () => {
    mockBsApi.getShelves.mockReturnValue(new Promise(() => {}))
    mockBsApi.getBooks.mockReturnValue(new Promise(() => {}))
    mockBsApi.getPages.mockReturnValue(new Promise(() => {}))

    renderWithQuery(<Overview />)

    const skeletons = document.querySelectorAll('[data-testid="metric-skeleton"]')
    expect(skeletons.length).toBe(4)
  })
})

describe('Overview — 近 7 天新增文档数', () => {
  beforeEach(() => {
    const now = new Date('2026-04-17T00:00:00Z')
    vi.setSystemTime(now)
  })

  it('counts pages updated within the last 7 days', async () => {
    const pages = [
      { id: 1, name: 'Recent', updated_at: '2026-04-15T12:00:00Z', url: '', book_id: 1, chapter_id: 0, slug: '', draft: false, template: false, created_at: '' },
      { id: 2, name: 'Old', updated_at: '2026-04-01T12:00:00Z', url: '', book_id: 1, chapter_id: 0, slug: '', draft: false, template: false, created_at: '' },
      { id: 3, name: 'VeryOld', updated_at: '2026-03-01T12:00:00Z', url: '', book_id: 1, chapter_id: 0, slug: '', draft: false, template: false, created_at: '' },
    ]

    mockBsApi.getShelves.mockResolvedValue({ data: [], total: 0 })
    mockBsApi.getBooks.mockResolvedValue({ data: [], total: 0 })
    mockBsApi.getPages.mockResolvedValue({ data: pages, total: 3 })

    renderWithQuery(<Overview />)

    const card = await screen.findByTestId('metric-recent')
    expect(card).toHaveTextContent('1')
  })
})

describe('Overview — 活跃空间 Top5', () => {
  it('shows shelves sorted by book count descending', async () => {
    const shelves = [
      { id: 1, name: 'Shelf A', slug: 'a', description: '', url: '', created_at: '', updated_at: '' },
      { id: 2, name: 'Shelf B', slug: 'b', description: '', url: '', created_at: '', updated_at: '' },
    ]
    mockBsApi.getShelves.mockResolvedValue({ data: shelves, total: 2 })
    mockBsApi.getBooks.mockResolvedValue({ data: [], total: 0 })
    mockBsApi.getPages.mockResolvedValue({ data: [], total: 0 })
    mockBsApi.getShelf.mockImplementation((id: number) => {
      if (id === 1) return Promise.resolve({ ...shelves[0], books: [{ id: 10 }, { id: 11 }] })
      if (id === 2) return Promise.resolve({ ...shelves[1], books: [{ id: 20 }, { id: 21 }, { id: 22 }] })
    })

    renderWithQuery(<Overview />)

    const items = await screen.findAllByTestId('active-shelf-item')
    expect(items[0]).toHaveTextContent('Shelf B')
    expect(items[1]).toHaveTextContent('Shelf A')
  })
})
