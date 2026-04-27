import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EmitFn, SseEvent, RagTrace } from '../ragTypes.ts'
import type { AssetChunk } from '../services/knowledgeSearch.ts'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockChatComplete = vi.fn()
const mockChatStream = vi.fn(async function* () {
  yield 'hello'
})
const mockSearchChunks = vi.fn()

vi.mock('../services/llm.ts', () => ({
  chatComplete: mockChatComplete,
  chatStream: mockChatStream,
  isLlmConfigured: vi.fn().mockReturnValue(true),
  getLlmFastModel: vi.fn().mockReturnValue('mock-fast'),
  getLlmModel: vi.fn().mockReturnValue('mock-main'),
}))

vi.mock('../services/knowledgeSearch.ts', () => ({
  searchKnowledgeChunks: (...args: unknown[]) => mockSearchChunks(...args),
  EmbeddingNotConfiguredError: class extends Error {
    constructor() {
      super('embedding not configured')
      this.name = 'EmbeddingNotConfiguredError'
    }
  },
}))

vi.mock('../services/dataAdminAgent.ts', () => ({
  isDataAdminQuestion: vi.fn().mockReturnValue(false),
  runDataAdminPipeline: vi.fn(),
}))

const mockExpandOntologyContext = vi.fn()
vi.mock('../services/ontologyContext.ts', () => ({
  expandOntologyContext: (...args: unknown[]) => mockExpandOntologyContext(...args),
}))

// Default: tests that don't explicitly set ontology should still get a well-formed empty context
// (vi.clearAllMocks in beforeEach clears call history but NOT implementations, so this persists.)
mockExpandOntologyContext.mockResolvedValue({
  entities: [],
  edges: [],
  meta: { hop_depth: 1 as const, source_chunks: 0, fallback: false, latency_ms: 0 },
})

// ── Factory ──────────────────────────────────────────────────────────────────

function makeChunks(n: number, baseScore = 0.9): AssetChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    asset_id: i + 1,
    asset_name: `Asset ${i + 1}`,
    chunk_content: `Chunk content ${i + 1}`,
    score: baseScore - i * 0.05,
    metadata: null,
  }))
}

const noopEmit: EmitFn = () => {}

function makeGradeResponse(relevant: boolean) {
  return {
    content: null,
    toolCalls: [{
      id: 'tc1', type: 'function' as const,
      function: { name: 'grade_document', arguments: JSON.stringify({ relevant, reason: 'test' }) },
    }],
    rawMessage: { role: 'assistant' as const, content: null },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('retrieveInitial — score threshold', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters out chunks with score <= 0.5', async () => {
    mockSearchChunks.mockResolvedValue([
      { asset_id: 1, asset_name: 'a', chunk_content: 'x', score: 0.9, metadata: null },
      { asset_id: 2, asset_name: 'b', chunk_content: 'x', score: 0.3, metadata: null },
      { asset_id: 3, asset_name: 'c', chunk_content: 'x', score: 0.55, metadata: null },
    ])
    const { retrieveInitial } = await import('../services/ragPipeline.ts')
    const out = await retrieveInitial('q', noopEmit)
    expect(out.map((c) => c.asset_id)).toEqual([1, 3])
  })

  it('returns empty array when search returns nothing', async () => {
    mockSearchChunks.mockResolvedValue([])
    const { retrieveInitial } = await import('../services/ragPipeline.ts')
    const out = await retrieveInitial('q', noopEmit)
    expect(out).toEqual([])
  })
})

describe('gradeDocs — fallback Top2 by score', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps top-2 by score when all graded irrelevant', async () => {
    mockChatComplete.mockResolvedValue(makeGradeResponse(false))
    const { gradeDocs } = await import('../services/ragPipeline.ts')
    // 无序 score: 0.7, 0.9, 0.6
    const docs: AssetChunk[] = [
      { asset_id: 10, asset_name: 'm', chunk_content: '', score: 0.7, metadata: null },
      { asset_id: 11, asset_name: 'h', chunk_content: '', score: 0.9, metadata: null },
      { asset_id: 12, asset_name: 'l', chunk_content: '', score: 0.6, metadata: null },
    ]
    const out = await gradeDocs('q', docs, noopEmit)
    expect(out.gradedDocs).toHaveLength(2)
    expect(out.gradedDocs[0].asset_id).toBe(11) // 0.9
    expect(out.gradedDocs[1].asset_id).toBe(10) // 0.7
    expect(out.rewriteNeeded).toBe(true)
  })

  it('parse-failure is treated as relevant (保守兜底)', async () => {
    mockChatComplete.mockResolvedValue({
      content: null,
      toolCalls: [{
        id: 'tc1', type: 'function' as const,
        function: { name: 'grade_document', arguments: 'not-json{{' },
      }],
      rawMessage: { role: 'assistant' as const, content: null },
    })
    const { gradeDocs } = await import('../services/ragPipeline.ts')
    const out = await gradeDocs('q', makeChunks(3), noopEmit)
    expect(out.gradedDocs).toHaveLength(3)
    expect(out.rewriteNeeded).toBe(false)
  })

  it('rewriteNeeded=false when >= 3 pass', async () => {
    let n = 0
    mockChatComplete.mockImplementation(async () => {
      n++
      return makeGradeResponse(n <= 4)
    })
    const { gradeDocs } = await import('../services/ragPipeline.ts')
    const out = await gradeDocs('q', makeChunks(6), noopEmit)
    expect(out.gradedDocs.length).toBeGreaterThanOrEqual(3)
    expect(out.rewriteNeeded).toBe(false)
  })

  it('empty input returns empty and rewriteNeeded=true', async () => {
    const { gradeDocs } = await import('../services/ragPipeline.ts')
    const out = await gradeDocs('q', [], noopEmit)
    expect(out.gradedDocs).toEqual([])
    expect(out.rewriteNeeded).toBe(true)
  })
})

describe('retrieveExpanded — dedupe by asset_id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('merges and dedupes by asset_id', async () => {
    mockSearchChunks.mockResolvedValue([
      { asset_id: 2, asset_name: 'b', chunk_content: '', score: 0.8, metadata: null },
      { asset_id: 3, asset_name: 'c', chunk_content: '', score: 0.7, metadata: null },
    ])
    const initial: AssetChunk[] = [
      { asset_id: 1, asset_name: 'a', chunk_content: '', score: 0.9, metadata: null },
      { asset_id: 2, asset_name: 'b', chunk_content: '', score: 0.85, metadata: null },
    ]
    const { retrieveExpanded } = await import('../services/ragPipeline.ts')
    const out = await retrieveExpanded('rewritten', initial, noopEmit)
    expect(out.map((d) => d.asset_id).sort()).toEqual([1, 2, 3])
  })
})

describe('generateAnswer — history truncation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes only last 40 history messages to chatStream', async () => {
    mockChatStream.mockClear()
    mockChatStream.mockImplementation(async function* () {
      yield 'ok'
    })
    const { generateAnswer } = await import('../services/ragPipeline.ts')
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
    }))
    const ac = new AbortController()
    await generateAnswer('latest?', makeChunks(1), history, noopEmit, ac.signal)
    expect(mockChatStream).toHaveBeenCalledTimes(1)
    const msgsArg = (mockChatStream.mock.calls[0] as any[])[0] as Array<{ content: string }>
    // 40 history + 1 current question = 41
    expect(msgsArg).toHaveLength(41)
    expect(msgsArg[0].content).toBe('msg-10') // 前 10 被截掉
    expect(msgsArg[40].content).toBe('latest?')
  })

  it('empty history → only current question', async () => {
    mockChatStream.mockClear()
    mockChatStream.mockImplementation(async function* () {
      yield 'ok'
    })
    const { generateAnswer } = await import('../services/ragPipeline.ts')
    const ac = new AbortController()
    await generateAnswer('q', makeChunks(1), [], noopEmit, ac.signal)
    const msgsArg = (mockChatStream.mock.calls[0] as any[])[0] as Array<{ content: string }>
    expect(msgsArg).toHaveLength(1)
    expect(msgsArg[0].content).toBe('q')
  })
})

describe('runRagPipeline — abort stops content + trace shape', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits no content after aborted', async () => {
    mockSearchChunks.mockResolvedValue(makeChunks(3, 0.9))
    mockChatComplete.mockResolvedValue(makeGradeResponse(true))
    const ac = new AbortController()
    ac.abort()
    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const events: string[] = []
    await runRagPipeline('q', [], (e) => events.push(e.type), ac.signal)
    expect(events).not.toContain('content')
    expect(events).not.toContain('done')
  })

  it('trace has new asset_* shape with initial_count/kept_count/citations', async () => {
    mockSearchChunks.mockResolvedValue(makeChunks(3, 0.9))
    mockChatComplete.mockResolvedValue(makeGradeResponse(true))
    mockChatStream.mockImplementation(async function* () {
      yield 'answer'
    })
    const { runRagPipeline } = await import('../services/ragPipeline.ts')
    const events: SseEvent[] = []
    const ac = new AbortController()
    await runRagPipeline('q', [], (e) => events.push(e), ac.signal)

    const traceEvt = events.find((e) => e.type === 'trace') as
      | Extract<SseEvent, { type: 'trace' }>
      | undefined
    expect(traceEvt).toBeTruthy()
    const data = traceEvt!.data as RagTrace
    expect(data.initial_count).toBe(3)
    expect(data.kept_count).toBeGreaterThanOrEqual(2)
    expect(data.citations.length).toBeGreaterThan(0)
    const c = data.citations[0]
    expect(c).toHaveProperty('asset_id')
    expect(c).toHaveProperty('asset_name')
    expect(c).toHaveProperty('chunk_content')
    expect(c).toHaveProperty('score')
    expect(data).not.toHaveProperty('page_id' as any)
  })
})

describe('OAG integration — gradeDocs prompt includes ontology_context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Scenario: OAG 有结果时 gradeDocs prompt 含 ontology_context', async () => {
    mockChatComplete.mockResolvedValue(makeGradeResponse(true))
    const { gradeDocs } = await import('../services/ragPipeline.ts')

    const ontologyContext = {
      entities: [
        { kind: 'Asset' as const, id: 'a1', label: 'Asset 1', distance: 0 as const },
        { kind: 'Source' as const, id: 's1', label: 'Source 1', distance: 1 as const },
      ],
      edges: [{ kind: 'CONTAINS' as const, from: 'a1', to: 's1' }],
      meta: { hop_depth: 1 as const, source_chunks: 1, fallback: false, latency_ms: 50 },
    }

    const docs = makeChunks(2)
    await gradeDocs('q', docs, noopEmit, { ontology: ontologyContext })

    expect(mockChatComplete).toHaveBeenCalled()
    const callArgs = mockChatComplete.mock.calls[0][0] as Array<{ content: string }>
    const content = callArgs[0].content
    expect(content).toContain('<ontology_context>')
    expect(content).toContain('Asset')
    expect(content).toContain('Source')
  })

  it('Scenario: OAG 为空时 gradeDocs prompt 不包含 ontology_context', async () => {
    mockChatComplete.mockResolvedValue(makeGradeResponse(true))
    const { gradeDocs } = await import('../services/ragPipeline.ts')

    const emptyOntology = {
      entities: [],
      edges: [],
      meta: { hop_depth: 0 as const, source_chunks: 0, fallback: true, latency_ms: 5 },
    }

    const docs = makeChunks(2)
    await gradeDocs('q', docs, noopEmit, { ontology: emptyOntology })

    expect(mockChatComplete).toHaveBeenCalled()
    const callArgs = mockChatComplete.mock.calls[0][0] as Array<{ content: string }>
    const content = callArgs[0].content
    expect(content).not.toContain('<ontology_context>')
  })

  it('Scenario: gradeDocs 无 ontology 选项时，行为不变（backward compat）', async () => {
    mockChatComplete.mockResolvedValue(makeGradeResponse(true))
    const { gradeDocs } = await import('../services/ragPipeline.ts')

    const docs = makeChunks(2)
    const result = await gradeDocs('q', docs, noopEmit)

    expect(result.gradedDocs.length).toBeGreaterThan(0)
    expect(mockChatComplete).toHaveBeenCalled()
    const callArgs = mockChatComplete.mock.calls[0][0] as Array<{ content: string }>
    const content = callArgs[0].content
    expect(content).not.toContain('<ontology_context>')
  })
})
