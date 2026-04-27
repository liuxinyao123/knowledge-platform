# Tasks: Ingest L0/L1 Abstract

> 工作流 B：本 change 同时承接锁契约 + 执行（不分拆）。Phase 1 = 当前文件 + proposal/design/specs；Phase 2 = 执行；Phase 3 = 验收。

## Phase 1 · 锁契约

- [x] proposal.md
- [x] design.md
- [x] specs/ingest-l0-abstract/spec.md
- [x] tasks.md（本文件）

## Phase 2 · 执行

### Step 1 · DB schema

- [ ] `apps/qa-service/src/services/pgDb.ts:runPgMigrations()` 追加：
  - [ ] `CREATE TABLE IF NOT EXISTS chunk_abstract (...)`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_chunk_abstract_asset`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_chunk_abstract_l0_embedding`（`USING ivfflat (l0_embedding vector_cosine_ops)`）
  - [ ] `CREATE OR REPLACE VIEW asset_abstract AS ...`
- [ ] 验：`pnpm dev:up` 跑两次不报错；`\d chunk_abstract` 字段对齐 design 表结构

### Step 2 · abstract.ts 模块

- [ ] 新建 `apps/qa-service/src/services/ingestPipeline/abstract.ts`：
  - [ ] `generateAbstractsForAsset(assetId, pool, opts?)` → `{generated, failed, skipped}`
  - [ ] `generateAbstractsForChunks(chunkIds, pool, opts?)` → 同上
  - [ ] 内部 helper `runOneAbstract(chunk)`：调 `chatComplete` + `embedTexts`
  - [ ] prompt 锁 JSON 格式（few-shot），单条解析失败丢 + counter 自增
  - [ ] flag `L0_GENERATE_ENABLED=false` 时整段 no-op
  - [ ] env：`L0_GENERATE_CONCURRENCY=4` / `L0_GENERATE_MIN_CHARS=60`
- [ ] 单测：`apps/qa-service/src/__tests__/abstract.generate.test.ts`
  - [ ] disabled no-op
  - [ ] LLM 抛 → counter.failed++，不抛
  - [ ] JSON 解析失败 → counter.failed++
  - [ ] 短 chunk 跳过 → counter.skipped++
  - [ ] 成功 → INSERT 一条 chunk_abstract

### Step 3 · 接进 runPipeline

- [ ] 修 `apps/qa-service/src/services/ingestPipeline/pipeline.ts`：
  - [ ] embed phase 后调 `generateAbstractsForAsset(assetId, pool, {progress})`
  - [ ] phase 进度数值表加 `abstract: 98`
  - [ ] 异常 catch → console.warn，不阻断
  - [ ] ingest_done 日志加 `abstract_generated/abstract_failed/abstract_skipped`
- [ ] 修 `apps/qa-service/src/services/jobRegistry.ts`：`JobPhase` 加 `'abstract'`（如未加）
- [ ] 修 `apps/qa-service/src/services/ingestPipeline/pipeline.ts:PipelinePhase` 加 `'abstract'`
- [ ] 验：本机上传 markdown，`SELECT count(*) FROM chunk_abstract` > 0

### Step 4 · ragPipeline L0 coarse filter

- [ ] 新建 `apps/qa-service/src/services/l0Filter.ts:coarseFilterByL0(question, emit, opts)`
  - [ ] flag `L0_FILTER_ENABLED=false` 默认 → 直接返回 undefined
  - [ ] embed question → ANN 查 chunk_abstract.l0_embedding → `SELECT DISTINCT asset_id ... LIMIT L0_FILTER_TOP_ASSETS`
  - [ ] env：`L0_FILTER_TOP_ASSETS=50`
  - [ ] 三种返回值契约：undefined / [] / [...]
- [ ] 修 `apps/qa-service/src/services/ragPipeline.ts`：
  - [ ] retrieveInitial 之前调 coarseFilterByL0
  - [ ] 命中时把 asset_ids 注入 retrieveInitial({assetIds: ids})
  - [ ] emit rag_step `🧰 L0 粗筛：N 个候选 asset`
  - [ ] trace 加 `l0_filter_used: bool` / `l0_candidate_count: number`（可选字段）
- [ ] 单测：`apps/qa-service/src/__tests__/l0Filter.test.ts`
  - [ ] disabled → undefined
  - [ ] 表空 → undefined
  - [ ] embed 失败 → undefined
  - [ ] ANN 0 命中 → []（caller 走原路径）
  - [ ] 命中 → 返回 asset_ids 并注入

### Step 5 · lazy backfill

- [ ] 修 `apps/qa-service/src/services/jobRegistry.ts:JobKind` 加 `'abstract'`
- [ ] 修 `apps/qa-service/src/services/ingestWorker.ts:runIngestJob`：`kind='abstract'` 调 `generateAbstractsForChunks(payload.chunk_ids)`
- [ ] 新建 `apps/qa-service/src/services/ingestPipeline/abstractBackfill.ts:enqueueAbstractBackfill(chunkIds)`
- [ ] 修 `apps/qa-service/src/services/ragPipeline.ts`：rerank 后对缺 L0 chunk fire-and-forget enqueue（仅 `L0_LAZY_BACKFILL_ENABLED=true`）
- [ ] 单测：enqueue 写 ingest_job + worker 取走 + chunk_abstract 增加（端到端集成测，可 mock LLM）

### Step 6 · active backfill 脚本

- [ ] 新建 `scripts/backfill-l0.mjs`：
  - [ ] 参数解析：`--dry-run` / `--limit N` / `--resume-from CHUNK_ID` / `--concurrency N` / `--rate-per-min N`
  - [ ] 进度条：每 100 条到 `process.stderr`
  - [ ] 断点：`.backfill-l0.cursor`
  - [ ] 限流：滑动窗口，超出睡到下窗
  - [ ] 直引 `apps/qa-service/src/services/ingestPipeline/abstract.ts`

### Step 7 · ADR + memory + 验收手册

- [ ] `.superpowers-memory/decisions/2026-04-26-32-ingest-l0-abstract.md` 候选 ADR
- [ ] `.superpowers-memory/integrations.md` 加 chunk_abstract 表 + 三 flag 章节
- [ ] `docs/verification/ingest-l0-abstract.md` 6 个验收用例
- [ ] `apps/qa-service/.env.example` 加 6 个 L0_* 变量
- [ ] `infra/docker-compose.yml:qa_service.environment` 同步注入

## Phase 3 · 验收（人工 + 自动）

- [ ] `pnpm dev:up` 跑两次幂等通过
- [ ] `pnpm -r exec tsc --noEmit` 双 0
- [ ] `pnpm -r test` 所有用例通过（含新增 ≥ 6 条）
- [ ] 本机 verify-l0 用例 6/6 PASS
- [ ] eval：baseline vs L0_FILTER 启用对比报告，回填 ADR-32

## 退出条件

任一红线触发即把所有 flag 默认关 + ADR 状态置 Rejected：
- ingest 慢于现状 30%+
- L0_FILTER_ENABLED=on 时 GM-LIFTGATE32 召回退化 > 3pp
- token 节省不足 25%
- chunk_abstract 表 size > metadata_field 30%
