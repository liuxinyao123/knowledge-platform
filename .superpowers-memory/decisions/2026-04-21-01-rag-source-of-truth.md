# ADR 2026-04-21-01 · RAG 检索源改为 pgvector（metadata-catalog）

## Context

`POST /api/qa/ask` 现有 RAG 走 BookStack page（`searchPagesByVector` + BookStack
`searchPages` fallback），citation / trace 字段使用 `page_*`。

与此同时：
- `openspec/changes/metadata-catalog-pgvector/` 已上线 `POST /api/knowledge/search`
- 下游 MCP / Agent 编排层的契约使用 `asset_id / asset_name / chunk_content / score`
- Open Question **Q-002** 要求明确 pgvector 与 MySQL 的 source-of-truth

两套命名并存会污染下游契约，并使 Q-002 无法收敛。

## Decision

1. 知识问答（`openspec/changes/knowledge-qa/`）检索源 = **pgvector / metadata-catalog**
   - Step 1 改为调用内部 service `searchKnowledgeChunks(...)`（knowledgeDocs 抽出）
   - 过滤阈值 `score > 0.5`，`top_k = 10`
2. 下线 BookStack `searchPages` fallback，作为下一阶段清理工作
3. 向量模型保持 `Qwen/Qwen3-Embedding-8B`（见 D-002）

## Consequences

**正面**
- 统一命名：`asset_*` 成为下游 MCP / Agent 唯一术语
- 关闭 Q-002 的一半：QA 链路 source-of-truth = pgvector

**负面 / 取舍**
- BookStack 数据需要经 `scripts/sync-bookstack.ts` 全量回灌才能被 QA 召回
- 现有前端 / trace 消费端需同步升级字段
- 短期内 BookStack 新写入的页面在未回灌前不可被 QA 检索到

## Links

- Proposal: `openspec/changes/knowledge-qa/proposal.md`
- Design:   `openspec/changes/knowledge-qa/design.md`
- Spec:     `openspec/changes/knowledge-qa/specs/knowledge-qa-spec.md`
- Tasks:    `openspec/changes/knowledge-qa/tasks.md`
- Open Question: `.superpowers-memory/open-questions.md#Q-002`
