import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as bsApiModule from '@/api/bookstack'
import Search from './index'

vi.mock('@/api/bookstack', () => ({
  bsApi: {
    search: vi.fn(),
  },
}))

const mockSearch = bsApiModule.bsApi.search as ReturnType<typeof vi.fn>

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/search']}>
      <Search />
    </MemoryRouter>
  )
}

const makeResult = (id: number, name: string, type: 'page' | 'book' | 'bookshelf' | 'chapter' = 'page') => ({
  id,
  name,
  url: `https://example.com/${id}`,
  type,
  preview_html: {
    name,
    content: `<strong>Preview</strong> content for ${name}`,
  },
  tags: [],
})

describe('Search — API call gating', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSearch.mockResolvedValue({ data: [], total: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does NOT call bsApi.search when input has 1 character after 300ms', async () => {
    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'a' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('calls bsApi.search when input has 2+ chars after 300ms', async () => {
    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'ab' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch).toHaveBeenCalledWith('ab', 20)
  })

  it('calls bsApi.search only once when user types quickly (debounce)', async () => {
    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'a' } })
    await act(async () => { vi.advanceTimersByTime(50) })

    fireEvent.change(input, { target: { value: 'ab' } })
    await act(async () => { vi.advanceTimersByTime(50) })

    fireEvent.change(input, { target: { value: 'abc' } })
    await act(async () => { vi.advanceTimersByTime(50) })

    // Haven't hit debounce threshold yet
    expect(mockSearch).not.toHaveBeenCalled()

    // Now complete the debounce
    await act(async () => { vi.advanceTimersByTime(400) })

    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch).toHaveBeenCalledWith('abc', 20)
  })
})

describe('Search — Results rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders result items when search returns data', async () => {
    const results = [makeResult(1, 'React Basics'), makeResult(2, 'TypeScript Guide')]
    mockSearch.mockResolvedValue({ data: results, total: 2 })

    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'react' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(screen.getByText('React Basics')).toBeInTheDocument()
    expect(screen.getByText('TypeScript Guide')).toBeInTheDocument()
  })

  it('shows empty state when search returns empty array', async () => {
    mockSearch.mockResolvedValue({ data: [], total: 0 })

    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'noresults' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('clicking a result shows result name in preview panel', async () => {
    const results = [makeResult(1, 'React Basics')]
    mockSearch.mockResolvedValue({ data: results, total: 1 })

    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'react' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(screen.getByText('React Basics')).toBeInTheDocument()

    fireEvent.click(screen.getByText('React Basics'))

    // Preview panel should show the result name
    const preview = screen.getByTestId('preview-panel')
    expect(preview).toHaveTextContent('React Basics')
  })

  it('clicking ⭐ 收藏 writes to localStorage kc_favorites', async () => {
    localStorage.clear()
    const results = [makeResult(42, 'My Favorite Page')]
    mockSearch.mockResolvedValue({ data: results, total: 1 })

    renderSearch()
    const input = screen.getByRole('searchbox')

    fireEvent.change(input, { target: { value: 'favorite' } })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(screen.getByText('My Favorite Page')).toBeInTheDocument()

    // Click the result to select it
    fireEvent.click(screen.getByText('My Favorite Page'))

    // Click the favorite button
    const favBtn = screen.getByTestId('btn-favorite')
    fireEvent.click(favBtn)

    const stored = JSON.parse(localStorage.getItem('kc_favorites') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: 42, name: 'My Favorite Page' })
  })
})
