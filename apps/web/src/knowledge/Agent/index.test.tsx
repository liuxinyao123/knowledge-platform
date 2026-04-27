import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Agent from './index'

function renderAgent() {
  return render(
    <MemoryRouter initialEntries={['/agent']}>
      <Routes><Route path="*" element={<Agent />} /></Routes>
    </MemoryRouter>
  )
}

function mockSse(events: object[]): Response {
  const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  return { ok: true, body: stream, status: 200 } as unknown as Response
}

beforeEach(() => { localStorage.clear() })
afterEach(() => vi.restoreAllMocks())

describe('Agent — empty state', () => {
  it('renders robot emoji', () => {
    renderAgent()
    expect(screen.getByText('🤖')).toBeInTheDocument()
  })

  it('renders hint_intent select with 5 options', () => {
    renderAgent()
    const sel = screen.getByTestId('hint-intent-select') as HTMLSelectElement
    expect(sel.options).toHaveLength(5)
  })
})

describe('Agent — dispatch flow', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockSse([
      { type: 'agent_selected', data: {
        intent: 'knowledge_qa', agent: 'KnowledgeQaAgent',
        confidence: 0.92, reason: 'llm', fallback: false,
      } },
      { type: 'rag_step', icon: '🔍', label: '检索中...' },
      { type: 'content', text: 'Hello' },
      { type: 'trace', data: {
        initial_count: 3, kept_count: 2, citations: [
          { index: 1, asset_id: 7, asset_name: '手册', chunk_content: 'c1', score: 0.9 },
        ],
      } },
      { type: 'done' },
    ]))
  })

  it('POST /api/agent/dispatch with session_id + hint_intent passed through', async () => {
    renderAgent()
    fireEvent.change(screen.getByTestId('hint-intent-select'), { target: { value: 'data_admin' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '统计用户' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[0]).toBe('/api/agent/dispatch')
    const body = JSON.parse((call[1] as { body: string }).body) as {
      question: string; session_id: string; hint_intent?: string
    }
    expect(body.question).toBe('统计用户')
    expect(body.hint_intent).toBe('data_admin')
    expect(body.session_id).toMatch(/^[0-9a-f-]{20,}$/)
  })

  it('renders dispatch timeline after done', async () => {
    renderAgent()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByTestId('bubble-done')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByTestId('dispatch-timeline')).toHaveTextContent('检索中')
    // OQ-WEB-TEST-DEBT (2026-04-25)：组件把 agent name 与 "·48ms" 拼一起，纯文本断言
    // 跨多个文本节点会失败；用正则 + getAllByText 容忍
    expect(screen.getAllByText(/KnowledgeQaAgent/).length).toBeGreaterThan(0)
  })

  it('renders citation items in right panel', async () => {
    renderAgent()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByTestId('agent-citation-item')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('手册')).toBeInTheDocument()
  })
})
