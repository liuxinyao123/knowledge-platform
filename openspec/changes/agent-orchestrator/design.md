# Design: Agent 编排层

## 架构总览

```
         POST /api/agent/dispatch (SSE)
                   │
                   ▼
         ┌────── requireAuth / enforceAcl(READ) ───────┐
         │          (unified-auth)                      │
         └─────────────────┬───────────────────────────┘
                           ▼
              ┌──────── IntentClassifier ────────┐
              │  LLM structured → confidence?    │
              │  < 0.6 or fail → keyword fallback│
              └─────────────────┬────────────────┘
                                ▼
                          AgentRegistry
                                │
              ┌─────────┬───────┴─────────┬──────────────┐
              ▼         ▼                 ▼              ▼
       KnowledgeQa  DataAdmin      StructuredQuery  MetadataOps
         Agent       Agent          (占位)            (ADMIN)
              │         │                 │              │
              └────────────── emit(SseEvent) ─────────────
                                ▼
                            Fusion (v1 = passthrough)
                                ▼
                          SSE response stream
```

## HTTP 契约

### 请求
```http
POST /api/agent/dispatch
Authorization: Bearer <jwt>
Content-Type: application/json
Accept: text/event-stream

{
  "question": "string, required",
  "session_id": "string, optional",
  "history": [
    { "role": "user" | "assistant", "content": "string" }
  ],
  "hint_intent": "knowledge_qa" | "data_admin" | "structured_query" | "metadata_ops"
}
```

- `hint_intent`：显式跳过 IntentClassifier，直接选定 Agent。主要给内部 `/api/qa/ask` 等壳使用。

### 响应事件

| type | payload | 说明 |
|---|---|---|
| `agent_selected` | `{intent, agent, confidence, reason, fallback}` | dispatch 早期发一次 |
| `rag_step` | `{icon, label}` | 透传 Agent 内部事件 |
| `content` | `{text}` | 文本流片段 |
| `trace` | `object`（Agent 自定义） | Agent 交付的可视化摘要 |
| `done` | `{}` | 终止 |
| `error` | `{message}` | 异常；后随一个 done |

所有事件仍是 `data: <json>\n\n` 纯 SSE。

## 类型

```ts
// apps/qa-service/src/agent/types.ts
export type AgentIntent =
  | 'knowledge_qa'
  | 'data_admin'
  | 'structured_query'
  | 'metadata_ops'

export interface AgentContext {
  principal: Principal                    // from unified-auth
  question: string
  session_id?: string
  history: HistoryMessage[]
  signal: AbortSignal
  emit: EmitFn                            // 沿用 knowledge-qa 的 SseEvent + 本 change 新增 agent_selected
}

export interface Agent {
  id: AgentIntent
  requiredAction: AclAction               // 多数 'READ'；metadata_ops 用 'WRITE' | 'ADMIN'
  run(ctx: AgentContext): Promise<void>
}

export interface IntentVerdict {
  intent: AgentIntent
  confidence: number                      // 0~1
  reason: string
  fallback: boolean                       // true = 走了关键字路径
}
```

## IntentClassifier

### LLM 结构化输出

```ts
const INTENT_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'classify_intent',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: [
          'knowledge_qa', 'data_admin', 'structured_query', 'metadata_ops'
        ]},
        confidence: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['intent', 'confidence', 'reason'],
    },
  },
}

async function classifyByLlm(question: string): Promise<IntentVerdict | null>
```

使用 `getLlmFastModel()`（快模型），system prompt：

```
你是意图分类器。根据用户问题判断最合适的 intent：
- knowledge_qa：查询知识库中的文档、概念、操作指南
- data_admin：创建 / 修改 / 删除知识资产、审计 / 监控数据相关
- structured_query：需要从结构化表（MySQL / 元数据表）按条件检索
- metadata_ops：对 metadata_source / asset / field / acl_rule 做 CRUD

输出 confidence（你的把握程度）和 reason（一句话解释）。
```

### 关键字 fallback

```ts
const RULES: Array<{ intent: AgentIntent; match: (q: string) => boolean }> = [
  { intent: 'metadata_ops',     match: q => /(新建|修改|删除).*(资产|元数据|字段|规则)/.test(q) },
  { intent: 'data_admin',       match: q => /(统计|总共|报表|审计|增长).*(用户|文档|问答|空间)/.test(q) },
  { intent: 'structured_query', match: q => /(表|字段|schema|SELECT|WHERE|GROUP BY)/i.test(q) },
  // 其余默认 knowledge_qa
]
```

### 调度逻辑

```
verdict = classifyByLlm(question)           // null if LLM 不可用/超时
if verdict && verdict.confidence >= 0.6 → 采用
else                                        → keyword fallback, fallback=true
```

`confidence` 阈值由 `AGENT_INTENT_THRESHOLD` env 覆盖，默认 0.6。

## AgentRegistry

```ts
// apps/qa-service/src/agent/registry.ts
export const registry: Record<AgentIntent, Agent> = {
  knowledge_qa:     new KnowledgeQaAgent(),
  data_admin:       new DataAdminAgent(),
  structured_query: new StructuredQueryAgent(),
  metadata_ops:     new MetadataOpsAgent(),
}
```

### KnowledgeQaAgent

直接调用 `knowledge-qa` change 交付的 `runRagPipeline(question, history, emit, signal)`。
`trace` 事件形状为 `knowledge-qa` 定义的 `RagTrace`。

### DataAdminAgent

包装现有 `runDataAdminPipeline`；事件直通。

### StructuredQueryAgent（占位）

```ts
async run(ctx) {
  ctx.emit({ type: 'rag_step', icon: '🧰', label: '结构化查询能力尚未实现' })
  ctx.emit({ type: 'content', text: '本功能正在建设中。' })
  ctx.emit({ type: 'trace', data: { status: 'not_implemented' } })
  ctx.emit({ type: 'done' })
}
```

### MetadataOpsAgent

- 仅允许 `ADMIN` 角色（requiredAction = `'ADMIN'`）
- Tool-calling：`list_assets / create_asset / update_asset / delete_asset / list_sources / ...`
- 每次工具调用**先**通过 `unified-auth` 的 `evaluateAcl` 再执行
- 不做写操作前的 preview；本 change 内仅允许 list / get，写操作留 `not_implemented` 响应以等后续 change

## 路由规划（plan）

```ts
interface DispatchPlan {
  steps: Array<{ intent: AgentIntent; question?: string }>
}
// Phase 1: 始终 steps.length === 1
function plan(verdict: IntentVerdict): DispatchPlan
```

保留 `plan()` 抽象，未来支持 `intent_decompose`（把一个问题拆为多 Agent 串/并执行）。

## 结果融合（fuse）

```ts
// Phase 1 = passthrough，直接透传单 Agent 的事件流
function fuse(events: AsyncIterable<SseEvent>): AsyncIterable<SseEvent>
```

## `/api/qa/ask` 向后兼容

```ts
// src/routes/qa.ts
qaRouter.post('/ask', requireAuth(), enforceAcl({action:'READ', ...}), async (req, res) => {
  req.body.hint_intent = 'knowledge_qa'
  return dispatchHandler(req, res)   // 共享 agent/dispatch 的 handler
})
```

## 测试策略

- `IntentClassifier` 单测：四类 + LLM 失败 + confidence < 0.6 → fallback
- `registry` 调度：hint_intent 跳过 classifier
- `DispatchHandler` 集成：SSE 流完整 `agent_selected → ... → done`
- `MetadataOpsAgent` 非 ADMIN 请求被 unified-auth 挡下
- `/api/qa/ask` 与直接打 `/api/agent/dispatch(hint_intent=knowledge_qa)` 行为一致

## 风险

- LLM 分类对小语料准确率未知：先上 LLM + keyword 双栈；后续用真实日志训练/调 prompt。
- `structured_query` 占位给用户"坏体验"：`agent_selected` 事件前端可以据此提示"此能力建设中，是否改问知识库？"
- 与 `unified-auth` 同时迭代：`MetadataOpsAgent` 的写操作目前全标 `not_implemented`；等 `unified-auth` ADMIN API 稳定后再做。
