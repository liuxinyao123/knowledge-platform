# ADR 2026-04-21-03 · Agent 编排入口与意图分类策略

## Context

架构图「Agent 编排层」方块现状是一个关键字二分类（`isDataAdminQuestion`）
外加硬编码 RAG 单路径。图中承诺的"意图识别 / 路由规划 / 结果融合 / 元数据治理"
还没建。

需要给下游 MCP、Portal 提供一个**统一调度入口**，并确保现有 `/api/qa/ask`
消费者零损伤迁移。

## Decision

1. **新入口** = `POST /api/agent/dispatch`（SSE）；`/api/qa/ask` 降级为兼容壳
   （内部强制 `hint_intent=knowledge_qa`）
2. **意图识别** = LLM 结构化输出（tool-call）+ 关键字 fallback 双栈；
   `AGENT_INTENT_THRESHOLD`（默认 0.6）决定 LLM 置信度阈值
3. **Agent 注册表**（Phase 1）= `knowledge_qa / data_admin / structured_query / metadata_ops`
4. **事件扩展** = 在 `knowledge-qa` 已有 SseEvent 集合上新增 `agent_selected`，其他事件形状不变
5. **路由规划** = 本 change 只支持单 Agent 分发；`plan()` 与 `fuse()` 接口留给后续多 Agent DAG
6. **权限** = 全入口走 `unified-auth`；`metadata_ops` 要求 `ADMIN`
7. **`structured_query`** = 占位 Agent，返回 not_implemented；真正实现等 MCP 结构化层 change

## Consequences

**正面**
- 旧调用者不改代码（客户端若收到未知 `agent_selected` 事件应忽略）
- 引入 Agent 概念但不引入 LangChain 等重型依赖，控制复杂度
- 为多 Agent / 图编排留出抽象接口

**负面**
- 多一层调度开销（LLM 分类 ~100-300ms）
- LLM 分类准确率需要真实流量 tune
- 事件扩展项对下游 SSE 消费者有隐式要求

## Links

- Proposal: `openspec/changes/agent-orchestrator/proposal.md`
- Design:   `openspec/changes/agent-orchestrator/design.md`
- Spec:     `openspec/changes/agent-orchestrator/specs/agent-orchestrator-spec.md`
- Tasks:    `openspec/changes/agent-orchestrator/tasks.md`
- 依赖：`openspec/changes/unified-auth/`、`openspec/changes/knowledge-qa/`
