# Explore Draft — 知识问答（Agentic RAG · pgvector）

> 本文件是 Explore 阶段草稿。正式契约见 `openspec/changes/knowledge-qa/`。
> 不进主分支，或以 PR draft 状态存在。

## 读的代码（Evidence）

- `apps/qa-service/src/services/ragPipeline.ts` 已有 5 步，但检索源 = BookStack
- `apps/qa-service/src/routes/qa.ts` SSE 已就绪（`text/event-stream`）
- `apps/qa-service/src/routes/knowledgeDocs.ts` pgvector `POST /search` 已上线
- 前端 `apps/web/src/knowledge/QA/index.tsx` 已具备：三状态气泡、AbortController、trace 折叠、citations 面板
- `apps/qa-service/.env.example` 向量模型 = 硅基 `Qwen/Qwen3-Embedding-8B`

## 观察到的 gap（落到 proposal）

1. citation / trace 字段是 `page_*`，契约要求 `asset_*`
2. 检索入口是 vector + BookStack fallback，不是 `/api/knowledge/search`
3. `qa.ts` 无 `session_id / history` 支持
4. 阈值 `score > 0.5` 未显式
5. `rewrite_triggered` 触发条件需文档化（当前实现为 `gradedDocs.length < 3`）

## 候选方案评估

| 方案 | 代价 | 风险 | 收益 |
|------|------|------|------|
| A 改造现有 pipeline 对齐 asset_* | 中 | 下游（若已有消费方）需同步升级 | 单路径，命名与 pgvector 一致 |
| B 并行一条 v2 pipeline + 老的保留 | 高 | 两路并存维护负担 | 渐进迁移 |
| C 改 spec 迁就现状 | 低 | 下游 MCP/Agent 命名绑死 BookStack 语义 | 零迁移成本 |

**选择 A**（已在 proposal 记作 D-001）。

## 依赖与风险盘点

- pgvector 覆盖：下线 BookStack fallback 前需 `scripts/sync-bookstack.ts` 全量回灌一次
- LLM 并发：gradeDocs 会对 Top10 做并发打分；需复用 `chatComplete` 的并发池
- History 注入：需要严格校验 role / content

## 下一步

→ 合并 `openspec/changes/knowledge-qa/`（Lock）后，进入 Execute 按 tasks.md 实现。
