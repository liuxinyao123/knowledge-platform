# Agentic RAG QA — Implementation Plan

## 文件结构

```
apps/qa-service/src/
  services/
    bookstack.ts          # 已有 — 扩展 searchPages + stripHtml
    ragPipeline.ts        # NEW — 5-step pipeline
  routes/
    qa.ts                 # 改为 SSE
  __tests__/
    ragPipeline.test.ts   # NEW
    qa.route.test.ts      # NEW

apps/web/src/knowledge/QA/
  index.tsx               # 改为 SSE 消费 + 状态机
  index.test.tsx          # 已有 — 更新 + 新增测试
```

---

## Step 1: 扩展 bookstack.ts

**File:** `apps/qa-service/src/services/bookstack.ts`

```ts
// 新增 helper
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

// 修改 searchPages
export async function searchPages(query: string, count = 15) {
  const res = await bs.get('/search', { params: { query, count } })
  return (res.data?.data ?? [])
    .filter((r: any) => r.type === 'page')
    .slice(0, 8) as any[]
}

// getPageContent 返回中加 text 字段
export async function getPageContent(id: number) {
  const res = await bs.get(`/pages/${id}`)
  const page = res.data as { id: number; name: string; html: string; url: string }
  return {
    ...page,
    text: stripHtml(page.html).slice(0, 2000),
    excerpt: stripHtml(page.html).slice(0, 200),
  }
}
```

---

## Step 2: ragPipeline.ts — 类型 + Step1

**File:** `apps/qa-service/src/services/ragPipeline.ts`

```ts
import Anthropic from '@anthropic-ai/sdk'
import { searchPages, getPageContent } from './bookstack.ts'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PageDoc { id: number; name: string; url: string; text: string; excerpt: string }
export interface Citation { index: number; page_id: number; page_name: string; page_url: string; excerpt: string }
export interface RagTrace {
  initial_results: Citation[]
  grade_result: { kept: number; total: number }
  rewrite_triggered: boolean
  rewrite_strategy?: 'step_back' | 'hyde'
  rewritten_query?: string
  final_results: Citation[]
}
export type SseEvent =
  | { type: 'rag_step'; icon: string; label: string }
  | { type: 'content'; text: string }
  | { type: 'trace'; data: RagTrace }
  | { type: 'error'; message: string }
  | { type: 'done' }
export type EmitFn = (event: SseEvent) => void

async function retrieveInitial(question: string, emit: EmitFn): Promise<PageDoc[]> {
  emit({ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' })
  const pages = await searchPages(question, 15)
  const docs = await Promise.all(pages.map((p: any) => getPageContent(p.id)))
  return docs
}
```

---

## Step 3: gradeDocs（TDD先行）

**Tests first** (`apps/qa-service/src/__tests__/ragPipeline.test.ts`):

```ts
describe('gradeDocs — fallback top2', () => {
  it('returns top-2 docs when all grade as irrelevant', async () => {
    // mock anthropic.messages.create → always returns relevant: false
    // call gradeDocs(question, 8 docs, emit)
    // expect result.gradedDocs.length === 2 (top-2 fallback)
    // expect result.rewriteNeeded === true
  })
})

describe('gradeDocs — rewriteNeeded threshold', () => {
  it('rewriteNeeded=false when >= 3 docs pass', async () => { ... })
  it('rewriteNeeded=true when < 3 docs pass', async () => { ... })
})
```

**Implementation:**

```ts
const GRADE_TOOL = {
  name: 'grade_document',
  description: 'Grade document relevance',
  input_schema: {
    type: 'object',
    properties: {
      relevant: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['relevant', 'reason'],
  },
}

export async function gradeDocs(
  question: string,
  docs: PageDoc[],
  emit: EmitFn,
): Promise<{ gradedDocs: PageDoc[]; rewriteNeeded: boolean }> {
  emit({ type: 'rag_step', icon: '📊', label: '正在评估文档相关性...' })

  const results = await Promise.all(
    docs.map(async (doc) => {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        tools: [GRADE_TOOL],
        tool_choice: { type: 'tool', name: 'grade_document' },
        messages: [{
          role: 'user',
          content: `Question: ${question}\n\nDocument: ${doc.text.slice(0, 500)}`,
        }],
      })
      const toolUse = res.content.find((c) => c.type === 'tool_use')
      const input = (toolUse as any)?.input ?? {}
      return { doc, relevant: Boolean(input.relevant) }
    }),
  )

  const relevant = results.filter((r) => r.relevant).map((r) => r.doc)
  const gradedDocs = relevant.length >= 2 ? relevant : docs.slice(0, 2)
  return { gradedDocs, rewriteNeeded: gradedDocs.length < 3 }
}
```

---

## Step 4: rewriteQuestion + retrieveExpanded（TDD先行）

**Tests:**

```ts
describe('rewriteQuestion', () => {
  it('returns step_back strategy and rewrittenQuery', async () => { ... })
  it('returns hyde strategy and rewrittenQuery', async () => { ... })
})
```

**Implementation:**

```ts
const REWRITE_TOOL = {
  name: 'rewrite_query',
  input_schema: {
    type: 'object',
    properties: {
      strategy: { type: 'string', enum: ['step_back', 'hyde'] },
      rewritten_query: { type: 'string' },
    },
    required: ['strategy', 'rewritten_query'],
  },
}

export async function rewriteQuestion(
  question: string,
  emit: EmitFn,
): Promise<{ strategy: 'step_back' | 'hyde'; rewrittenQuery: string }> {
  emit({ type: 'rag_step', icon: '✏️', label: '正在重写查询...' })
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    tools: [REWRITE_TOOL],
    tool_choice: { type: 'tool', name: 'rewrite_query' },
    messages: [{
      role: 'user',
      content: `选择最合适的查询扩展策略并重写查询。\nstep_back: 泛化具体问题\nhyde: 生成假设答案作为查询\n\n问题: ${question}`,
    }],
  })
  const toolUse = res.content.find((c) => c.type === 'tool_use')
  const input = (toolUse as any)?.input ?? {}
  return {
    strategy: input.strategy ?? 'step_back',
    rewrittenQuery: input.rewritten_query ?? question,
  }
}

export async function retrieveExpanded(
  rewrittenQuery: string,
  initialDocs: PageDoc[],
  emit: EmitFn,
): Promise<PageDoc[]> {
  emit({ type: 'rag_step', icon: '🔄', label: '使用扩展查询重新检索...' })
  const newPages = await searchPages(rewrittenQuery, 15)
  const newDocs = await Promise.all(newPages.map((p: any) => getPageContent(p.id)))
  const seen = new Set(initialDocs.map((d) => d.id))
  const merged = [...initialDocs, ...newDocs.filter((d) => !seen.has(d.id))]
  return merged
}
```

---

## Step 5: generateAnswer（TDD先行）

**Tests:**

```ts
describe('runRagPipeline abort', () => {
  it('stops emitting content when signal is aborted', async () => {
    // abort signal fires mid-stream
    // verify no content events after abort
  })
})
```

**Implementation:**

```ts
async function generateAnswer(
  question: string,
  docs: PageDoc[],
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  emit({ type: 'rag_step', icon: '💡', label: '正在生成回答...' })
  const context = docs.map((d, i) => `[${i + 1}] ${d.name}\n${d.text}`).join('\n\n---\n\n')
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: `你是知识库助手。根据以下文档回答用户问题。用[1][2]标注引用，不编造信息。\n\n${context}`,
    messages: [{ role: 'user', content: question }],
  })
  for await (const chunk of stream) {
    if (signal.aborted) { stream.abort(); break }
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      emit({ type: 'content', text: chunk.delta.text })
    }
  }
}

export async function runRagPipeline(
  question: string,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const trace: RagTrace = {
    initial_results: [], grade_result: { kept: 0, total: 0 },
    rewrite_triggered: false, final_results: [],
  }

  const initialDocs = await retrieveInitial(question, emit)
  trace.initial_results = initialDocs.map((d, i) => ({
    index: i + 1, page_id: d.id, page_name: d.name, page_url: d.url, excerpt: d.excerpt,
  }))

  const { gradedDocs, rewriteNeeded } = await gradeDocs(question, initialDocs, emit)
  trace.grade_result = { kept: gradedDocs.length, total: initialDocs.length }

  let finalDocs = gradedDocs
  if (rewriteNeeded && !signal.aborted) {
    const { strategy, rewrittenQuery } = await rewriteQuestion(question, emit)
    trace.rewrite_triggered = true
    trace.rewrite_strategy = strategy
    trace.rewritten_query = rewrittenQuery
    finalDocs = await retrieveExpanded(rewrittenQuery, gradedDocs, emit)
  }

  trace.final_results = finalDocs.map((d, i) => ({
    index: i + 1, page_id: d.id, page_name: d.name, page_url: d.url, excerpt: d.excerpt,
  }))

  if (!signal.aborted) {
    await generateAnswer(question, finalDocs, emit, signal)
    emit({ type: 'trace', data: trace })
    emit({ type: 'done' })
  }
}
```

---

## Step 6: 更新 qa.ts SSE 路由

```ts
qaRouter.post('/ask', async (req, res) => {
  const { question } = req.body as { question: string }
  if (!question?.trim()) return res.status(400).json({ error: 'question required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const ac = new AbortController()
  req.on('close', () => ac.abort())

  const emit: EmitFn = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  try {
    await runRagPipeline(question, emit, ac.signal)
  } catch (err) {
    if (!ac.signal.aborted) emit({ type: 'error', message: String(err) })
  }
  if (!res.writableEnded) res.end()
})
```

---

## Step 7: 前端 QA/index.tsx 升级

核心变更：
1. fetch 改为 SSE 消费（ReadableStream + TextDecoder 解析 `data:` 行）
2. 气泡状态机：`bubbleState: 'thinking' | 'active' | 'streaming' | 'done' | 'error'`
3. loading 时发送按钮 → 红色「■ 终止」（AbortController.abort()）
4. trace 事件 → 更新引用面板 + 折叠区

**前端测试（基于现有 QA/index.test.tsx）：**

```ts
describe('QA — SSE bubble states', () => {
  it('shows thinking bubble immediately on send')
  it('shows active state on rag_step event')
  it('shows streaming state on first content event')
  it('shows done state on done event')
})

describe('QA — abort', () => {
  it('shows abort button while loading')
  it('calls abortController.abort on click')
})

describe('QA — citations', () => {
  it('renders citation-items after trace event')
})
```

---

## Verification

```bash
# 后端测试
cd apps/qa-service && npx vitest run

# 前端测试
cd apps/web && npx vitest run src/knowledge/QA/

# TypeScript
cd apps/qa-service && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
