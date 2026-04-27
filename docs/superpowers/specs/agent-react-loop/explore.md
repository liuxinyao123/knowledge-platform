# Explore · KnowledgeQaAgent 升级为 ReACT 循环

> 工作流 B · `superpowers-openspec-execution-workflow`
> 来源：OQ-AGENT-1（`.superpowers-memory/open-questions.md`）· ADR-39 D-001/D-004
> Phase：Explore（不进主分支，OpenSpec 合并后归档到 `docs/superpowers/archive/agent-react-loop/`）

---

## 1. 动机

### 现存模式

`agent/agents/KnowledgeQaAgent.ts` 一共 14 行：

```ts
async run(ctx: AgentContext): Promise<void> {
  await runRagPipeline(ctx.question, ctx.history, ctx.emit, ctx.signal, {
    spaceId: ctx.spaceId,
    principal: ctx.principal,
  })
}
```

—— 一次性把请求交给 `ragPipeline`，走 `retrieveInitial → rerank → gradeDocs → (rewriteQuestion) → generateAnswer` 固定线性管线。LLM 不做路线判断，管线本身是固定的。

### 期望模式

让 LLM **每轮自主选择**下一步动作（检索 / 改写 / 查图 / 回答），**迭代推进**，必要时 **反思** 并重新规划。这才是 WeKnora 那种"智能推理模式"的定义。

### 关键发现：基础设施已在仓库里

1. **tool-call 循环模板**：`services/dataAdminAgent.ts:runDataAdminPipeline` 已经是完整的 ReACT：8 轮 for 循环，`chatComplete({ tools })` + 返回 `toolCalls` → 执行 → 回填 `role:'tool'` 消息 → 再次调 LLM，没有 toolCalls 即退出。本 change 就是**把这个模式嫁接到 KnowledgeQaAgent**。
2. **`llm.ts.chatComplete`** 已支持 `tools` 与 `toolChoice`，`tagExtract.ts` 已经在兜底 "开源模型不吃 tool_choice" 的情形——这些 corner case 不是本 change 的问题。
3. **SSE 事件协议**：`rag_step` / `content` / `citations` / `trace` / `done` 已经在前端处理。新增事件类型老客户端会自动忽略（验证过，ontology 三件套新增 `ontology_context` 事件无回归）。

所以"升级 ReACT"的增量工作量比预想小很多，关键在**边界设计**与**兜底安全**。

---

## 2. 读的代码

- `apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts`（14 行，待替换）
- `apps/qa-service/src/agent/dispatchHandler.ts`（上游，不动）
- `apps/qa-service/src/services/ragPipeline.ts`（源语义，要抽解成 ReACT 可用的工具原语）
- `apps/qa-service/src/services/dataAdminAgent.ts`（tool-call 循环模板）
- `apps/qa-service/src/services/llm.ts`（chatComplete signatures，tools 字段）
- `apps/qa-service/src/services/ontologyContext.ts`（已有的图扩展，作为 ReACT 工具之一）
- `apps/qa-service/src/services/hybridSearch.ts`（vector + BM25 + RRF）
- `apps/qa-service/src/services/reranker.ts`（cross-encoder rerank）

---

## 3. 候选方案评估

| 方案 | 改动面 | 风险 | 评分 |
|---|---|---|---|
| A `KnowledgeQaAgent.run` **完全替换**为 ReACT 循环，弃用 `runRagPipeline` | 大 | 召回链路失去"线性管线"保障；多轮 LLM 成本放大；既有测试全挂 | ✗ |
| B **ReACT 循环包一层**，把 `runRagPipeline` 整体作为工具之一 `run_rag_pipeline()`；同时新增细粒度工具 | 中 | 最大可能保留现有保障；LLM 若直接喊 `run_rag_pipeline` 即降级为当前行为 | 可 |
| C **Feature flag + 双路**：`AGENT_REACT_ENABLED=false` 默认关，`?mode=react` 时才启用；关闭时走老 `runRagPipeline` | 中 | 验收期可并存对比；成本可控 | ✓ **本 change 采用** |
| D 只在 Dispatch 层 intent 判为"复杂推理"时启用 ReACT | 大 | 意图识别准确率成瓶颈，可能错判 | 未来 |

**选 C** 的理由：

- 用户诉求"OAG Phase 1 已上 + eval 基线触顶"的格局下，ReACT 是**可选能力增强**而不是替代。双路 + feature flag 让 eval 和用户 A/B 测试都能做。
- Dispatch 层 `intentClassifier` 完全不动，架构分层清晰：Dispatch 选 Agent，Agent 内部选 mode。
- 关闭 flag 时行为字节级等同于今天，零回归风险。

---

## 4. 推荐范围

### 4.1 工具集（ReACT 模式下 LLM 可调）

| 工具 | 参数 | 描述 |
|---|---|---|
| `search_knowledge` | `{ query, top_k?, scope? }` | 向量/混合检索；等同 `hybridSearch` + `rerank` 后返回 top-K chunk（精简字段）|
| `query_graph` | `{ asset_ids, max_hop? }` | 调 `expandOntologyContext`，返回实体与边（复用 Phase 1 产物） |
| `rewrite_question` | `{ original, reason }` | 调现有 `rewriteQuestion`，返回改写版 |
| `reflect` | `{ observations }` | 不调 LLM 本身（避免递归），由应用层记录反思文本到 SSE，下一轮 prompt 会看到 |
| `compose_answer` | `{ chunks, ontology_context?, citations? }` | 最终答：调 `generateAnswer`，流式 emit `content` + `citations`；返回 `done` 信号 |
| `run_rag_pipeline` | `{ question }` | **逃生工具**：LLM 决定放弃 ReACT 降级为老管线。MVP 阶段保留，观察调用率后决定是否移除 |

### 4.2 循环形状

```ts
// KnowledgeQaAgent.run（ReACT 分支）伪代码
const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: question }]
let reflections = 0

for (let round = 0; round < AGENT_MAX_ITERATIONS; round++) {
  if (signal.aborted) return
  emit({ type: 'rag_step', icon: '🧠', label: `ReACT 第 ${round + 1} 轮` })

  const { content, toolCalls, rawMessage } = await chatComplete(messages, {
    model: getLlmModel(), tools: REACT_TOOLS, maxTokens: 2048,
  })

  if (content) emit({ type: 'content', text: content })
  if (!toolCalls.length) break   // LLM 无进一步动作 = 已回答
  messages.push(rawMessage)

  // **并行** 执行 tool calls（关键差异 vs dataAdminAgent 的串行）
  const results = await Promise.all(toolCalls.map(tc => {
    emit({ type: 'tool_call_started', tool: tc.function.name, call_id: tc.id })
    return execTool(tc.function.name, JSON.parse(tc.function.arguments), ctx)
  }))
  results.forEach((out, i) => {
    const tc = toolCalls[i]
    emit({ type: 'tool_call_finished', tool: tc.function.name, call_id: tc.id, ok: !out.error })
    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) })
  })

  // 反思：检测到关键失败（如 search_knowledge 返回 0 chunk）且未到上限时，追加反思
  if (shouldReflect(results) && reflections < AGENT_MAX_REFLECTIONS) {
    reflections++
    messages.push({ role: 'user', content: `[reflection] ${summariseFailure(results)}。请重新规划：考虑 rewrite_question 或换 scope。` })
    emit({ type: 'reflection', count: reflections })
  }
}
emit({ type: 'done' })
```

### 4.3 新增 SSE 事件

- `tool_call_started` `{ tool, call_id, args_preview? }`
- `tool_call_finished` `{ tool, call_id, ok, latency_ms }`
- `reflection` `{ count, reason }`

（老事件 `rag_step / content / citations / trace / done` 全保留。）

### 4.4 Env vars

```
AGENT_REACT_ENABLED           默认 false
AGENT_MAX_ITERATIONS          默认 5
AGENT_MAX_REFLECTIONS         默认 2
AGENT_REACT_MODEL             默认 LLM_MODEL（可单独指定更强模型）
AGENT_REACT_TOOL_TIMEOUT_MS   默认 10000（单工具超时；超时视为失败）
```

### 4.5 Out of Scope

- **Code interpreter / sandboxed Python**（WeKnora 有，但我们无明确需求）；
- **外部 MCP 工具作为 ReACT 工具**（OQ-MCP-CLIENT 尚未登记；另立 change）；
- **其他 3 个 Agent**（data_admin / structured_query / metadata_ops）ReACT 化；
- **多模态工具**（图片理解已在 VLM caption 里做，ReACT 内不重复）；
- **基于 Dispatch 意图自适应启用 ReACT**（见方案 D，未来 change）。

---

## 5. 风险

### 高

- **成本爆炸**：每轮多一次 LLM call；5 轮 × 2 反思在最坏情况下单问 ≥ 7 次 LLM。必须硬 bound + 监控 + 告警。
- **死循环**：工具调用结果畸形（比如 JSON 解析失败）时 LLM 可能反复调同一个工具。**防御**：重复 signature 连续 2 次即视为卡死，强制 break。
- **Regression**：当前 `ragPipeline` 的 7 层兜底（ADR 2026-04-23-22/24）经过 BUG-01 / BUG-H 实战洗礼；ReACT 版本需要把相同的兜底刻进工具定义。具体：
  - `compose_answer` 工具必须保留 `RAG_NO_LLM_THRESHOLD` / `RAG_RELEVANCE_WARN_THRESHOLD` 短路逻辑；
  - Notebook scope 豁免不能丢（D-008）。

### 中

- **Latency**：单轮 RAG 当前 p95 约 3-5s；ReACT 5 轮可能到 15-25s。SSE 流式能缓解感知但真实时延还在。**缓解**：Feature flag 关闭时完全不走 ReACT。
- **"多跳需求占比"未量化**：OQ-AGENT-1 的启动前置是"多跳需求 ≥ 20%"，但这个数据**现在还没有**。本 change 要么先做量化（日志分析 7 天问答样本）再起 change，要么接受"盲目上线"风险，shadow mode 自己跑数据。**建议先量化**：写一个 `scripts/analyse-qa-multihop.mjs` 分析 `audit_log` 中 question × answer × citations 的 asset 分布（命中 ≥ 2 个不同 asset 的算"跨文档"），放在本 Explore 里作为 proposal 阶段前置。
- **工具返回值结构**：chunks / ontology / citations 需要可 JSON 序列化且不超 token 预算。需要为每个 tool output 定义 **token budget 上限**（比如 2KB），超出则降采样。

### 低

- 反思机制本身很朴素（只是追加一条 user message），复杂场景下不够强。MVP 足矣，后续可升级为独立 meta-prompt。
- 老测试 `ragPipeline.test.ts` 不动（默认 flag 关闭时走老路径）；新增 `knowledgeQaAgentReact.test.ts` 覆盖 ReACT 路径。

---

## 6. 前置条件

- [x] OAG Phase 1 已上线 + eval 基线（recall@5=1.0）
- [ ] **多跳需求量化前置**：跑 `scripts/analyse-qa-multihop.mjs`（本 Explore 附带），从 `audit_log` 中抽取 7 天 QA 样本，输出 "跨文档问题占比"。**判据**：≥ 20% 启动本 change；< 20% 搁置到下轮。
- [ ] Shadow mode 方案确认：本 change MVP 默认 flag 关闭 = 零风险上线；但建议在 staging 环境配 `AGENT_REACT_ENABLED=true` 跑一周观察成本与质量。
- [ ] 成本预算：每问 ReACT 模式 LLM 调用数的硬上限（建议 7 = `MAX_ITER + MAX_REFLECT`）。

---

## 7. 给 OpenSpec 阶段的关键问题

1. **工具粒度**：`search_knowledge` 是暴露"已 rerank 后的 top-K"还是"原始 retrieve + 单独 rerank 工具"？**建议合并**（减少 LLM 决策负担）；但若发现 LLM 在某些场景应该跳过 rerank（比如缩写题），再拆。
2. **`generateAnswer` 是作为工具 `compose_answer` 还是 ReACT 结束后由应用层兜底？** 作为工具更干净，但 LLM 可能永不调用它陷入死循环。**建议工具 + 超最后一轮强制降级**：第 N 轮还没 `compose_answer`，应用层自动调一次。
3. **工具错误处理**：tool 抛出时，给 LLM 的 `role:'tool'` content 写 `{ error: '...' }` vs. 直接降级到 `run_rag_pipeline`？**建议前者**，给 LLM 恢复空间；连续 2 个错才降级。
4. **反思触发条件**：具体规则（`search_knowledge 返回 0` / `gradeDocs 全 0` / `compose_answer 被拒`）要枚举还是让 LLM 自判？**建议 MVP 枚举**，可预测性更强。
5. **是否并行工具调用**：dataAdminAgent 是串行，ReACT 设计是并行。并行带来的风险：同轮多个 search 可能冗余。**建议初版保守并行**（仅允许"正交工具"并行，同类工具同轮串行）。

---

## 8. 预估工作量

| 阶段 | 人天 | 说明 |
|---|---|---|
| **前置量化** `analyse-qa-multihop.mjs` + 决策会 | 0.3 | workflow C 小活，独立交付 |
| OpenSpec 契约（proposal + design + tasks + specs） | 0.7 | 工具 schema + SSE 新事件 + env vars + feature flag |
| `KnowledgeQaAgent` ReACT 分支实现 | 1.2 | 6 个工具 + 循环 + 反思 + 超时 |
| `llm.ts` / `chatComplete` 如需扩展（比如 token 计数回传）| 0.3 | 可能不需要 |
| 前端 SSE 新事件处理（`/qa` 页的 trace 面板展示 tool 调用序列） | 0.5 | UI 可选；MVP 可仅日志 |
| 测试（单元 + 集成 + 回归 eval） | 0.8 | 含工具超时 / 死循环防御 / flag 关闭时零 diff |
| Shadow staging 观察 + 成本分析 | 0.5 | 非硬阻塞但强烈建议 |
| 归档 + PROGRESS-SNAPSHOT | 0.2 | |
| **合计** | **~4.5 人天** | 前置量化若 < 20% 则停止，节省后续约 4 人天 |

---

## 9. 决策分叉（需要用户拍板）

- **Q-REACT-1**：先做前置量化脚本（0.3 天），根据结果再决定是否启动后续工作？**强烈推荐**：否则可能建完发现没人用。
- **Q-REACT-2**：Feature flag 默认值——生产 `false`（保守），staging `true`（观察）？还是全场默认 `false`？
- **Q-REACT-3**：是否保留 `run_rag_pipeline` 逃生工具？长期看它会稀释 ReACT 价值（LLM 偷懒直接走老管线），但 MVP 作为降级兜底很有用。
