# Proposal: Agent 编排层（Agent Orchestrator）

## Problem

架构图中「智能编排与治理层」的**Agent 编排层**方块目前只是占位：

- 现有意图路由仅有 `dataAdminAgent.ts#isDataAdminQuestion` 的关键字二分类；
- `/api/qa/ask` 硬编码了 QA 单一 pipeline，没有多 Agent 分发；
- 没有意图识别、路由规划、结果融合、元数据治理 Agent 等能力；
- 下游 MCP / Portal 期望一个**统一入口**发一次请求就能根据意图自动选 Agent。

## Scope（本 Change）

1. **统一调度入口** `POST /api/agent/dispatch`（SSE）
   - 入参：`{ question, session_id?, history?, hint_intent? }`
   - 响应事件：`agent_selected / rag_step / content / trace / done / error`
2. **意图识别器** `IntentClassifier`
   - 主路径：LLM structured output → `{intent, confidence, reason}`
   - Fallback：关键字启发式（沿用 `isDataAdminQuestion` 类规则）
   - LLM 失败或 `confidence < 0.6` 时走 fallback
3. **Agent 注册表**（Phase 1 支持四类）
   | intent | Agent | 备注 |
   |---|---|---|
   | `knowledge_qa` | `KnowledgeQaAgent` | 包装 `runRagPipeline`（`knowledge-qa` change 交付） |
   | `data_admin`   | `DataAdminAgent`   | 包装现有 `runDataAdminPipeline` |
   | `structured_query` | `StructuredQueryAgent` | 先占位；内部先返 `not_implemented` |
   | `metadata_ops` | `MetadataOpsAgent` | 对 `metadata_*` 表做 CRUD（ADMIN only） |
4. **路由规划**
   - 正常 = 一次分发（单 Agent 处理）
   - 提供 `plan()` 扩展点，未来支持多 Agent 串/并；本 change 只实现单步
5. **结果融合**
   - Phase 1 = 透传（passthrough）；保留 `fuse()` 接口给后续
6. **`/api/qa/ask` 向后兼容**
   - 变为薄壳，内部强制 `hint_intent = 'knowledge_qa'` 转发到 `/api/agent/dispatch`
7. **可观测**
   - 每次 dispatch 发 `agent_selected` 事件，带 `{intent, agent, confidence, reason, fallback}`
8. **与 `unified-auth` 联动**
   - 所有 Agent 入口走 `requireAuth + enforceAcl(READ)`，按 intent 映射到 resource

## Out of Scope

- 多 Agent 并行（planner / DAG 执行）
- Agent 间记忆共享（共享 blackboard）
- Agent 市场 / 动态注册
- 前端 Agent 控制台（Portal UI）
- Reranker / Cross-encoder

## 决策记录

- D-001 入口新开 `POST /api/agent/dispatch`；`/api/qa/ask` 降级为兼容壳，不直接写逻辑。
- D-002 意图识别走 LLM + 关键字双栈；`confidence` 阈值 0.6 可 env 配置。
- D-003 Agent 注册表在进程启动时静态注册；不支持运行期热插拔。
- D-004 SSE 事件在现有 `knowledge-qa` 事件基础上**新增 `agent_selected` 一种**；其他事件不动，保证 `knowledge_qa` agent 输出与 `/api/qa/ask` 一致。
- D-005 `structured_query` Agent 本 change 只占位；实际实现走后续 change（依赖 MCP 结构化层）。
