# ADR 2026-04-27-44 · LanceDB 借鉴评估落地：asset-vector-coloc 上线 + halfvec opt-in + 三条 deferral

## Context

用户 2026-04-27 要求对 lancedb/lancedb 做技术调研，识别可借鉴点。沿用 ADR-39 同款 WeKnora 方法论，工作流外起 Explore，再走 B 工作流锁定执行归档。

调研外部网络 GitHub 不可达（与 ADR-39 同），结论基于 lancedb 官方文档、2026-02 newsletter 与公开博客（HF Hub 集成、Git-style branching、RaBitQ、GPU IVF/PQ、DuckDB 桥）。

LanceDB 的核心理念是"AI-native 多模态 lakehouse"：列存 + vector + image bytes 同表，多语言 SDK，HNSW + RaBitQ 量化。本 ADR 评估这些理念在本仓库 pgvector 真相源（ADR-21-05 锁定）下的可借鉴度，并把执行结果钉死。

## Decision

### D-001 借鉴点对照（与 ADR-39 同款分级）

| # | LanceDB 原生能力 | pg 生态等效 | 现状 | 处置 |
|---|---|---|---|---|
| 1 | RaBitQ 量化 | pgvector ≥ 0.7 `halfvec` + 0.8 `bit(N)` Hamming HNSW + pgvectorscale | 默认 `vector(4096)` IVFFlat lists=100 | ⭐⭐⭐ 本 change 落地（halfvec opt-in） |
| 2 | image bytes / vector / metadata 同行存储 | `metadata_field.image_id → metadata_asset_image.file_path → infra/asset_images/` 已链路打通 | 链路在但 RAG citation 不透 image_id | ⭐⭐ 本 change 落地（Citation 透图） |
| 3 | HuggingFace Hub 原生 | 与"国产化适配 + 私有部署"卖点冲突 | — | 不借鉴 |
| 4 | GPU IVF/PQ 训练 | 国产 GPU 兼容性空白 | — | 不借鉴 |
| 5 | Git-style 数据分支 | OpenSpec + 金标集版本号已覆盖 | — | 不借鉴 |
| 6 | DuckDB SQL 桥 | Postgres 已是 SQL，dataAdminAgent 已用 | — | 不借鉴 |

### D-002 本 change 实际交付

走完 B 工作流四步：

| 步 | 产物 | 状态 |
|---|---|---|
| 1 Explore | `docs/superpowers/specs/pgvector-modernization/design.md` | ✅ |
| 2 Lock | `openspec/changes/asset-vector-coloc/{proposal,design,specs,tasks}.md` | ✅ |
| 3 Execute | 见下方代码改动表 | ✅ |
| 4 Archive | 本 ADR + 归档 spec + 三条 OQ + PROGRESS-SNAPSHOT | ✅ |

代码改动落地（`openspec/changes/asset-vector-coloc/`）：

| 模块 | 改动 |
|---|---|
| `apps/qa-service/src/services/pgDb.ts` | 新增 `migrateToHalfvec()`（**默认 OFF**，env `PGVECTOR_HALF_PRECISION=true` 才生效），含三层兜底（flag 关 / pgvector < 0.7 / 列已 halfvec） |
| `apps/qa-service/src/services/knowledgeSearch.ts` | retrieval SQL `SELECT` 列表追加 `kind`、`image_id`；`AssetChunk` 类型加同名两字段 |
| `apps/qa-service/src/services/ragPipeline.ts` | `toCitation` 新增 image_id/image_url 回填段（kind='image_caption' && image_id > 0 时）；env `CITATION_IMAGE_URL_ENABLED=false` 可关 |
| `apps/qa-service/src/ragTypes.ts` | `Citation` 接口加可选 `image_id` / `image_url`，向后兼容 |
| `apps/web/src/{knowledge/QA, knowledge/Agent, knowledge/Notebooks/ChatPanel}` 与 `apps/web/src/api/notebooks.ts` | 三处 Citation 渲染加 64×64（hover 卡片 96×96）缩略图，三处 Citation 接口同步加字段 |
| `scripts/rollback-halfvec.mjs` | 紧急回滚脚本，dry-run 默认；通过 qa-service 的 `getPgPool` 复用 pg 依赖（与 `backfill-l0.mjs` 同款） |
| `apps/qa-service/src/__tests__/{citationImage,halfvecMigration}.test.ts` | 17 个 case 全绿 |

### D-003 halfvec **默认 OFF** 的最终决策（颠覆 Step 1 期初规划）

Explore 阶段 §3.5 写了"实测 recall@5 退步 → 退"，本 change Step 3 跑 F3 eval-recall 暴露两层独立现象：

**层 1 · halfvec borderline 副作用（真实存在但局限）**

halfvec ON 模式下 Q26 / Q32 两题的 retrieveInitial 候选从"5 个 score < 0.5"被切到"(空)"——MIN_SCORE=0.5 阈值的 borderline 切线效应（fp16 在 4096-d cosine 上的累积误差把 ~0.51 压到 ~0.49）。**对 recall@5 无影响**（这两题的期望 asset_id=5 在两种模式下都没进 top-5），但 retrieveInitial 输出从 5 候选退化到 0 候选会让 LLM 回答质量下降（无 context）。

**层 2 · 1.000 → 0.865 的更大基线漂移（与 halfvec 无关）**

跨 4 种配置（halfvec ON · vector · L0 ON · L0 OFF）实测 recall@5 一律 0.865，5 道漏召回完全相同。PROGRESS-SNAPSHOT-2026-04-26-l0-abstract.md 的 `recall@5=1.000` 在当前 corpus + eval 集上**不可复现**，可能原因：corpus 漂移 / eval 集扩张 / 某次 ingest 副作用。**这一条与本 change 完全无关**，归 OQ-EVAL-RECALL-DRIFT 单独追查。

**决策**：

- halfvec 迁移代码、单测、回滚脚本**全部保留**作为"opt-in 能力"——env `PGVECTOR_HALF_PRECISION=true` 才生效；**默认翻为 false**（与初版相反）。
- 默认 OFF 理由不是"halfvec 引发了 recall 跌落"（这个判读经实测推翻），而是 **(a)** halfvec 对 Q26/Q32 类 borderline 题有"5 候选 → 0 候选"的局部退化、**(b)** 当前 corpus 体量 ≤ 30 MB / 2k 行，halfvec 节省的 ~14 MB 不足以抵消任何风险。
- "halfvec 的真正甜区"留 OQ-VEC-QUANT-V2，触发条件参见下文。

### D-004 三条 deferral 写入 `.superpowers-memory/open-questions.md`

| OQ ID | 内容 | 触发条件 |
|---|---|---|
| OQ-VEC-QUANT-V2 | halfvec / binary quantization (`bit(4096)` HNSW) / pgvectorscale DiskANN | rows > 50k OR size > 200 MB OR P95 > 100 ms；且**前置必须**先解决 MIN_SCORE adaptive 或 reranker 兜底 |
| OQ-CAPTION-DUAL-EMBED | `caption_embedding` 单独一列（专用 caption 模型） | 引入异构 caption embedding 模型（如 BGE-M3 caption-tuned）时 |
| OQ-EVAL-RECALL-DRIFT | 1.000 → 0.865 基线漂移追查 | 立即可启（独立 change，与本 ADR 无依赖）；查 chunk_abstract 覆盖率、eval 集 v2 增量、近 3 周 ingest 操作日志 |

### D-005 关于自我反思（debrief / lessons）

Step 3 跑 F3 看到 0.865 时第一反应判 halfvec 是凶手。这个结论在 rollback 后的第二次 eval（vector 模式 + L0 OFF 同样 0.865）+ 第三次 eval（L0 ON 同样 0.865）实测下被推翻——**halfvec 与 1.000→0.865 这个大漂移没关系**。

**根因**：把 PROGRESS-SNAPSHOT 上的"1.000"当作了"当前默认配置下可复现的基线"，而没有先核对那次测量时的 flag 状态、corpus snapshot、eval 集版本。

**修补**：未来跑回归测试前必须先做"基线条件锚定"——把上次基线测量的环境（env、flag、corpus 行数、eval 集 commit）记录到 PROGRESS-SNAPSHOT 的指标块旁边，否则任何"基线退化"判读都不靠谱。这个动作本身归 OQ-EVAL-RECALL-DRIFT。

**halfvec rollback 的动作本身没错**——fp16 borderline 副作用是真的，30 MB 体量下没回报；只是因果故事写错了。这一段写进 ADR 不是为了"自责"，是为了让以后任何看到本 change 的人知道：halfvec 默认 OFF 的真正理由是 **D-003 §决策** 列的两条，不是被一次错误归因吓的。

## Consequences

### 正向

- LanceDB 借鉴评估全部回溯（本 ADR + Explore design + OpenSpec change + 3 条 OQ），不会在 session 结束后蒸发；
- Item 2 落地后多模态 ingest 链路用户体感打通——RAG citation 区直接渲染 PDF 抽出的图，国产 corpus 的"多模态私有化卖点"有了端到端可演示路径；
- halfvec / binary quantization / pgvectorscale 三条向量瘦身路径全部以 opt-in + 触发条件式登记，未来 corpus 涨上量时不用再"凭印象"启动；
- Citation 字段以可选追加方式扩，v1.x 客户端不破，反序列化兼容。

### 负向 / 取舍

- halfvec 迁移代码作为默认关闭的备用能力留在 `pgDb.ts` 里，多了一段需要长期维护的旁路；权衡是它带"幂等 + 三层兜底 + 显式 opt-in"全套护栏，维护成本主要是单测；
- ADR-44 与 ADR-39 同样存在"工作流外的调研登记"性质，但本次还跨完了 B 工作流四步，归档复杂度更高，依赖未来读者读懂"Step 3 中途修订"这种叙事弯折；
- D-003 §决策的最终 verdict（halfvec 默认 OFF 不是因为引发 recall 跌落）需要读到 §决策第三段才能澄清；为防止未来误读，proposal.md 与 spec.md 都已同步加 §"2026-04-27 修订"段。

### 后续触发的 D-006（2026-04-27 同日加注）

eval-recall.mjs 没有"基线条件锚定"——上次测量时的 flag 状态没沉淀进 PROGRESS-SNAPSHOT 指标块。OQ-EVAL-1（已存在）覆盖了"PG preflight 检查 expected_asset_ids 漂移"，但**不**覆盖"测量条件锚定"。建议把这条作为 OQ-EVAL-RECALL-DRIFT 的子项一并解决。

## Links

- 上游 ADR-21-05：`.superpowers-memory/decisions/2026-04-21-05-q002-pgvector-source-of-truth-confirmed.md`（pgvector source-of-truth 锁）
- 上游 ADR-39：`.superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md`（同款方法论）
- Explore 设计稿（归档前位置）：`docs/superpowers/specs/pgvector-modernization/design.md`
- 归档目标位置：`docs/superpowers/archive/asset-vector-coloc/`
- 本 change OpenSpec 契约：`openspec/changes/asset-vector-coloc/`
- 三条 OQ 落点：`.superpowers-memory/open-questions.md`（OQ-VEC-QUANT-V2 / OQ-CAPTION-DUAL-EMBED / OQ-EVAL-RECALL-DRIFT）
- LanceDB 2026-02 newsletter：https://www.lancedb.com/blog/newsletter-february-2026
- pgvector 0.8 binary quantization：https://github.com/pgvector/pgvector#binary-quantization
- pgvectorscale DiskANN：https://github.com/timescale/pgvectorscale
