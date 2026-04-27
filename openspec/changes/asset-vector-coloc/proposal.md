# Proposal: asset-vector-coloc — Citation 透图 + halfvec 全列迁移

**日期**：2026-04-27
**状态**：草稿（待 review 后锁定）
**上游 Explore**：`docs/superpowers/specs/pgvector-modernization/design.md`
**上游 ADR**：ADR-21-05 pgvector source-of-truth · ADR-39 WeKnora borrowing map（同款方法论）

## 问题

1. **多模态可用性裂缝**：ingest 已经把图字节落到 `infra/asset_images/{assetId}/` + `metadata_asset_image` 链路完整可查（路由 `/api/assets/images/:imageId` 已就绪），但 RAG 答题给出的 `Citation` 只有 `{index, asset_id, asset_name, chunk_content, score}`，不带 `image_id` / `image_url`。前端拿到 citation 也没法在引用区即时渲染出"这段答案来自这张图"，多模态 ingest 链路在用户体感这一端断了。
2. **4096-d fp32 向量列存储 100% 在 TOAST 里**：`metadata_field.embedding`（vector(4096)）heap 才 592 kB，TOAST 拉到 29 MB；`chunk_abstract.l0_embedding` 同结构。pgvector 已升到 0.8.2，halfvec 已就绪，单次 ALTER TABLE 即可砍掉一半，反正本 change 已经在动 schema，**搻车**完成是工程上最划算的窗口期。

## 方案

单条 change，两件事同迁移、同回滚：

1. **`metadata_field.embedding` 与 `chunk_abstract.l0_embedding`**：类型 `vector(4096)` → `halfvec(4096)`，IVFFlat 索引 operator class 切 `halfvec_cosine_ops`。
2. **`Citation` 类型新增 `image_id?: number` 与 `image_url?: string`**，ragPipeline 在拼装 citation 时若来源 chunk 是 `kind='image_caption'` 行则回填，前端 Citation 渲染组件消费这两个字段，提供缩略图链接。

## 决策

- 仅迁 halfvec，**不**做 binary quantization（pgvector 0.8 支持但需配 reranker，2k 行下零收益）→ 留 OQ-VEC-QUANT-V2，触发条件：rows > 50k OR size > 200 MB OR P95 > 100 ms。
- 不新增 `caption_embedding` 列。理由：当前 caption 与正文使用同一 embedding 模型（Qwen3-Embedding-8B），单独存列只是冗余；过滤 `WHERE kind='image_caption'` 已等价。留 OQ-CAPTION-DUAL-EMBED，触发条件：引入异构 caption embedding 模型。
- `Citation.image_url` 由后端拼装（`/api/assets/images/${image_id}`），不让前端再做路径推导，集中收口。
- 整个迁移不破坏 recall@5 = 1.000 基线；任一回归 → 一键关 `PGVECTOR_HALF_PRECISION=false` 回滚（实际通过 ALTER TYPE 双向迁回 vector(4096)）。

## 2026-04-27 修订（halfvec rider 触发回滚）

Step 3 Execute 完成跑 F3 eval-recall：halfvec 让 recall@5 从 1.000 跌到 0.865（5 题漏召回，含 2 题"实际=(空)"——MIN_SCORE 阈值切掉所有候选）。这是 fp16 精度损失的典型特征，**触发 §决策 第 4 条的回滚约定**。

**最终交付范围**：
- ✅ Item 2a · Citation 透 `image_id` + `image_url`（与 halfvec 完全独立，**保留**）
- ✅ halfvec 迁移代码 + 单测 + rollback 脚本（**保留作为 opt-in 能力**，默认 `PGVECTOR_HALF_PRECISION=false`，需要显式打开才生效）
- ❌ halfvec 默认开启（**取消**，由 default=true 翻为 default=false）
- ❌ Phase 1.5 binary quantization（早就不在本 change scope；本次实测加严了 OQ-VEC-QUANT-V2 触发条件）

**最有价值的发现**（写进 ADR-44）：
> halfvec fp16 在 4096-d 高维 cosine 上的累积误差 + MIN_SCORE=0.5 阈值组合，会把 borderline 分数（真实 ~0.51）切到阈值线下面（halfvec 计算 ~0.49），导致小 corpus 上的精度悬崖。**这不是教条**——大 corpus 上 borderline 比例下降，可能反而稳定。重启前必须先解决 MIN_SCORE adaptive 或 reranker 兜底，再实测。

## 不变范围

- 不动 BookStack 相关（依旧 MySQL）。
- 不动 ACL / 权限链路。
- 不动 ingest 切分逻辑、不动 VLM caption 文本生成、不动 file_path 命名规则。
- 不动 mcp-service 协议（mcp 不消费 RagTrace.citations 的 image 字段）。
- 不动 reranker 与 hybrid search 的算法骨架，仅 SQL 算子从 `<=>` cast 升级到 halfvec 算子。
