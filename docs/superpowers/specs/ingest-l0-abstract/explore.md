# Ingest L0/L1 Abstract — Explore

> 工作流：B · `superpowers-openspec-execution`（需求清晰 + OpenSpec 锁契约 + 写代码 + 验证）
> 来源：方案 A 验收全 PASS（ADR-31）→ 推进到方案 B：在 ingest 自实现 L0/L1，不再依赖 OpenViking 容器。
> 目的：在 chunk 之上加一层 asset 级 / chunk 级的"摘要 + 概览"，让 RAG 多一道**廉价的粗筛**，把 LLM grade 的负担从 chunk 数十条降到 asset 个位数。

---

## 1. 动机

现状（ADR-22 / ADR-24 后稳定的七层兜底）的问题：

1. **粗筛粒度太细**。pgvector 直接在 chunk 拓扑上召回 top-K（默认 10，rerank 时拉到 20）。chunk 太碎，召回里常见同一 asset 的多个相邻 chunk 占满前 K，反而把另一篇相关 asset 挤出去。
2. **rerank / gradeDocs 都贵**。两层都按 chunk 数走，rerank 一次 20 条 + LLM gradeDocs 一次 20 条，token 消耗 = chunk 数 × chunk 长度。
3. **L0 摘要在 OpenViking 实验里被验证有效**。LoCoMo10 上 viking 的"先 L0 粗筛 → 再 L2 精读"召回 +49% / token -83%；本机 ADR-31 验收里跨问指代命中率高，说明 L0 在中文语料上也站得住。

把"L0 摘要"从 OpenViking 的 sidecar 搬进 ingest 自实现，意味着：

- 不再依赖 viking 容器（ADR-31 状态保留实验级，不强推生产）；
- L0 数据落在 pgvector 同库旁路表，**RAG 多一个可选的"先在 L0 拉宽 candidate asset，再回到 chunk 精检索"阶段**；
- 复用现有 `embedTexts` / `chatComplete` / 硅基 Qwen，零新外部依赖。

## 2. 边界

**做（本 change）**：

- 新增 `chunk_abstract` 表：每行对应一个 chunk，含 `l0_text`（一句话摘要 ≤200 字）/ `l0_embedding`（向量）/ `l1_text`（结构化概览 ≤600 字）/ `generator_version` / `generated_at`；UNIQUE(chunk_id)。
- 新增 `asset_abstract` 视图或物化视图：把同 asset 的 L1 拼出"asset 概览"，用于 asset 级粗筛。
- ingest 阶段在 chunk 持久化后追加一个 phase `abstract`：批量调 LLM 生成 L0/L1，并发受限+失败容错（不阻断 chunk/embedding 主路径）。
- ragPipeline 加可选阶段 `l0_filter`：`L0_FILTER_ENABLED=on` 时先用 L0 embedding 拉宽 K 倍 asset_id candidate set，传给 `retrieveInitial.assetIds`；缺 L0 时无缝降级到原始路径。
- lazy backfill：rerank 候选阶段顺手把命中但无 L0 的 chunk 后台 enqueue 生成（复用 `ingestWorker` 队列）。
- active backfill：`scripts/backfill-l0.mjs` 顺序扫 chunk 表生成（带 dry-run / limit / rate / resume）。
- 三个 feature flag：`L0_GENERATE_ENABLED`（ingest 是否生成）/ `L0_FILTER_ENABLED`（RAG 是否用）/ `L0_LAZY_BACKFILL_ENABLED`（rerank 时是否 enqueue 缺失项）。

**不做**：

- 不引入 OpenViking 服务（保留 ADR-31 作为对照实验存档）；
- 不上 L2 粒度（L2 = 现有 chunk 全文，本来就在 `metadata_field`）；
- 不动现有 chunking 策略（asset → chunks 还是老路）；
- 不改 rerank / gradeDocs / rewrite / short-circuit 五层兜底，L0 只是在它们前面加一层；
- 不做 BookStack 的 Shelves/Books 层级寻址（那是方案 C，需要单独 P0）；
- 不做跨 asset 的"摘要的摘要"（直接读 metadata_asset.summary 即可）；
- 不做生产化的 L0 重生成调度（generator_version 升级时如何刷库不在本 change，留 follow-up）。

## 3. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| L0 生成被硅基限流，ingest 慢 | 中 | 中 | 并发上限 ≤ 4 + 退避；L0 失败 chunk 留空，ingest 主流程不阻塞 |
| L0 中文摘要质量不稳定 | 中 | 中 | prompt 用 few-shot 锁格式；abnormal 长度 / 全英文 直接丢；eval 集前后跑对比，回退超 5pp 关 flag |
| L0 粗筛漏召（false negative） | 中 | 高 | 默认拉宽倍数大（candidate = top_K × 5），先求召回再求 token 节省；L0_FILTER_ENABLED 默认 off，eval 通过才打开 |
| chunk_abstract 表暴涨 | 低 | 中 | UNIQUE(chunk_id) 防重复；大 PDF 单 asset 上千 chunk 也只是 KB 级数据 |
| 回填脚本压垮在线 LLM 配额 | 中 | 中 | rate-limit + 默认 dry-run + `--limit N --resume-from id` |
| generator_version 升级如何刷 | 中 | 低 | 本 change 不解决；版本号写在每行，将来跑 `WHERE generator_version < 'v2'` 即可 |
| `L0_FILTER_ENABLED=on` 时 RAG 召回退化 > 5pp | 中 | 高 | 红线：触发即关 flag，本 change 状态置候选未生效 |

## 4. 关键决策

- **D1 · 表结构**：`chunk_abstract`（chunk 粒度），不直接做 asset_abstract 表（asset 级用聚合 View）。理由：chunk 粒度粒度细，更新增量友好；asset 级需要的时候 join 出来。
- **D2 · 嵌入维度**：和现有 `metadata_field.embedding` 一致（vector(4096) 或 env 配置的同一维度），同 embedding model。零新模型成本。
- **D3 · L0 长度上限**：单句 ≤ 200 字，配合 `RAG_NO_LLM_THRESHOLD` 0.05 不会被 short-circuit 误伤。
- **D4 · L1 长度上限**：≤ 600 字，给 LLM gradeDocs 用，token 比直接喂 chunk 节省 ~70%。
- **D5 · 粗筛阈值**：`L0_FILTER_TOP_ASSETS` 默认 50（asset 粒度），是当前 chunk top_K=10 的 5 倍宽，保召回。
- **D6 · 生成时机**：`runPipeline` 写完 `metadata_field` 之后立刻批量生成 L0/L1；进异步 phase `abstract`，复用 ingest-async 的 progress 回调，UI 能看到。
- **D7 · 失败策略**：单 chunk L0 生成失败 → 留空、不重试、不阻断；下次任意时刻被 lazy 或 active 回填打到。
- **D8 · 模型**：复用 `getLlmFastModel()`（Qwen2.5-7B），不浪费 72B；prompt 短 + 输出短，单次延迟可接受。

## 5. 成功标准

OpenSpec change 锁定后，执行阶段验收：

1. `pnpm dev:up`（ingest 默认 ON）后新上传一份 PDF，`SELECT COUNT(*) FROM chunk_abstract` > 0；ingest_done 日志带 `abstract_generated/failed/skipped` 三个计数。
2. `tsc --noEmit` 双 0；现有 207 测试不退化；新增 ≥ 6 条 spec 测试（ingest abstract、l0 filter 注入、降级、lazy enqueue、active backfill 各一）。
3. `L0_FILTER_ENABLED=off` 时 GM-LIFTGATE32 表现与 baseline 完全一致（统一字节级）。
4. `L0_FILTER_ENABLED=on` 时 GM-LIFTGATE32 召回率不退化超过 3pp，token 消耗（rerank+grade）下降 ≥ 25%。
5. 关掉硅基 LLM key（模拟 L0 生成失败），ingest 仍能完成；ragPipeline 仍能跑（L0 缺失自动降级到原路径）。
6. `node scripts/backfill-l0.mjs --dry-run --limit 100` 输出预估行数，不写库；不带 `--dry-run` 跑 100 条能跑完且 chunk_abstract 增加。

不通过：任一红线触发，状态置候选不合并 → 关 flag、归档、写下一轮 ADR。

---
