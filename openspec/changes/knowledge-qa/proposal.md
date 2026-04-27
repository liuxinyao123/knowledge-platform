# Proposal: 知识问答（Agentic RAG · 基于 pgvector）

## Problem

当前 `POST /api/qa/ask` 的 Agentic RAG 实现围绕 **BookStack page** 构建：
- 检索走 `searchPagesByVector` + BookStack `searchPages` fallback；
- Citation / trace 字段是 `page_id / page_name / page_url / excerpt`；
- 无多轮对话支持（`qa.ts` 不处理 `session_id`，ragPipeline 不合并 history）。

同时已具备 `POST /api/knowledge/search`（pgvector + metadata_field），下游 MCP
服务 与 Agent 编排层预期用 **asset_id / asset_name / chunk_content / score** 语义。
两套命名并存会污染下游契约。

## Scope（本 Change）

1. **检索入口切换**：Step 1 改为调用 `POST /api/knowledge/search`（本服务内部），
   返回 `{ asset_id, asset_name, chunk_content, score, metadata }`，`top_k=10`，
   显式阈值 `score > 0.5`。
2. **Grade / Rewrite 保留现有能力**：
   - Step 2 保留 function-calling `grade_document`（比 yes/no 更可靠），对外暴露
     等价 `relevant: boolean` 语义；保底 Top2。
   - Step 3 保留 `step_back + hyde` 双策略，触发条件 `gradedDocs.length < 3`。
3. **字段改名**：
   - `Citation`：`{ index, asset_id, asset_name, chunk_content, score }`
   - `RagTrace`：`{ initial_count, kept_count, rewrite_triggered, rewrite_strategy?, rewritten_query?, citations[] }`
4. **多轮对话**：
   - 入参新增 `session_id?: string`、`history?: Array<{ role: 'user'|'assistant', content: string }>`；
   - 后端不持久化 session，仅把 `history` 合并到 `messages` 中传给 LLM；
   - `session_id` 透传给前端用于本地存储 key，不落库。
5. **Streaming 保持**：SSE 事件仍是 `rag_step / content / trace / done / error`。
6. **向量模型**：沿用硅基流动 `Qwen/Qwen3-Embedding-8B`（已有索引数据）。

## Out of Scope（后续 Change）

- **Session 持久化 / 会话管理服务**：仅前端 localStorage；后端无 sessions 表。
- **Reranker / Cross-encoder 精排**。
- **Agent 编排层**：本 change 只定义 QA 契约；Agent 层另立 change 消费本契约。
- **BookStack fallback**：切到 pgvector 为主数据源后，下线 BookStack 搜索 fallback
  作为下一阶段清理。

## 决策记录（落 ADR）

- D-001 检索源 = pgvector（不再二选一 fallback）；对应 Q-002。
- D-002 向量模型 = Qwen3-Embedding-8B（硅基流动）；不改动索引。
- D-003 多轮对话 = 前端状态化 + 入参透传 history；服务端无状态。
- D-004 Step 2 实现 = function-calling（`relevant: boolean`）；对外语义等同 yes/no。
