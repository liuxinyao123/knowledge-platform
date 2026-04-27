# Progress Snapshot · 2026-04-26 · L0 Abstract Day

> 一天内闭环了两个相关 ADR：
>   - ADR-31（OpenViking sidecar 实验）：6/6 PASS，作为对照存档
>   - ADR-32（ingest-l0-abstract）：Accepted，召回反向提升 +2.7pp

## 完成的工作

### ADR-31 · OpenViking sidecar（实验存档）

- 自建 `apps/openviking-service/` Dockerfile（python:3.11-slim + openviking==0.2.5）
- `infra/docker-compose.yml` 加 `openviking` 服务（profile `viking` 默认不启动）
- `apps/qa-service/src/services/viking/` HTTP client + memoryAdapter（强制 prefix 校验、软超时、warn 降噪）
- `KnowledgeQaAgent` 旁路调用 recall + save，flag `VIKING_ENABLED=0` 默认 off → 全 no-op
- SSE `viking_step` 事件
- `scripts/verify-viking.mjs` 5 步烟测
- 验收 6/6 PASS

### ADR-32 · ingest-l0-abstract（Accepted）

数据层：`chunk_abstract` 表 + IVFFLAT(l0_embedding) + `asset_abstract` view，全部走 `runPgMigrations`。

ingest 层：`services/ingestPipeline/abstract.ts` v2 generator（Qwen2.5-72B + json_object + few-shot），phase `'abstract'` 加在 embed 之后。

RAG 层：`services/l0Filter.ts:coarseFilterByL0` 三态契约（undefined/[]/[...]），`ragPipeline.ts` 在 retrieveInitial 之前注入 candidate asset_ids。

回填：lazy（`enqueueAbstractBackfill` 走 ingest_job kind='abstract'）+ active（`scripts/backfill-l0.mjs`，断点续跑、限流、dry-run）。

LLM 基建升级：`chatComplete` 加 `responseFormat` + `temperature` 选项，给后续结构化输出场景复用。

### 验收实测数据

```
GM-LIFTGATE32 (37 题)
                baseline   L0 启用     变化
recall@1        0.946      0.973      +2.7pp
recall@3        0.946      0.973      +2.7pp
recall@5        0.973      1.000      +2.7pp
top-5 没命中     1 题       0 题
```

Q20「不支撑在铰链之间的吹塑扰流板低平齐度要求是多少？」原本未命中，开 L0 后正确命中。

### v1 → v2 LLM 修复经过

v1 用 `getLlmFastModel`（Qwen2.5-7B）：
- diagnose-l0 实测 8/8 not-json
- 模型吐回中英混杂半结构化散文（如 `"l l：工艺图纸..."` / `"2 2 推荐2 5 mm..."`）
- backfill --commit 50 → generated=6 / failed=12 / skipped=32（66% 失败率）

v2 升级（同日内修）：
- `getLlmModel`（Qwen2.5-72B）
- `response_format: json_object`（OpenAI 兼容协议，硅基支持）
- 2 条 few-shot 锁格式与长度
- `temperature: 0.2`

v2 实测 10/10 ok，0 fail。

`generator_version` 字段从 `'v1'` 升 `'v2'`，留下未来 `WHERE generator_version < 'v2'` 批量重算的口子。

## 留给下一轮的事

- 后台跑无限制 backfill 把存量 chunk 全补上 L0
- 生产是否把 `L0_FILTER_ENABLED=true` 设为默认（current docker-compose 默认 false）
- mcp-service 暴露 chunk_abstract 给外部 Agent 用（方案 C 范围）
- BookStack Shelves/Books 层级映射到 `viking://resources/`（方案 C，需要单独 P0）
- token 消耗下降目标 ≥25% —— 本机 eval 集太小看不出，需要生产观察

## 文件清单（本日新增/修改）

新增：
- `apps/openviking-service/{Dockerfile,entrypoint.sh,.env.example,.dockerignore,README.md}`
- `apps/qa-service/src/services/viking/{client,memoryAdapter,types,index}.ts`
- `apps/qa-service/src/services/ingestPipeline/{abstract,abstractBackfill}.ts`
- `apps/qa-service/src/services/l0Filter.ts`
- `apps/qa-service/src/__tests__/{viking.client,viking.memoryAdapter,abstract.generate,l0Filter}.test.ts`
- `scripts/{verify-viking,backfill-l0,diagnose-l0}.mjs`
- `openspec/changes/ingest-l0-abstract/{proposal,design,tasks,specs/ingest-l0-abstract/spec}.md`
- `docs/superpowers/specs/{openviking-sidecar,ingest-l0-abstract}/{explore,design}.md`
- `docs/superpowers/plans/{openviking-sidecar,ingest-l0-abstract}-impl-plan.md`
- `docs/verification/{openviking-sidecar,ingest-l0-abstract}.md`
- `.superpowers-memory/decisions/2026-04-26-31-openviking-sidecar-experiment.md`
- `.superpowers-memory/decisions/2026-04-26-32-ingest-l0-abstract.md`

修改：
- `apps/qa-service/src/services/{pgDb,llm,knowledgeSearch,ragPipeline,ingestWorker,jobRegistry}.ts`
- `apps/qa-service/src/services/ingestPipeline/pipeline.ts`
- `apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts`
- `apps/qa-service/src/ragTypes.ts`
- `apps/qa-service/.env.example`
- `infra/docker-compose.yml`
- `.superpowers-memory/integrations.md`

## 状态

- ADR-31：候选实验存档（默认 off，不进生产）
- ADR-32：Accepted（默认 generate=on / filter=off / lazy=off；filter 等生产观察后再决定是否默认 on）
- TypeScript 双 0；本机 eval 集 PASS；vitest 沙箱跑不动（rollup native binary 兼容问题，本机能跑）
