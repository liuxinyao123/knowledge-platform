import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDebounce } from './useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('does NOT update before delay completes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'initial' },
    })

    rerender({ value: 'updated' })

    // Advance time but not past the delay
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current).toBe('initial')
  })

  it('returns debounced value after delay completes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'initial' },
    })

    rerender({ value: 'updated' })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe('updated')
  })

  it('resets timer when value changes rapidly', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => { vi.advanceTimersByTime(100) })

    rerender({ value: 'abc' })
    act(() => { vi.advanceTimersByTime(100) })

    // Only 200ms since last change — should still be 'a'
    expect(result.current).toBe('a')

    // Advance past debounce
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('abc')
  })
})
