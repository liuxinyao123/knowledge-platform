# Ingest L0/L1 Abstract — Impl Plan

> 配套 `docs/superpowers/specs/ingest-l0-abstract/{explore,design}.md` 与 OpenSpec change `openspec/changes/ingest-l0-abstract/`。
> 工作流：B。Phase 1 锁契约（OpenSpec），Phase 2 写代码，Phase 3 验收。

---

## Phase 1 · 锁契约（OpenSpec change）

- `openspec/changes/ingest-l0-abstract/proposal.md`：Problem / Scope / Out of Scope / Success Metrics
- `openspec/changes/ingest-l0-abstract/design.md`：照抄 `docs/superpowers/specs/ingest-l0-abstract/design.md` 的结构 + 决策 D1–D8
- `openspec/changes/ingest-l0-abstract/tasks.md`：任务清单（按本文件 Phase 2 的步骤翻译）
- `openspec/changes/ingest-l0-abstract/specs/ingest-l0-abstract/spec.md`：行为契约（chunk_abstract、abstract phase、l0 filter、lazy/active backfill、降级）

锁住即停一次，让人类 / 下游审一遍。本轮一次性出齐。

## Phase 2 · 实现（按 PR 拆）

### Step 1 · DB schema（半天）

- 修改 `apps/qa-service/src/services/pgDb.ts`：
  - 加 `CREATE TABLE IF NOT EXISTS chunk_abstract (...)`；
  - 加 `CREATE INDEX IF NOT EXISTS idx_chunk_abstract_*`；
  - 加 `CREATE OR REPLACE VIEW asset_abstract AS ...`；
- 验：`pnpm dev:up` 跑两次 migrations，第二次不报错；`\d chunk_abstract` 看字段对齐 design §1。

### Step 2 · abstract.ts 模块（1 天）

- 新建 `apps/qa-service/src/services/ingestPipeline/abstract.ts`，导出 `generateAbstractsForAsset(assetId, pool, opts)` 与 `generateAbstractsForChunks(chunkIds, pool, opts)`；
- 内部 helper `runOneAbstract(chunk)`：调 `chatComplete` + `embedTexts`，返回 `{l0,l1,vector}` 或 throw；
- prompt 用 few-shot 锁 JSON 输出格式；解析失败计入 `failed`，不抛；
- 单测：mock chatComplete + embedTexts + pool，覆盖：成功 / JSON 解析失败 / LLM 抛 / 短 chunk 跳过 / disabled no-op。

### Step 3 · 接进 runPipeline（半天）

- 修改 `apps/qa-service/src/services/ingestPipeline/pipeline.ts`：
  - 在 `embed` phase 之后调用 `generateAbstractsForAsset(assetId, pool, { progress })`；
  - emit `progress?.({phase:'abstract', progress:98})`；
  - phase 进度数值表加 `abstract: 98`；
  - 抓取异常 → console.warn 不阻断；
- 修改 `services/jobRegistry.ts:JobPhase` 加 `'abstract'`（如还没加）；
- 验：本机上传一份 markdown，`SELECT count(*) FROM chunk_abstract` > 0；ingest_done 日志带 `abstract_generated`。

### Step 4 · ragPipeline 加 L0 coarse filter（1 天）

- 新建 `apps/qa-service/src/services/l0Filter.ts`：导出 `coarseFilterByL0(question, opts)`；
- 修改 `services/ragPipeline.ts`：
  - 在 `retrieveInitial` 之前加 `if (L0_FILTER_ENABLED) const ids = await coarseFilterByL0(...)`；
  - `ids === undefined` 走原路径；`ids === []` emit warn 走原路径；`ids.length>0` 注入 `retrieveInitial({assetIds: ids})`；
  - 新 rag_step 标签 `🧰 L0 粗筛：N 个候选 asset`；
- 单测：`l0Filter.disabled.test.ts` / `l0Filter.empty.test.ts` / `l0Filter.injection.test.ts`；
- 验：`L0_FILTER_ENABLED=true` 跑一次问题，trace 里看到 candidate asset_ids 缩小后再进 vector 检索。

### Step 5 · lazy backfill（半天）

- 修改 `services/jobRegistry.ts`：`JobKind` 加 `'abstract'`；
- 修改 `services/ingestWorker.ts:runIngestJob`：`kind='abstract'` 路径调 `generateAbstractsForChunks(payload.chunkIds, pool)`；
- 修改 `services/ragPipeline.ts`：rerank 后对缺 L0 的 chunk_id 调 `enqueueAbstractBackfill(ids)` fire-and-forget；
- 加 helper `services/ingestPipeline/abstractBackfill.ts:enqueueAbstractBackfill(chunkIds)` 写一条 ingest_job；
- 验：`L0_LAZY_BACKFILL_ENABLED=true` 跑一次 RAG（命中无 L0 chunk）→ 看 ingest_job 表多一条 kind=abstract status=queued → 等 worker 跑完 → chunk_abstract 表多了对应行。

### Step 6 · active backfill 脚本（半天）

- 新建 `scripts/backfill-l0.mjs`（Node 22，无新依赖）：
  - 参数解析（`--dry-run` / `--limit` / `--resume-from` / `--concurrency` / `--rate-per-min`）；
  - 直接 `import` qa-service 的 `services/ingestPipeline/abstract.ts:generateAbstractsForChunks`（pnpm workspace 直引）；
  - 进度 / 限流 / 断点见 design §5；
- 验：`--dry-run --limit 100` 输出预计行数不写库；不带 `--dry-run` 跑 100 条 chunk_abstract 增加 100。

### Step 7 · ADR-32 + memory + 验收手册（半天）

- `.superpowers-memory/decisions/2026-04-26-32-ingest-l0-abstract.md`：候选 ADR；
- `.superpowers-memory/integrations.md`：追加 chunk_abstract 表与三个 flag；
- `.superpowers-memory/open-questions.md`：留 generator_version 升级如何刷库的问题；
- `docs/verification/ingest-l0-abstract.md`：6 个验收用例（generate / disabled / l0 filter on/off / lazy / active / 召回不退化）。

## Phase 3 · 验收

按 `docs/verification/ingest-l0-abstract.md` 跑 6 个用例，把结果回填到 ADR-32 末尾。

任一红线触发（见 explore.md §3）→ 全部 flag 默认关，把候选 ADR 状态置 Rejected，表保留不删。

---

## 总工时估算

约 4 工日。

## 退出条件（红线）

任一触发即停 Phase 2 / 不合并：

1. ingest 慢于现状 30%+（生成阶段太重）；
2. `L0_FILTER_ENABLED=on` 时 GM-LIFTGATE32 召回退化 > 3pp；
3. token 节省不足 25%（设计动机不成立）；
4. chunk_abstract 表大小超过 metadata_field 的 30%（明显异常）。

---
