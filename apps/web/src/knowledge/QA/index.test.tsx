import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import QA from './index'

function renderQA() {
  return render(
    <MemoryRouter initialEntries={['/qa']}>
      <Routes><Route path="*" element={<QA />} /></Routes>
    </MemoryRouter>
  )
}

function mockSseResponse(events: object[]): Response {
  const sseData = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseData))
      controller.close()
    },
  })
  return { ok: true, body: stream, status: 200 } as unknown as Response
}

const defaultTraceEvent = {
  type: 'trace',
  data: {
    initial_count: 5,
    kept_count: 2,
    rewrite_triggered: false,
    citations: [{
      index: 1,
      asset_id: 10,
      asset_name: 'Doc A',
      chunk_content: '这是 Doc A 的摘要内容',
      score: 0.82,
    }],
  },
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => vi.restoreAllMocks())

describe('QA — initial empty state', () => {
  it('renders 🧠 emoji in empty state', () => {
    renderQA()
    expect(screen.getByText('🧠')).toBeInTheDocument()
  })

  it('renders empty state prompt text', () => {
    renderQA()
    expect(screen.getByText('向知识助手提问，获取精准引用答案')).toBeInTheDocument()
  })

  it('renders sample question pills', () => {
    renderQA()
    expect(screen.getAllByRole('button', { name: /知识|如何/i }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('QA — send button disabled state', () => {
  it('disables 发送 button when textarea is empty', () => {
    renderQA()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('enables 发送 button when textarea has text', () => {
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '什么是知识图谱？' } })
    expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled()
  })
})

describe('QA — SSE bubble states', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSseResponse([
        { type: 'rag_step', icon: '🔍', label: '正在检索知识库...' },
        { type: 'content', text: 'Hello ' },
        { type: 'content', text: 'World' },
        defaultTraceEvent,
        { type: 'done' },
      ])
    )
  })

  it('POST /api/qa/ask with new contract (question + session_id + history)', async () => {
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '什么是知识图谱？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[0]).toBe('/api/qa/ask')
    const body = JSON.parse((call[1] as { body: string }).body) as {
      question: string; session_id: string; history: unknown[]
    }
    expect(body.question).toBe('什么是知识图谱？')
    expect(typeof body.session_id).toBe('string')
    expect(body.session_id.length).toBeGreaterThan(8)
    expect(Array.isArray(body.history)).toBe(true)
    expect(body.history).toEqual([])                  // 首轮无历史
  })

  it('shows user message immediately after send', async () => {
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '什么是知识图谱？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // OQ-WEB-TEST-DEBT (2026-04-25)：会话列表 + 消息气泡都含同一文本，用 getAllByText 容忍
    expect(screen.getAllByText('什么是知识图谱？').length).toBeGreaterThan(0)
  })

  it('clears textarea after sending', async () => {
    renderQA()
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '什么是知识图谱？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('shows bubble-done with full content after done event', async () => {
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '测试问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByTestId('bubble-done')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByTestId('bubble-done')).toHaveTextContent('Hello World')
  })

  it('renders citation-items from trace.citations (new asset_* shape)', async () => {
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '测试问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getAllByTestId('citation-item').length).toBeGreaterThan(0), { timeout: 3000 })
    expect(screen.getByText('Doc A')).toBeInTheDocument()
    // chunk_content 截断 100 字呈现
    expect(screen.getByText(/Doc A 的摘要内容/)).toBeInTheDocument()
    // OQ-WEB-TEST-DEBT (2026-04-25)：组件改用小数显示（"0.82"），不再是 "82%"
    expect(screen.getByText(/0\.82/)).toBeInTheDocument()
  })
})

describe('QA — session_id persistence', () => {
  it('reuses existing session_id from localStorage', async () => {
    localStorage.setItem('kc_qa_session_id', 'fixed-session-xyz')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSseResponse([defaultTraceEvent, { type: 'done' }])
    )
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse(
      ((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body,
    ) as { session_id: string }
    expect(body.session_id).toBe('fixed-session-xyz')
  })

  it('generates and persists new session_id if none exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSseResponse([defaultTraceEvent, { type: 'done' }])
    )
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const stored = localStorage.getItem('kc_qa_session_id')
    expect(stored).toBeTruthy()
    expect(stored!.length).toBeGreaterThan(8)
  })
})

describe('QA — abort button', () => {
  it('shows ■ 终止 button while loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByTestId('btn-abort')).toBeInTheDocument()
  })

  it('restores send button after ■ 终止 is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const abortBtn = await screen.findByTestId('btn-abort')
    fireEvent.click(abortBtn)

    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument())
  })
})

describe('QA — API network failure', () => {
  it('shows error message when network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    renderQA()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '测试问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() =>
      expect(screen.getByTestId(/bubble-error/)).toBeInTheDocument(), { timeout: 3000 }
    )
  })
})

describe('QA — sample question pills', () => {
  it('clicking a sample question fills the textarea', () => {
    renderQA()
    fireEvent.click(screen.getAllByRole('button', { name: /知识|如何/i })[0])
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toBe('')
  })
})
