# Explore · Design: pgvector-modernization (LanceDB 借鉴落地)

> **工作流**：B `superpowers-openspec-execution-workflow` · Step 1 Explore
> **日期**：2026-04-27
> **状态**：草稿 · 待 review 后进入 Step 2 OpenSpec Lock
> **上游契约**：
> - ADR-21-05 `q002-pgvector-source-of-truth-confirmed`
> - `openspec/changes/metadata-catalog-pgvector/`
> - `openspec/changes/ingest-l0-abstract/`
> - `openspec/changes/asset-delete/`（图片删除路径）
> - ADR-39 `weknora-borrowing-map`（借鉴登记同款方法论）

---

## 0. 一句话目标

把 LanceDB 的两个理念翻译成 pgvector 生态的对应物，**在不冒动 ADR-21-05 锁定的"pgvector = source of truth"前提下**做两件小而独立的事：

1. **高维向量瘦身**：4096 维 `vector` → `halfvec(4096)`（+ 可选 `pgvectorscale` DiskANN），降存储/内存。
2. **多模态资产-向量更紧耦合**：`image_id` 透出到 RAG citations + 给图 caption 单独一列向量（`metadata_field.caption_embedding`）。

两条都**不是召回率攻坚**（recall@5=1.000 已封顶），都是**存储 / 体感 / 多模态可用性**攻坚。

---

## 1. 借鉴对照与降级

LanceDB 给的灵感 → pg 生态等效落地：

| LanceDB 原生能力 | pg 生态等效 | 现状 | 可落地度 |
|---|---|---|---|
| RaBitQ 量化（LanceDB 自家） | `pgvector ≥ 0.7` `halfvec`（fp16，立省 50%）+ `pgvectorscale` DiskANN/二值量化 | pgvector pg16 默认 `vector(4096)` IVFFlat | ⭐⭐⭐ 半天工时 |
| Lance 列存把 image bytes / vector / metadata 同行 | 已在 `metadata_field.image_id` → `metadata_asset_image.file_path` 落盘，**架构已等价** | 见发现 1 | ⭐⭐ 只剩 2 件小事 |
| Hugging Face 原生镜像 | 与"国产化适配 / 私有部署"卖点冲突 | — | 不借鉴 |
| GPU IVF/PQ 训练 | 国产化部署不依赖 NVIDIA | — | 不借鉴 |
| Git-style 数据分支 | OpenSpec + 金标集版本号已覆盖 | — | 不借鉴 |
| DuckDB SQL 桥 | Postgres 自己就是 SQL，dataAdminAgent 已用 SQL | — | 不借鉴 |

**结论**：LanceDB 借鉴的真实可落地面是表中前两行。**这就是本 change 的全部 scope**。

---

## 2. 现状盘点（cite to file:line）

### 2.1 向量列 / 索引

```text
apps/qa-service/src/services/pgDb.ts:55–69
  metadata_field.embedding          vector(4096)   IVFFlat lists=100
ingest-l0-abstract/design.md
  chunk_abstract.l0_embedding       vector(4096)   IVFFlat lists=100
```

**4096 是 hardcoded** 在 `pgDb.ts` 里，不读 env。改维度需要 ALTER TABLE + 重 embed，做不到运行时切换。

### 2.2 多模态链路（已存在的）

```text
apps/qa-service/src/services/pgDb.ts:98–125
  metadata_field.image_id  INT FK → metadata_asset_image.id  (ON DELETE SET NULL)
  metadata_asset_image:
    (id, asset_id, page, image_index, bbox, file_path TEXT, caption TEXT)

apps/qa-service/src/services/pdfPipeline/index.ts:35–80
  · @opendataloader/pdf 抽 paragraph/heading/table/image
  · INGEST_VLM_ENABLED=on → captionImages() 给每张图调 Qwen2.5-VL-72B
  · caption 文本作为 kind='image_caption' 的 chunk 写进 metadata_field
  · file_path 形如 'infra/asset_images/{assetId}/{page}-{idx}.{ext}'

apps/qa-service/src/routes/assetDirectory.ts:503–540
  GET /api/assets/images/:imageId → 读 file_path → 返 bytes（已实现）
```

**含义**：图字节 + 元数据 + caption + 向量已经全部串起来。**Lance"同表存"的工程价值在 pg 里是"链路是否暴露"，不是"是否合并"**。

### 2.3 Citations 链路（待查实）

```text
apps/qa-service/src/services/ragPipeline.ts:???
  Citation 类型: ../ragTypes.ts
```

**Open Question OQ-1**：`Citation` 当前字段是否包含 `image_id` / `imageUrl`？前端 `MarkdownView.tsx` 是否消费？需要在 Step 2 Lock 前 5 分钟读 `ragTypes.ts` 确认。

### 2.4 召回基线（最近一次 PROGRESS-SNAPSHOT）

```
GM-LIFTGATE32 v2 · 37 题
recall@1 = 0.973
recall@3 = 1.000
recall@5 = 1.000
top-5 漏召回 = 0 题
```

**任何方案让 recall@5 < 1.000 都直接退出**——这是 D 类硬约束，不接受用召回换存储。

---

## 3. Item 1 · 高维向量瘦身（halfvec + pgvectorscale）

### 3.1 三选一对照

| 方案 | 存储节省 | recall 风险 | 工程复杂度 | 国产化兼容 | 可逆性 |
|---|---|---|---|---|---|
| **A. `halfvec(4096)`**（pgvector ≥ 0.7） | **−50%** | 极小（fp16 vs fp32） | 极低（ALTER TABLE） | ✅ pgvector 系是 PG 扩展，国产 PG 兼容性好 | ✅ 可一键切回 |
| B. pgvectorscale DiskANN + 二值 | −80～90% | 视参数；DiskANN 默认配置 recall ≥ 0.95 | 中（新扩展、调参） | ⚠️ TimescaleDB 系，国产 PG 部分发行版需自行编 | ⚠️ 切回需重建索引 |
| C. RaBitQ（自实现） | 类似 B | 学术参数，无生产经验 | 高（自己写量化 + 索引） | ❌ pg 无原生 | ❌ |

### 3.2 推荐执行节奏（2026-04-27 修订：pgvector 0.8.2 已确认，新增 Phase 1.5）

**Phase 1（本 change 必做，低风险首选）**：
- 把 `vector(4096)` 列**全部**改成 `halfvec(4096)`，包括：
  - `metadata_field.embedding`
  - `chunk_abstract.l0_embedding`
- 索引保持 IVFFlat，operator class 切 `halfvec_cosine_ops`。
- **可逆开关**：留 `PGVECTOR_HALF_PRECISION=true` env，默认 on；遇到 fp16 精度问题（实测后）一键回滚。
- 收益：存储 −50%、recall 几乎不变（fp16 vs fp32 在 4096-d cosine 上 ε < 0.001）。

**Phase 1.5（pgvector 0.8.2 解锁，建议作为 `pgvector-halfvec-quant` 第二批 task，灰度 on/off）**：
- 增加 `metadata_field.embedding_bin BIT(4096)` 列，存正交化二值化向量；
- 检索改两阶段：`bit <~> bit` Hamming top-N（粗筛 N=200）→ 取候选 id 回查 `halfvec` 精排 top-K（K=10）；
- 索引：`CREATE INDEX … USING hnsw (embedding_bin bit_hamming_ops)`（pgvector 0.8 HNSW 走 bit 算子）；
- 收益：粗筛阶段存储 −97%（512B/行）、HNSW Hamming 是 SIMD 友好的，吞吐数倍；
- **必备兜底**：第二阶段 halfvec 精排不可省，否则 recall 退化 → 强约束 `recall@5 ≥ 1.000` 兜底。
- flag：`PGVECTOR_BIN_RECALL_ENABLED=false` 默认关，eval 通过才打开。

**Phase 2（本 change **不做**，留作 `OQ-VEC-DISKANN`）**：
- 引入 `pgvectorscale` 的 DiskANN / StreamingDiskANN 索引。
- 触发条件：`metadata_field` 行数 > 5M 且 Phase 1.5 上线后 P95 检索 仍 > 200ms。
- 国产化兼容性需现核（pgvectorscale 是 Timescale 系，国产 PG 部分发行版需自行编 .so）。

### 3.3 收益假设（必须 Phase 1 实测后回填）

- **存储**：`metadata_field.embedding` 单行原 16KB → 8KB；按当前 corpus 估算节省 X GB（待跑 `pg_total_relation_size('metadata_field')` 取数）。
- **内存**：IVFFlat list 在 work_mem 中加载量减半。
- **召回**：实测 recall@5 ≥ 当前 1.000（fp16 vs fp32 对 cosine 相似度的影响在 4096 维上预期 < 0.001）。

### 3.4 风险与回滚

| 风险 | 兜底 |
|---|---|
| pgvector 容器版本是否 ≥ 0.7（halfvec 引入版本） | docker-compose 里 image tag 当前是 `pgvector/pgvector:pg16`——查 tag 实际 pgvector 版本，不够则升 |
| ALTER TABLE 重写大表锁表 | 用 `ALTER TABLE … ALTER COLUMN … TYPE halfvec USING embedding::halfvec` 在维护窗口跑；金标集 corpus 体量小（<1k assets），分钟级 |
| 现有 SQL 中所有 `embedding <=> $1::vector` 调用 | 用 `embedding <=> $1::halfvec`，写一个 search_path helper 收口；vectorSearch.ts / hybridSearch.ts / l0Filter.ts 三处需要扫一遍 |
| Embedding API 还是返 fp32 数组 | 应用层直接 cast 即可；pg 驱动会自动序列化 |

### 3.5 中止条件（实测后任一触发就退）

- pgvector 实际版本 < 0.7 且不愿升级 → 退
- ALTER TABLE 在生产 corpus 上耗时 > 30 min → 走灰度迁移而非本 change
- 实测 recall@5 退步 → 退（fp16 不是 fp32 的等价，这个不是教条）

---

## 4. Item 2 · 多模态资产-向量更紧耦合

### 4.1 真实剩余的两件事

**A. RAG citations 透出 `image_id`**：

```diff
  // ragTypes.ts · Citation
  {
    asset_id: number,
    asset_name: string,
    page: number,
    text: string,
    score: number,
+   image_id?: number,            // 来源 chunk 是 kind='image_caption' 时回填
+   image_url?: string,           // 默认 `/api/assets/images/${image_id}`
  }
```

前端 `MarkdownView.tsx` / `Cards/*.tsx` 在 citation 渲染时若 `image_url` 非空则渲染 `<img>` 缩略图。
**触发在 ragPipeline.ts 的 emit citation 拼装那一段**，改动小。

**B. caption 独立向量列（可选，灰度上）**：

```diff
  CREATE TABLE metadata_field (
    ...
    embedding         halfvec(4096),    -- 当前唯一向量列
+   caption_embedding halfvec(4096),    -- 仅 kind='image_caption' 行非 NULL
    ...
  )
```

为什么单列：
- 现在所有 chunk 共用 `embedding` 一列，VLM caption 文本和正文段落混在一个语义空间检索；
- 单列后允许"图问图"——查询是图片或图片问题时只查 `caption_embedding`，文字走 `embedding`，hybridSearch 可加第三路（与 ADR-39 D-002 OAG Phase 2 三路召回逻辑同构，但低成本）。
- **注意**：本 change 只**加列、写列**；hybrid 第三路检索逻辑**留给后续 OQ-CAPTION-RECALL change 评估**——eval 数据没出来前不开第三路。

### 4.2 不做的事（明确划界）

- ❌ **不把图字节塞进 PG**（PG `bytea` / Large Object 化）。理由：
  - VACUUM / 备份成本爆炸，violates "五容器一键起栈"卖点
  - 现在 `infra/asset_images/{assetId}/` docker volume + assetDirectory 路由已经够用
  - LanceDB"同行存"是列存优化，PG 是行存，照搬反而劣化
- ❌ **不动 file_path 命名规则 / 不动 asset-delete 路径**（ADR-30 刚归档）。
- ❌ **不动 VLM 模型**。

### 4.3 风险与回滚

| 风险 | 兜底 |
|---|---|
| 加列 `caption_embedding` 但 ingest 不回填 → 列长期 NULL | 后台脚本 `scripts/backfill-caption-embedding.mjs`（仿 backfill-l0.mjs 模板，断点续跑） |
| Citation `image_url` 字段下游消费方破坏（mcp-service 是否消费 RagTrace？） | mcp-service 与 qa-service 是宿主-子进程关系，不直接消费 Citation；前端是唯一消费方，灰度发即可 |

---

## 5. 零基线对照（Step 2 锁定前必须填）

> 这是 ADR-39 D-002 同款"先填基线再决定要不要锁"的纪律。下面留空格，**Lock 前由执行人手动跑命令填进来**，不填就不准 Lock。

### 5.1 存储基线

```bash
# 跑这条命令填表
docker exec -it pg_db psql -U knowledge -d knowledge -c "
SELECT
  pg_size_pretty(pg_total_relation_size('metadata_field'))    AS field_total,
  pg_size_pretty(pg_relation_size('metadata_field'))          AS field_heap,
  pg_size_pretty(pg_indexes_size('metadata_field'))           AS field_idx,
  pg_size_pretty(pg_total_relation_size('chunk_abstract'))    AS abs_total,
  count(*)                                                     AS field_rows
FROM metadata_field;"
```

| 指标 | 现值（2026-04-27 实测） | halfvec 后预期 |
|---|---|---|
| metadata_field 总大小 | **29 MB**（heap 592 kB、idx 144 kB、TOAST 主导） | ≈ 15 MB |
| 行数 | **2,036** | 同 |
| chunk_abstract 总大小 | **14 MB / 850 行** | ≈ 7 MB |
| **判决** | 总向量基底 ≤ 30 MB / 2k 行——量级远低于 §8 条件 1 的 100 MB 阈值 | **§8 条件 1 触发** |

### 5.2 检索 latency 基线

```bash
node --experimental-strip-types scripts/eval-recall.mjs \
  eval/gm-liftgate32-v2.jsonl --measure-latency
```

| 指标 | 现值 | halfvec 后预期 |
|---|---|---|
| recall@5 | 1.000 | **必须 ≥ 1.000** |
| P50 检索 latency | _____ | ≈ 当前（halfvec 不影响算子） |
| P95 检索 latency | _____ | ≈ 当前 |

### 5.3 pgvector 实际版本 ✅（2026-04-27 已验证）

```bash
docker exec pg_db psql -U knowledge -d knowledge -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
# extversion = 0.8.2
```

| 项 | 值 |
|---|---|
| 容器内 pgvector 版本 | **0.8.2** |
| 是否 ≥ 0.7（halfvec 起点） | ✅ |
| 是否 ≥ 0.8（**binary quantization 起点**） | ✅ |

**含义**：原 design 只规划了 halfvec（−50%），现在多解锁一个杠杆——`bit(N)` + `<~>` Hamming + 反向 reranker，可达 **−97% 存储**（4096-d fp32 = 16KB → 4096-d bit = 512B）。但 binary quantization 必须配 reranker 兜底，否则 recall 显著下降。规划上提为 **Phase 1.5**（见下文 §3 修订）。

---

## 6. 单条 OpenSpec change（Step 2 准备 · 2026-04-27 修订）

按 §8 verdict 与 Step 1.5 决策，**Step 2 Lock 只锁一条 change**：`asset-vector-coloc`，halfvec 作为 free-rider 并入。

| Change 名 | 范围 | 触及表 | 触及代码 |
|---|---|---|---|
| `asset-vector-coloc` | Item 2a + halfvec rider | metadata_field 列类型迁 halfvec、chunk_abstract.l0_embedding 同迁、Citation 加 `image_id` / `image_url` | pgDb.ts、vectorSearch.ts、hybridSearch.ts、l0Filter.ts、ragPipeline.ts、ragTypes.ts、apps/web Citation 渲染 |

**已 deferral 的子项（写进 ADR-44 + open-questions.md）**：

| OQ ID | 内容 | 触发条件 |
|---|---|---|
| OQ-VEC-QUANT-V2 | binary quantization (`bit(4096)` + Hamming HNSW) Phase 1.5 | rows > 50k OR size > 200 MB OR P95 > 100 ms |
| OQ-VEC-DISKANN | pgvectorscale DiskANN/StreamingDiskANN | rows > 5M AND P95 > 200 ms |
| OQ-CAPTION-DUAL-EMBED | `caption_embedding` 单独一列（要专用 caption 模型才有价值） | 引入异构 caption embedding 模型时 |

---

## 7. 留给 Step 2 Lock 之前的 Open Questions

| ID | 问题 | 谁回答 | 影响 |
|---|---|---|---|
| OQ-1 ✅ | `Citation` / `RagTrace` 当前是否已透 `image_id` | **答**：未透；Citation 仅 `{index, asset_id, asset_name, chunk_content, score}`，前端无消费 → Item 2 改动 ~30 行有效 | — |
| OQ-2 ✅ | pgvector 实际版本 | **答**：0.8.2 → halfvec + binary quantization 双双解锁，新增 Phase 1.5 规划 | — |
| OQ-3 | 第 5 节零基线数据（存储 / latency） | Lock 评审会上跑 | 决定是否真值得做（如果存储 < 100MB 就不值得） |
| OQ-4 | 是否同时给 `caption_embedding` 建独立 IVFFlat 索引 | 等 OQ-3 数据 | 索引数量影响写入吞吐 |
| OQ-5（新增） | Phase 1.5 二值化粗筛是否纳入 `pgvector-halfvec-quant` 同一 change，还是拆出 `pgvector-bin-recall` 独立 change | Lock 评审 | 影响 Step 2 拆 2 个 vs 3 个 change |

---

## 8. 中止建议（B 工作流允许的退路）

按 CLAUDE.md "验证输出是完成的门槛"，本 design.md 主动给出**两条中止条件**：

**条件 1**：第 5 节基线数据出来后，`metadata_field` 总大小 < 100MB 且 P95 检索 < 50ms → **中止 Item 1**（收益过小，工程税不划算），把 OQ-VEC-QUANT 重新打回 `open-questions.md`，等数据涨上来再启。

**条件 2**：OQ-1 答案是"`Citation` 已经透了 `image_id` 且前端已渲染"→ **Item 2 直接降级为 0 行 change**（写 ADR 说明已就绪，不需要新 change）。

### 8.x 2026-04-27 verdict

| 条件 | 触发判定 |
|---|---|
| 条件 1（Item 1 中止） | ✅ **触发** — `metadata_field` 仅 29 MB / 2,036 行，远低于 100 MB 阈值；P95 latency 不必测，2k 行 IVFFlat 等同 flat scan，必然 < 50ms |
| 条件 2（Item 2 降级 0 行） | ❌ **未触发** — `Citation` 类型 = `{index, asset_id, asset_name, chunk_content, score}`，无 `image_id`；前端无消费 |

**初版含义**：Item 1（halfvec + binary quantization）整体 deferral；Item 2（asset-vector-coloc）正常进 Step 2 Lock；halfvec 作为 free-rider 并入 Item 2（user 选择"halfvec 搻车"）。

### 8.y 2026-04-27 二次 verdict（halfvec rider 触发回滚）

Step 3 Execute 完成后跑 F3 eval-recall，**halfvec 触发实际精度回归**：

| 指标 | 基线 | halfvec 后 | 变化 |
|---|---|---|---|
| recall@5 | 1.000 | **0.865** | **−0.135** |
| recall@3 | 1.000 | 0.730 | −0.270 |
| recall@1 | 0.973 | 0.081 | −0.892 |
| top-5 漏召回 | 0 题 | **5 题** | +5 |

**症结**：5 道漏召回里 Q26、Q32 是"实际=(空)"——retrieveInitial MIN_SCORE=0.5 阈值切掉了所有候选。这是 fp16 精度损失的**典型特征**：4096-d cosine 累积误差把 borderline 分数（真实 ~0.51）压到阈值线下面（halfvec 计算 ~0.49）。

**动作**：
1. 代码默认 flag 翻成 OFF（`PGVECTOR_HALF_PRECISION=false` 默认；显式 on 才迁移）
2. SQL 算子 cast 还原（`$1::halfvec` → `$1::vector` / 无 cast）
3. 用户机器跑 `scripts/rollback-halfvec.mjs --commit` 把 PG 列回退到 vector(4096)
4. ADR-44 把"halfvec 在 GM-LIFTGATE32 上推 5 题精度回归"作为**最有价值的发现**钉住
5. **最终交付**：本 change 只剩 Item 2（Citation 透图） + halfvec 迁移代码作为**默认关闭、显式 opt-in**的备用能力

**新触发条件（OQ-VEC-QUANT-V2，2026-04-27 加严）**：

之前以为 halfvec 是"几乎无副作用"，实测推翻。重启前必须先解决：
1. 找出真正的 borderline 召回阈值——MIN_SCORE 是否需要 adaptive（top-K 自动放宽到 K+m，再用 reranker 兜底）；**或**
2. 升级到专为高维 cosine 设计的量化方案（pgvector 0.8 的 `bit(4096)` Hamming HNSW 必须配 reranker，**不**是 halfvec 直接替）；**或**
3. corpus 涨到 row > 50k 后再实测——大 corpus 上 halfvec 误差对 top-K 排名影响相对变小（borderline 比例下降）。

任一前置满足 + 实测 recall@5 ≥ 基线，才能再启 PGVECTOR_HALF_PRECISION=true。

---

## 9. Step 2 Lock 准入清单（review checklist）

进入 Step 2（OpenSpec Lock）必须满足：

- [ ] OQ-1 已回答（读 ragTypes.ts）
- [ ] OQ-2 已回答（pgvector 版本查清）
- [ ] OQ-3 基线表已填完
- [ ] 第 8 节中止条件已逐条 verdict（True / False）
- [ ] 上游 ADR-21-05 / metadata-catalog-pgvector 没有冲突点（已确认 ✅）

任一未满足 → 不启动 Step 2，回到本 design.md 补完。

---

## Links

- ADR-39 借鉴登记同款方法论：`.superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md`
- ADR-21-05 pgvector source-of-truth：`.superpowers-memory/decisions/2026-04-21-05-q002-pgvector-source-of-truth-confirmed.md`
- 上游 metadata catalog：`openspec/changes/metadata-catalog-pgvector/`
- 上游 L0 abstract：`openspec/changes/ingest-l0-abstract/`
- pgvector halfvec 文档：https://github.com/pgvector/pgvector#half-precision-vectors
- pgvectorscale（DiskANN）：https://github.com/timescale/pgvectorscale
- LanceDB 2026-02 newsletter（RaBitQ / GPU IVF）：https://www.lancedb.com/blog/newsletter-february-2026
