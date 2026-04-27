# Tasks: asset-vector-coloc

> Step 3 (Execute) 严格按本顺序跑。每条完成画 ✅。
> 任何一条卡住 → 回到 Step 2 改 spec，不在 Step 3 现编。

## A · Schema 迁移（pgDb.ts）

- [ ] A1 在 `runPgMigrations()` 末尾追加 halfvec 迁移段，含幂等检查（先 `pg_attribute` 查列类型，已是 halfvec 跳过）
- [ ] A2 同段重建 `idx_field_embedding`（halfvec_cosine_ops, lists=100）
- [ ] A3 同段重建 `idx_chunk_abstract_l0_embedding`（halfvec_cosine_ops）
- [ ] A4 加 `PGVECTOR_HALF_PRECISION` env 短路：`false` → 整段 no-op，写一行 console.warn
- [ ] A5 单测 `halfvecMigration.test.ts`：上下行 + cosine 误差 < 0.001

## B · SQL 算子升级

- [ ] B1 `vectorSearch.ts`：`$1::vector` → `$1::halfvec`
- [ ] B2 `hybridSearch.ts`：同上
- [ ] B3 `l0Filter.ts`：同上（注意 l0_embedding 也升）
- [ ] B4 `knowledgeSearch.ts` 的 retrieval `SELECT`：列表追加 `kind, image_id`
- [ ] B5 grep 全仓库确认无遗漏 `::vector` cast：`grep -rn "::vector" apps/qa-service/src`

## C · Citation 后端

- [ ] C1 `ragTypes.ts`：`Citation` 接口加两可选字段
- [ ] C2 `ragPipeline.ts` citation 拼装段：检查 `chunkRow.kind === 'image_caption'` 与 `chunkRow.image_id` 非空时回填
- [ ] C3 加 `CITATION_IMAGE_URL_ENABLED` env 短路（默认 true，关时不回填）
- [ ] C4 单测 `citationImage.test.ts`：mock chunk → assert citation 含两字段
- [ ] C5 跑一遍 `pnpm --filter qa-service test`

## D · Citation 前端

- [ ] D1 `grep -rn "Citation\|citations\|citation" apps/web/src` 找渲染 citation 的组件（候选：MarkdownView / Insights/Cards / notebook 三处任一）
- [ ] D2 在该组件渲染 citation 时新增条件分支：`citation.image_url ? <Thumbnail src> : null`
- [ ] D3 加最小样式（64×64，object-fit cover，alt=chunk_content 截断）
- [ ] D4 跑 `pnpm --filter web test`

## E · 回滚

- [ ] E1 写 `scripts/rollback-halfvec.mjs`（参考 `scripts/backfill-l0.mjs` 结构，args: `--dry-run`）
- [ ] E2 测一次 `node --experimental-strip-types scripts/rollback-halfvec.mjs`，确认 SQL 可执行（默认 dry-run，不带 `--commit` 不实跑；脚本通过 qa-service 的 `getPgPool` 复用 pg 依赖与 .env，所以必须带 `--experimental-strip-types`）

## F · eval 回归

- [ ] F1 `pnpm -r exec tsc --noEmit` → 双 0
- [ ] F2 `pnpm -r test` → 全绿
- [ ] F3 跑一次 `node --experimental-strip-types scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl`，记录 recall@5 ≥ 1.000、P50/P95 latency 数字（这是 OQ-VEC-QUANT-V2 触发条件的零基线）
- [ ] F4 把 F3 数字回写到 `docs/superpowers/specs/pgvector-modernization/design.md` §5.2 表

## G · 端到端体感

- [ ] G1 起栈 (`pnpm dev:up`)，前端开一道含图 PDF（任意 GM-LIFTGATE 套图都可）问答
- [ ] G2 截图保存到 `docs/verification/asset-vector-coloc/citation-thumbnail.png`
- [ ] G3 同对比："关掉 `CITATION_IMAGE_URL_ENABLED=false` 后渲染恢复纯文本" 截图保存

## H · Archive 准入

- [ ] H1 写 ADR-44 LanceDB 借鉴落地总结（含 OQ-VEC-QUANT-V2 / OQ-VEC-DISKANN / OQ-CAPTION-DUAL-EMBED 触发条件）
- [ ] H2 把三条 OQ 写进 `.superpowers-memory/open-questions.md`
- [ ] H3 把 `docs/superpowers/specs/pgvector-modernization/` 移到 `docs/superpowers/archive/asset-vector-coloc/`（注意：归档目录用 change 名，不用 Explore 名）
- [ ] H4 更新 `.superpowers-memory/integrations.md`（向量列从 vector 改 halfvec、Citation 字段新增）
- [ ] H5 当日写 PROGRESS-SNAPSHOT
