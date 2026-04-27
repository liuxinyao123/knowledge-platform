# Explore Draft — Agent 编排层

> 本文件是 Explore 阶段草稿。正式契约见 `openspec/changes/agent-orchestrator/`。
> 不进主分支，或以 PR draft 状态存在。

## 读的代码

- `apps/qa-service/src/services/dataAdminAgent.ts` — `isDataAdminQuestion` 关键字二分类；`runDataAdminPipeline` 已实现
- `apps/qa-service/src/services/ragPipeline.ts` — `runRagPipeline` 即将由 `knowledge-qa` change 重整为 asset_* 契约
- `apps/qa-service/src/routes/qa.ts` — 入口硬编码 RAG 单路径
- 无统一 Agent 调度入口；无多意图分类

## 观察到的 gap

1. 入口层只有 `/api/qa/ask`；架构图里需要**面向多 Agent 的入口**
2. 缺意图识别（现有关键字二分类只能区分 data_admin vs not）
3. 缺 Agent 注册表；无 `structured_query / metadata_ops` 占位
4. 缺"agent_selected"这种可观测事件
5. 对 `metadata_*` 表的 Agent 化 CRUD 尚无

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|------|------|------|------|
| A 新入口 `/api/agent/dispatch` + `/api/qa/ask` 兼容壳（本 change 采用） | 中 | 前端需适配事件 | ✓ |
| B 直接升级 `/api/qa/ask` 为多 Agent | 低 | 契约变更破坏下游 | ✗ |
| C 引入 LangChain / LangGraph | 高 | 依赖膨胀、可控性降低 | ✗ |

**选择 A**：新入口新契约，旧入口兼容壳；LLM 分类 + 关键字双栈，不引重型框架。

## 与其他 change 的依赖

- `unified-auth`：dispatch 必经 requireAuth / enforceAcl；metadata_ops Agent 要求 ADMIN
- `knowledge-qa`：KnowledgeQaAgent 直接包装 `runRagPipeline`；事件形状保持一致

## 风险 / 未决

- 意图分类准确率：先上 LLM + 关键字，上线后用日志 tune prompt
- `structured_query` 体验：占位提示"建设中"避免误导
- 事件流新增 `agent_selected`：前端需向后兼容（不认识则忽略）
