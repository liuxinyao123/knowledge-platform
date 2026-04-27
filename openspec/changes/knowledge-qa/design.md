# Design: 知识问答（Agentic RAG · 基于 pgvector）

## 架构总览

```
┌────────── Web (QA/index.tsx) ──────────┐
│  messages[] + history                  │
│  SSE consumer (fetch + ReadableStream) │
│  AbortController → 终止                │
└────────────┬───────────────────────────┘
             │ POST /api/qa/ask   (SSE)
             ▼
┌────────── qa-service/qa.ts ────────────┐
│  setHeader text/event-stream           │
│  emit = (evt) => res.write(...)        │
│  runRagPipeline(question, history,     │
│                 emit, signal)          │
└────────────┬───────────────────────────┘
             ▼
┌────── services/ragPipeline.ts ─────────┐
│ Step1 retrieveInitial                  │
│   → POST /api/knowledge/search         │
│   → filter score > 0.5                 │
│ Step2 gradeDocs (function-call)        │
│ Step3 rewriteQuestion (cond < 3)       │
│ Step4 generateAnswer (stream)          │
│ Step5 emit trace + done                │
└────────────────────────────────────────┘
```

## HTTP 契约

### 请求

```http
POST /api/qa/ask
Content-Type: application/json
Accept: text/event-stream

{
  "question": "string, required",
  "session_id": "string, optional",
  "history": [
    { "role": "user" | "assistant", "content": "string" }
  ]
}
```

- `history` 最多 20 轮（40 条）；超过由前端截断，后端再做一次兜底截断。
- `session_id` 服务端只做日志打点，不做状态查询。

### 响应（SSE 事件流）

每条事件使用 `data: <json>\n\n`，`event:` 字段未使用（纯 data SSE）。

| `type` | payload | 说明 |
|---|---|---|
| `rag_step` | `{ icon: string, label: string }` | 流水线阶段提示 |
| `content` | `{ text: string }` | 逐 token 文本（拼接展示） |
| `trace` | `RagTrace`（下见） | 仅在答案生成结束前发送 1 次 |
| `done` | `{}` | 流结束 |
| `error` | `{ message: string }` | 中断；后面会再跟一个 `done` |

## 类型定义（TypeScript）

```ts
// apps/qa-service/src/ragTypes.ts
export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}

export interface RagTrace {
  initial_count: number          // retrieveInitial 返回条数（过阈值后）
  kept_count: number             // gradeDocs 保留条数
  rewrite_triggered: boolean
  rewrite_strategy?: 'step_back' | 'hyde'
  rewritten_query?: string
  citations: Citation[]          // 最终送入 generateAnswer 的文档
}

export type SseEvent =
  | { type: 'rag_step'; icon: string; label: string }
  | { type: 'content';  text: string }
  | { type: 'trace';    data: RagTrace }
  | { type: 'done' }
  | { type: 'error';    message: string }

export type EmitFn = (event: SseEvent) => void

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}
```

## ragPipeline 改造点

```ts
// 入口签名变更
export async function runRagPipeline(
  question: string,
  history: HistoryMessage[],          // NEW
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void>
```

### Step 1 — retrieveInitial

```ts
// 不再调用 searchPagesByVector / BookStack fallback
// 改为内部 HTTP 或直接复用 knowledgeDocs 的搜索 handler
const raw = await knowledgeSearch({ query: question, top_k: 10 })
const filtered = raw.filter(r => r.score > 0.5)
emit({ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' })
```

选择**直接函数调用** `knowledgeSearch(...)`（从 routes/knowledgeDocs.ts 抽出 service
函数 `searchKnowledgeChunks`），避免进程内自环 HTTP。

### Step 2 — gradeDocs（保留 function-calling + 对外语义 yes/no）

```ts
// 仍用 GRADE_TOOL，但对外返回 { relevant: boolean }
// 保底：若过滤后不足 2 条，按 score 降序保留 Top2
if (kept.length < 2) kept = sortByScore(initial).slice(0, 2)
```

### Step 3 — rewriteQuestion（`gradedDocs.length < 3` 触发）

保留现有 `step_back` / `hyde` 双策略。合并结果按 `asset_id` 去重。

### Step 4 — generateAnswer（流式 + 历史对话）

```ts
const context = docs.map((d, i) =>
  `[${i + 1}] ${d.asset_name}\n${d.chunk_content}`
).join('\n\n---\n\n')

const messages: ChatMessage[] = [
  ...history.slice(-40),                // 兜底截断
  { role: 'user', content: question },
]

const stream = chatStream(messages, {
  model: getLlmModel(),                 // 目前为 env 配置，建议默认 claude-sonnet-4-6
  maxTokens: 2000,
  system: `你是知识库助手。根据以下文档内容回答用户问题。
用 [1][2] 等标注引用来源，只使用提供的文档，不编造信息。

文档内容：
${context}`,
})
```

### Step 5 — trace + done

```ts
emit({
  type: 'trace',
  data: {
    initial_count, kept_count,
    rewrite_triggered, rewrite_strategy, rewritten_query,
    citations: finalDocs.map((d, i) => ({
      index: i + 1,
      asset_id: d.asset_id,
      asset_name: d.asset_name,
      chunk_content: d.chunk_content.slice(0, 500),
      score: d.score,
    })),
  },
})
emit({ type: 'done' })
```

## 前端改造点（apps/web/src/knowledge/QA/）

- `sendMessage()` 入参改为 `{ question, session_id, history }`，`history` 由前端
  累计上一轮若干消息（默认 10 轮，可调）。
- `trace` 消费端按新字段显示：`检索 {initial_count} 篇 → 保留 {kept_count} 篇`；
  有 `rewrite_triggered` 时展示 `rewrite_strategy` 与 `rewritten_query`。
- `citations` 渲染改为 `asset_name + chunk_content 摘要(前 100 字) + score`，
  保留 `[n]` 上标点击高亮的行为。
- `session_id` 由前端生成 uuid 存 localStorage（`kc_qa_session_id`），送入请求。

## 向量模型与索引

- 继续使用硅基流动 `Qwen/Qwen3-Embedding-8B`（D-002）。
- `metadata_field` 表现有向量直接复用；**本 change 不触发重建**。

## 测试策略

单元（qa-service）：
- `retrieveInitial` 阈值过滤与空结果分支；
- `gradeDocs` 保底 Top2 / function-call 解析失败兜底；
- `rewriteQuestion` 触发条件（`kept < 3`）；
- `runRagPipeline` AbortSignal 生效（中断不继续 emit content）；
- `history` 截断（>40 时按末尾 40 条送入 LLM）。

单元（web）：
- SSE 消费器三状态切换（thinking → active rag → streaming）；
- `trace` 新字段渲染；
- `session_id` 生成与 localStorage 持久化；
- 终止按钮调用 `abort()` 后停止接收。

接口契约（验收）：
- Given `query="登录接口是什么"`，Then SSE 流完整经过 5 个 type 且 trace.citations 不为空。

## 迁移与向后兼容

- `POST /api/qa/ask` 请求字段向后兼容：`session_id` 和 `history` 可选；不提供时等价于当前单轮行为。
- 响应字段 **不** 向后兼容：`trace.page_*` → `trace.citations[].asset_*`。需要下游（Agent / MCP）同步升级消费代码。归档前确认没有其他隐式消费者。

## 风险

- **pgvector 索引覆盖不足**：BookStack 搜索 fallback 下线后，冷启动/新空间未回填可能影响召回；需要在 D-002 ADR 里备注 `sync-bookstack.ts` 全量回灌作为前置。
- **History 注入攻击**：history 字段由前端构造，需校验 `role`/`content` 类型，拒绝过长单条（> 8000 字符）。
- **Grade 的 LLM 调用放大**：Top10 × 每条一次打分，并发 10 次 LLM 调用；需复用 `chatComplete` 的并发池与超时。
