# Proposal: Ingest L0/L1 Abstract + RAG L0 Coarse Filter

## Background

ADR-31（OpenViking sidecar 实验）验收通过后，团队选择推进到方案 B：**不依赖 OpenViking 容器，把"L0/L1 分级摘要"思想落到 ingest 自实现**。来源：

- 方案 A 验收 6/6 PASS，证明分级摘要在中文语料上有效；
- 但 OpenViking 是 Python 容器 + 外部依赖；线上长期跑代价高；
- 自实现可以彻底融入现有 pgvector + ingest 管线，无新外部组件；
- ADR-22 七层兜底里 rerank/gradeDocs 都按 chunk 数走 token，碎 chunk 拓扑下成本/召回比不优。

## Problem

1. **粗筛粒度太细**：pgvector 直接在 chunk 拓扑召回 top-K，同 asset 邻近 chunk 占满前 K，挤掉真正相关的另一篇 asset；
2. **rerank/gradeDocs 双重 LLM 成本**：rerank 一次 20 条 chunk + gradeDocs 一次 20 条，token = chunk_count × chunk_len，对长 chunk 尤其烧；
3. **缺乏 asset 级摘要**：`metadata_asset.summary` 字段长期为空（ingest 不写），asset 粒度无可用语义信号。

## Scope（IN）

### A · 数据层（pgDb migrations）

- 新表 `chunk_abstract(id, chunk_id UNIQUE, asset_id, l0_text, l0_embedding vector(N), l1_text, generator_version, generated_at)`；
- 索引 `idx_chunk_abstract_asset` + IVFFLAT on `l0_embedding`；
- 视图 `asset_abstract`（聚合 chunk_abstract 出 asset 级 l0_summary，调试 / follow-up 用）；
- 全部走 `runPgMigrations()`，幂等，新装升级两条路同一份 SQL。

### B · ingest 阶段：phase 'abstract'

- 新模块 `services/ingestPipeline/abstract.ts`：
  - `generateAbstractsForAsset(assetId, pool, opts)`：拉本 asset 的 chunk → 批量调 `chatComplete` + `getLlmFastModel()`（Qwen2.5-7B）→ 生成 `{l0, l1}` JSON → embed l0 → 写 chunk_abstract；
  - `generateAbstractsForChunks(chunkIds, pool, opts)`：lazy/active 回填用同一份逻辑；
- `runPipeline` 在 embed 之后调用，emit phase 'abstract' progress；
- 失败容错：单 chunk 失败丢，不阻断 ingest 主流程；
- flag `L0_GENERATE_ENABLED` 默认 on，关闭即整段 no-op。

### C · ragPipeline 加 L0 coarse filter

- 新模块 `services/l0Filter.ts:coarseFilterByL0(question, opts)`；
- ragPipeline 在 retrieveInitial 之前可选调用：返回 candidate asset_id 列表注入 `retrieveInitial({assetIds})`；
- 三种返回：`undefined`（disabled/失败/数据不足）/ `[]`（命中 0，emit warn）/ `[asset_id...]`（注入）；
- emit 新 rag_step（icon `🧰`，label `L0 粗筛：N 个候选 asset`），不引新事件类型；
- flag `L0_FILTER_ENABLED` 默认 **off**（eval 通过才打开）。

### D · 回填（lazy + active）

- lazy: ragPipeline rerank 后把缺 L0 的 chunk_id 列表 enqueue 到 ingest_job（新 kind='abstract'）；ingestWorker 路由到 `generateAbstractsForChunks`；flag `L0_LAZY_BACKFILL_ENABLED` 默认 **off**；
- active: `scripts/backfill-l0.mjs`，参数 `--dry-run / --limit / --resume-from / --concurrency / --rate-per-min`，断点续跑，复用 abstract.ts 同一份逻辑。

### E · 可观测性

- ingest_done 日志结构化字段 `abstract_generated/abstract_failed/abstract_skipped`；
- jobRegistry phase 'abstract' 进度同步给前端 SSE；
- ragPipeline trace 字段新增 `l0_filter_used: bool` / `l0_candidate_count: number`（不破坏 RagTrace 既有字段，可选属性）。

## Out of Scope

- 不引入 OpenViking 容器（保留 ADR-31 实验存档，不强推生产）；
- 不动 chunk 切分策略（asset → chunks 仍走 chunkDocument 老路）；
- 不动 rerank/gradeDocs/rewrite/short-circuit 五层兜底；L0 仅在它们前面加一层；
- 不做 BookStack Shelves/Books 层级（方案 C，单独 P0）；
- 不做 generator_version 升级时的全库刷新（follow-up）；
- 不改前端 `/ingest` 页面 phase 标签（可在后续 small change 加一行）；
- 不暴露 chunk_abstract 给 mcp-service 对外（外部 Agent 接入推迟）。

## Success Metrics（执行阶段验收）

1. `pnpm dev:up` 跑两次迁移幂等通过；新上传 PDF 后 `chunk_abstract` 行数 > 0；
2. `tsc --noEmit` 双 0；现有测试不退化；新增 ≥ 6 条 spec 测试；
3. `L0_FILTER_ENABLED=off` 时 GM-LIFTGATE32 表现与 baseline **字节级**一致；
4. `L0_FILTER_ENABLED=on` 时 GM-LIFTGATE32 召回率不退化 > 3pp，rerank+grade token 消耗下降 ≥ 25%；
5. 关掉硅基 LLM key（模拟 L0 生成失败），ingest 仍能完成；ragPipeline 仍能跑（L0 缺失自动走原路径）；
6. `node scripts/backfill-l0.mjs --dry-run --limit 100` 输出预估不写库；不带 `--dry-run` 跑 100 条则 chunk_abstract 增加 100。

## Decision Log

- **D-001 表粒度**：chunk 粒度（不直接 asset 表）。理由：增量友好，UNIQUE(chunk_id) 防重；asset 级用聚合 view 出。
- **D-002 嵌入维度**：和 `metadata_field.embedding` 同维度同模型，零新模型成本。
- **D-003 L0 长度**：≤ 200 字（prompt 硬约束 + 解析校验），超长丢弃整条。
- **D-004 L1 长度**：≤ 600 字，结构 `结论/关键事实/适用场景`。
- **D-005 粗筛宽度**：`L0_FILTER_TOP_ASSETS=50`，是当前 chunk top_K=10 的 5 倍宽，先保召回。
- **D-006 生成时机**：ingest embed phase 之后；不放在更前面是为了保证 chunk_id 已稳定。
- **D-007 失败策略**：单 chunk 失败丢、不重试、不阻断 ingest；下次任意时刻被 lazy 或 active 回填打到。
- **D-008 LLM 选型**：`getLlmFastModel()`（Qwen2.5-7B），不用 72B。L0 任务短 + 输出短 + 成本敏感。
- **D-009 flag 三档**：generate / filter / lazy 各自独立，eval 不通过先关 filter，仍可继续生成数据；不一刀切。
- **D-010 回滚**：三个 flag 全关 + 表保留即可，无副作用。

## Verification

- TypeScript：`pnpm -r exec tsc --noEmit` 双 0；
- 单测：abstract.ts、l0Filter.ts、lazy enqueue、active script，每条 ≥ 1 用例；
- e2e：参考 `docs/verification/ingest-l0-abstract.md` 6 用例；
- eval：本机 `eval-recall.mjs` baseline vs L0_FILTER 启用 对比报告，附在 ADR-32 末尾。

## References

- ADR-31（OpenViking sidecar 实验）：`.superpowers-memory/decisions/2026-04-26-31-openviking-sidecar-experiment.md`
- explore + design：`docs/superpowers/specs/ingest-l0-abstract/`
- impl plan：`docs/superpowers/plans/ingest-l0-abstract-impl-plan.md`
- 验收手册：`docs/verification/ingest-l0-abstract.md`
- 相关 ADR：ADR-22（rag-relevance-hygiene-lock）、ADR-40（ingest-async-pipeline）、ADR-27（KG sidecar 模式）
