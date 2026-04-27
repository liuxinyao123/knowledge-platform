# Design: Agentic RAG QA

## 后端架构

### 文件结构

```
apps/qa-service/src/
├── services/
│   ├── bookstack.ts      # 已有，扩展 searchPages count=15, top8 pages
│   └── ragPipeline.ts    # NEW：5-step pipeline，含 emit 回调
├── routes/
│   └── qa.ts             # 改为 SSE 响应
└── index.ts              # 不变
```

### 数据类型

```ts
interface PageDoc {
  id: number
  name: string
  url: string
  text: string    // html stripped, truncated 2000 chars
  excerpt: string // first 200 chars for citation
}

interface RagTrace {
  initial_results: Citation[]
  grade_result: { kept: number; total: number }
  rewrite_triggered: boolean
  rewrite_strategy?: 'step_back' | 'hyde'
  rewritten_query?: string
  final_results: Citation[]
}

interface Citation {
  index: number
  page_id: number
  page_name: string
  page_url: string
  excerpt: string
}

type SseEvent =
  | { type: 'rag_step'; icon: string; label: string }
  | { type: 'content'; text: string }
  | { type: 'trace'; data: RagTrace }
  | { type: 'error'; message: string }
  | { type: 'done' }

type EmitFn = (event: SseEvent) => void
```

### ragPipeline.ts 设计

```ts
// 主入口
export async function runRagPipeline(
  question: string,
  emit: EmitFn,
  signal: AbortSignal
): Promise<void>
```

**Step 1 — retrieveInitial(question, emit)**
- `bookstackClient.get('/search', { query, count: 15 })` → filter `type=page` → slice(0,8)
- `Promise.all(ids.map(getPageContent))` — 并发拉全文
- html → stripHtml() → slice(0, 2000)
- emit `{ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' }`

**Step 2 — gradeDocs(question, docs, emit)**
- 调用 claude-haiku-4-5，`tool_choice: { type: 'tool', name: 'grade' }` + tool schema `{ relevant: bool, reason: string }`
- 并发打分（Promise.all）
- 过滤：取 relevant=true；若数量 < 2，保底取原始 top2
- emit `{ type: 'rag_step', icon: '📊', label: '正在评估文档相关性...' }`
- return `{ gradedDocs, rewriteNeeded: gradedDocs.length < 3 }`

**Step 3 — rewriteQuestion(question, emit)** （仅 rewriteNeeded 时调用）
- 调用 claude-sonnet-4-6，structured output 选策略：`'step_back' | 'hyde'`
  - step_back：生成更宽泛的查询（泛化）
  - hyde：生成假设答案作为查询（HyDE）
- emit `{ type: 'rag_step', icon: '✏️', label: '正在重写查询...' }`
- return `{ strategy, rewrittenQuery }`

**Step 4 — retrieveExpanded(rewrittenQuery, initialDocs, emit)**
- 同 Step 1，用重写后的 query 检索
- 合并：`[...initialDocs, ...newDocs]`，按 id 去重
- emit `{ type: 'rag_step', icon: '🔄', label: '使用扩展查询重新检索...' }`

**Step 5 — generateAnswer(question, finalDocs, emit, signal)**
- 构建 context：`finalDocs.map((d,i) => '[${i+1}] ${d.name}\n${d.text}')`
- `anthropic.messages.stream({ model: 'claude-sonnet-4-6', ... })` with signal
- 逐 token：emit `{ type: 'content', text: delta }`
- 完成后：emit `{ type: 'trace', data: ragTrace }`
- emit `{ type: 'done' }`
- emit `{ type: 'rag_step', icon: '💡', label: '正在生成回答...' }`

### qa.ts SSE 路由

```ts
qaRouter.post('/ask', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const ac = new AbortController()
  req.on('close', () => ac.abort())

  const emit: EmitFn = (event) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
  }

  try {
    await runRagPipeline(question, emit, ac.signal)
  } catch (err) {
    if (!ac.signal.aborted) {
      emit({ type: 'error', message: '...' })
    }
  }
  res.end()
})
```

---

## 前端架构

### 状态机

```ts
type BubbleState = 'idle' | 'thinking' | 'active' | 'streaming' | 'done' | 'error'

interface AiMessage {
  id: string
  bubbleState: BubbleState
  ragSteps: { icon: string; label: string }[]
  content: string       // 流式累积
  trace: RagTrace | null
  traceOpen: boolean    // RAG 过程折叠区
}
```

### SSE 消费

```ts
const reader = res.body.getReader()
// 解析 'data: {...}\n\n' 格式
// switch(event.type):
//   'rag_step' → append to ragSteps, bubbleState = 'active'
//   'content'  → bubbleState = 'streaming', content += text
//   'trace'    → set trace
//   'done'     → bubbleState = 'done'
//   'error'    → bubbleState = 'error'
```

### 组件变更（QA/index.tsx）

1. **思考气泡**（AiMessageBubble）
   - `thinking`: 三点跳动 `⋅⋅⋅` CSS animation
   - `active`: 步骤列表（icon + label，每行）
   - `streaming`: 已有内容 + 光标闪烁
   - `done`: 完整内容 + 折叠区

2. **终止按钮**
   - loading 时：发送按钮变为红色「■ 终止」，`onClick: abortController.abort()`

3. **引用面板**（右侧）
   - 收到 `trace` 后显示 `final_results`
   - 回答中 `[1]` → `<sup>` 上标，点击高亮对应引用行

4. **RAG 折叠区**（气泡底部）
   - `检索 N 篇 → 保留 M 篇 → [触发重写: step_back/hyde]`
   - `<details>` / 状态折叠

---

## Anthropic SDK 用法

```ts
// Grade (haiku, tool_use structured output)
await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 100,
  tools: [gradeToolSchema],
  tool_choice: { type: 'tool', name: 'grade_document' },
  messages: [...]
})

// Generate (sonnet stream)
const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 2000,
  system: systemPrompt,
  messages: [{ role: 'user', content: question }],
})
for await (const chunk of stream) {
  if (signal.aborted) { stream.abort(); break }
  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
    emit({ type: 'content', text: chunk.delta.text })
  }
}
```
