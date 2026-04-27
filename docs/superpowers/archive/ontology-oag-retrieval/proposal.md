# Proposal: Ontology-Augmented Generation（OAG）· RAG 管线实体上下文扩展

## Problem

当前 Agentic RAG（`services/ragPipeline.ts`，ADR 2026-04-23-22/24）是**纯 chunk 粒度**的召回：

- 召回返回的只是命中文本片段，LLM 看不到片段所属 Asset 的元数据、所在 Source、Space 约束与 Tag 关系；
- 多跳语义（"这份 PDF 属于哪个空间？空间里还有谁？"）完全被剥离；
- Apache AGE sidecar（ADR-27）已建立了引用图谱，但**只用于 DetailGraph 前端可视化**，没有回灌到 LLM 上下文。

结果是：回答可解释性偏弱，跨文档推理能力受限，Agent 无法像人类专家一样沿拓扑多跳推理（这正是 PolarDB-PG Ontology 文章提出的 OAG 痛点）。

## Scope（本 change）

1. **新模块**：`apps/qa-service/src/services/ontologyContext.ts` —— 对外暴露 `expandOntologyContext(chunks, principal)`。
2. **管线集成**：`services/ragPipeline.ts` 在 `rerank` 与 `gradeDocs` 之间插入一次调用。
3. **图 schema 非破坏性扩展**：`Asset` 节点追加属性 `description_embedding`（1024 维）、`summary_text`（≤200字）；`Tag` 节点追加 `semantic_embedding`。**不新增节点/边类型**。
4. **HTTP 契约**：`POST /api/ontology/context`（供未来 Skill 调用；本 change 仅定义契约）。
5. **可观测性**：每次调用 emit `ontology_context` SSE 事件（与 `rag_step` 同通道），字段 `{entities_count, edges_count, hop_depth, fallback}`。
6. **降级策略**：AGE 不可用、principal 无可见 asset、hop 超时任何一种出现 → 返回空 context，主 RAG 不阻塞。

## Out of Scope

- 修改 `retrieveInitial` / `rerank` / `generateAnswer` 任一步的算法；
- 在 Cypher 层嵌入 ACL 谓词（ACR-aware traversal，见 `open-questions.md` OQ-ONT-2）；
- 新增业务对象节点类型（Customer / Device 等）；
- `description_embedding` / `summary_text` 的**自动回填 job**（本 change 只声明属性，回填策略在 design.md 描述但不强制实施）；
- Web 控制台对 OAG 结果的可视化（可在后续 feature workflow C 中追加）；
- 对 `structured_query` / `data_admin` / `metadata_ops` 三个 Agent 的扩展（仅接入 `knowledge_qa`）。

## Success Metrics（OpenSpec 合并后由执行方验证）

- `knowledge_qa` Agent 的 `gradeDocs` prompt 中必须出现 `ontology_context` section；
- 当 AGE 关闭（`KG_ENABLED=0`）时，RAG 管线延迟相对当前基线无增加；
- 当 AGE 可用时，`expandOntologyContext` 单次调用 p95 < 200ms（top-K=15、hop=2）；
- 已有 `services/ragPipeline.test.ts` 不需要因本 change 失败的断言。
