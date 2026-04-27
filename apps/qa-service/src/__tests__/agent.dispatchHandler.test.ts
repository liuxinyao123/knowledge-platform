import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock('../services/db.ts', () => ({
  getPool: () => ({ execute: vi.fn().mockResolvedValue([[{ role: 'admin' }], []]) }),
}))

const mockClassify = vi.fn()
vi.mock('../agent/classify.ts', () => ({
  classify: (...args: unknown[]) => mockClassify(...args),
}))

// 替换所有 Agent 为可观察的 stub
vi.mock('../agent/registry.ts', async (orig) => {
  const real = await orig<typeof import('../agent/registry.ts')>()
  const mk = (id: string) => ({
    id,
    requiredAction: 'READ' as const,
    run: vi.fn(async (ctx: { emit: (e: unknown) => void }) => {
      ctx.emit({ type: 'rag_step', icon: '✅', label: `stub ${id}` })
      ctx.emit({ type: 'content', text: `from ${id}` })
      ctx.emit({ type: 'trace', data: { agent: id } })
      ctx.emit({ type: 'done' })
    }),
  })
  return {
    ...real,
    getAgent: (intent: string) => mk(intent),
    registry: () => ({}),
    __setAgentForTest: () => {},
  }
})

// ── App builder ──────────────────────────────────────────────────────

async function buildApp() {
  const { dispatchHandler } = await import('../agent/dispatchHandler.ts')
  const { requireAuth } = await import('../auth/requireAuth.ts')

  const app = express()
  app.use(express.json())
  app.post('/api/agent/dispatch', requireAuth(), dispatchHandler)
  return app
}

function parseSse(text: string): Array<{ type: string; [k: string]: unknown }> {
  const out: Array<{ type: string; [k: string]: unknown }> = []
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        try { out.push(JSON.parse(line.slice(6))) } catch {}
      }
    }
  }
  return out
}

// ── Tests ────────────────────────────────────────────────────────────

describe('dispatchHandler — happy path', () => {
  beforeEach(() => {
    delete process.env.AUTH_HS256_SECRET
    delete process.env.AUTH_JWKS_URL
    delete process.env.NODE_ENV
    vi.clearAllMocks()
    mockClassify.mockResolvedValue({
      intent: 'knowledge_qa', confidence: 0.9, reason: 'llm', fallback: false,
    })
  })

  it('emits agent_selected → content → trace → done', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/agent/dispatch').send({ question: 'hi' })
    expect(res.status).toBe(200)
    const events = parseSse(res.text)
    const types = events.map((e) => e.type)
    expect(types[0]).toBe('agent_selected')
    expect(types).toContain('content')
    expect(types).toContain('trace')
    expect(types[types.length - 1]).toBe('done')
  })

  it('hint_intent skips classifier', async () => {
    const app = await buildApp()
    await request(app).post('/api/agent/dispatch')
      .send({ question: 'hi', hint_intent: 'data_admin' })
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it('agent_selected.data carries intent + confidence + fallback', async () => {
    mockClassify.mockResolvedValue({
      intent: 'data_admin', confidence: 0.85, reason: 'r', fallback: false,
    })
    const app = await buildApp()
    const res = await request(app).post('/api/agent/dispatch').send({ question: '统计' })
    const events = parseSse(res.text)
    const selected = events.find((e) => e.type === 'agent_selected') as unknown as {
      data: { intent: string; confidence: number; fallback: boolean }
    }
    expect(selected.data.intent).toBe('data_admin')
    expect(selected.data.confidence).toBe(0.85)
    expect(selected.data.fallback).toBe(false)
  })
})

describe('dispatchHandler — validation', () => {
  beforeEach(() => {
    delete process.env.AUTH_HS256_SECRET
    delete process.env.NODE_ENV
  })

  it('returns 400 when question missing', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/agent/dispatch').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/question/)
  })

  it('returns 400 for invalid hint_intent', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/agent/dispatch')
      .send({ question: 'x', hint_intent: 'totally_fake' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid history role', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/agent/dispatch')
      .send({ question: 'x', history: [{ role: 'system', content: 'x' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/history role/)
  })
})
