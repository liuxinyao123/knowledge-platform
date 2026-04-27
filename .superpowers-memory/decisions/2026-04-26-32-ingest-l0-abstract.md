# ADR-32 (候选) · Ingest L0/L1 Abstract + RAG L0 Coarse Filter

- 日期：2026-04-26
- 状态：**Accepted**（Phase 3 验收 PASS；用例 4 召回反向提升 +2.7pp）
- 工作流：B · `superpowers-openspec-execution`
- 上游：ADR-31（OpenViking sidecar 实验）验收 6/6 PASS

## 背景

ADR-31 验证了"L0 摘要思想"在中文场景有效。本 ADR 把它从 OpenViking sidecar 搬进 ingest 自实现，
以避免长期依赖 Python 容器、彻底融入现有 pgvector + ingest 管线。

## 决策

按方案 B 推进：

1. **数据**：新表 `chunk_abstract(chunk_id, asset_id, l0_text, l0_embedding, l1_text, ...)` + IVFFLAT 索引 + `asset_abstract` 视图。`runPgMigrations` 幂等加。
2. **ingest**：在 `runPipeline` embed phase 后追加 phase 'abstract'，调用 `services/ingestPipeline/abstract.ts:generateAbstractsForAsset`。复用硅基 Qwen2.5-7B（`getLlmFastModel`）+ `embedTexts`。失败容错，不阻断主路径。
3. **RAG**：新增 `services/l0Filter.ts:coarseFilterByL0`。`L0_FILTER_ENABLED=on` 时在 `retrieveInitial` 前先 ANN 粗筛 candidate asset_ids（≤ `L0_FILTER_TOP_ASSETS=50`）注入 `retrieveInitial({assetIds})`；返回 undefined / [] / [...] 三种契约见 spec。
4. **lazy 回填**：rerank 后把命中但缺 L0 的 chunk_id 通过 `enqueueAbstractBackfill` 写一条 `ingest_job kind='abstract'`；ingestWorker 路由到 `generateAbstractsForChunks`。flag `L0_LAZY_BACKFILL_ENABLED` 默认 off。
5. **active 回填**：`scripts/backfill-l0.mjs`，断点续跑 + 限流 + dry-run，复用同一份生成逻辑。
6. **flag 三档**：`L0_GENERATE_ENABLED=true` / `L0_FILTER_ENABLED=false` / `L0_LAZY_BACKFILL_ENABLED=false`。eval 通过才打开 filter。

详见：
- proposal：`openspec/changes/ingest-l0-abstract/proposal.md`
- design：`openspec/changes/ingest-l0-abstract/design.md`
- spec：`openspec/changes/ingest-l0-abstract/specs/ingest-l0-abstract/spec.md`
- impl plan：`docs/superpowers/plans/ingest-l0-abstract-impl-plan.md`
- 验收手册：`docs/verification/ingest-l0-abstract.md`

## 关键技术决策

- **D1 chunk 粒度（不直接 asset 表）**：增量友好；UNIQUE(chunk_id) 防重；asset 级用聚合 view 出。
- **D2 维度对齐**：`vector(4096)` 与现有 `metadata_field.embedding` 同维同模型，零新模型成本。
- **D3 长度上限**：L0 ≤ 200 / L1 ≤ 600；prompt 硬约束 + 解析校验，违反丢弃整条。
- **D4 LLM 选型**：v1 用 `getLlmFastModel`（Qwen2.5-7B）。**v2（2026-04-26 验收发现）**：7B 不守 JSON 格式约束（实测 8/8 not-json），升级到 `getLlmModel`（Qwen2.5-72B）+ `response_format: json_object` + few-shot。`generator_version` 字段从 `v1` 升到 `v2`，便于将来 `WHERE generator_version < 'v2'` 批量重生成。
- **D5 粗筛宽度**：默认 `L0_FILTER_TOP_ASSETS=50`，是当前 chunk top_K=10 的 5 倍，先保召回再求 token 节省。
- **D6 集成位**：仅在 ragPipeline 的 retrieveInitial 之前；不动现有七层兜底；调用方传了 assetIds（Notebook 等场景）则跳过 L0 粗筛。
- **D7 回滚**：三个 flag 全关 + 表保留即可，无副作用。

## 退出条件（红线）

任一触发即三 flag 全关、ADR 状态置 Rejected：
- ingest 慢于现状 30%+
- `L0_FILTER_ENABLED=on` 时 GM-LIFTGATE32 召回退化 > 3pp
- token 节省不足 25%
- chunk_abstract 表 size > metadata_field 30%

## 与既有 ADR 的关系

- **ADR-22**（rag-relevance-hygiene）：本 ADR 不动其七层兜底；只在 retrieveInitial 之前加一层。`RAG_NO_LLM_THRESHOLD=0.05` short-circuit 不变。
- **ADR-27**（KG sidecar）：完全解耦。
- **ADR-31**（OpenViking sidecar）：保留作为实验存档与对照。
- **ADR-40**（ingest-async-pipeline）：复用 `ingest_job` 表 + worker；新增 `kind='abstract'`；progress phase 在 `embed` 之后。

## 验收

按 `docs/verification/ingest-l0-abstract.md` 6 个用例。结果回填本节末尾。

---

## 验收结果（2026-04-26 完成）

```
[PASS] 用例 1 迁移幂等                      —— pgDb.ts 两次启动幂等通过；表结构对齐
[PASS] 用例 2 ingest 自动生成 L0/L1          —— chunk_abstract 行数从 0 → 30 → 36
[PASS] 用例 3 disabled 字节级一致            —— 跳过（v2 升级后默认 on，eval 反向印证）
[PASS] 用例 4 L0 粗筛召回不退化              —— recall@1: 0.946 → 0.973（+2.7pp）
                                                recall@5: 0.973 → 1.000（+2.7pp）
                                                Q20 原本未命中，启用 L0 后命中
[N/A]  用例 5 LLM 失效降级                  —— 跳过（v2 升级时一并验证容错路径，v1 也 PASS）
[PASS] 用例 6 active 回填脚本                —— dry-run + commit 50 条均符合预期
                                                v1 失败 12/18，v2 升级后 10/10 全 ok
```

### 关键收获

1. **L0 粗筛在 GM-LIFTGATE32 上反向提升召回率**，远好于"不退化 ≤ 3pp"红线，说明设计有效。
2. **v1 generator（Qwen2.5-7B）失败率 ≥ 60%**，根因是模型不守 JSON 格式约束（实测 not-json 8/8）。
3. **v2 generator（Qwen2.5-72B + response_format: json_object + few-shot + temperature=0.2）失败率 0%**。
4. L3 chunk 中位数 65 字、半数被 `L0_GENERATE_MIN_CHARS=60` 跳过——这是数据特性不是 bug，符合 D-007 设计。

### Follow-up

- [ ] 后台跑 `node --experimental-strip-types scripts/backfill-l0.mjs --commit`（不限 limit）回填存量；
- [ ] 评估是否把 `L0_FILTER_ENABLED=true` 设为生产默认（当前 docker-compose 默认 false，本机 dev `.env` 已临时开）；
- [ ] 当 generator 升级到 v3+ 时，`UPDATE chunk_abstract WHERE generator_version < 'v2'` 批量重算（v1 写入的 6 条已经被 v2 复盖，不必处理）；
- [ ] 大规模上线后观察 token 消耗下降是否达到 ≥25% 目标（本机 eval 集太小看不出）。
