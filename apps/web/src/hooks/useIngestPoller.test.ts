import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useIngestPoller } from './useIngestPoller'

vi.mock('@/api/bookstack', () => ({
  bsApi: {
    pollImport: vi.fn(),
  },
}))

import { bsApi } from '@/api/bookstack'

const mockPollImport = bsApi.pollImport as ReturnType<typeof vi.fn>

describe('useIngestPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockPollImport.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call pollImport when importId is null', () => {
    renderHook(() => useIngestPoller(null))
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(mockPollImport).not.toHaveBeenCalled()
  })

  it('calls pollImport when importId is provided', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'running',
      type: 'book',
    })

    renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockPollImport).toHaveBeenCalledWith(1)
  })

  it('stops polling when status is complete', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'complete',
      type: 'book',
    })

    renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    const callCountAfterFirst = mockPollImport.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(6000)
    })

    // Should not have polled again after complete
    expect(mockPollImport.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('stops polling when status is failed', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'failed',
      type: 'book',
    })

    renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    const callCountAfterFirst = mockPollImport.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(6000)
    })

    // Should not have polled again after failed
    expect(mockPollImport.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('returns null when no importId', () => {
    const { result } = renderHook(() => useIngestPoller(null))
    expect(result.current).toBeNull()
  })

  it('returns status and currentStep based on running status', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'running',
      type: 'book',
    })

    const { result } = renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current).not.toBeNull()
    expect(result.current?.status).toBe('running')
    expect(result.current?.currentStep).toBe(2)
  })

  it('returns currentStep 0 for pending status', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'pending',
      type: 'book',
    })

    const { result } = renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current?.currentStep).toBe(0)
  })

  it('returns currentStep 6 (all done) for complete status', async () => {
    mockPollImport.mockResolvedValue({
      id: 1,
      name: 'test',
      status: 'complete',
      type: 'book',
    })

    const { result } = renderHook(() => useIngestPoller(1))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current?.currentStep).toBe(6)
  })
})
