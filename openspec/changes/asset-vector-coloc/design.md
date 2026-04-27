# Design: asset-vector-coloc

> 配套 `proposal.md` 与外部 Explore 设计稿 `docs/superpowers/specs/pgvector-modernization/design.md`。
> 本文件只保留团队 review 必看的"行为契约 + 兼容性"。

## 数据结构变更

### Phase A · halfvec 列类型迁移

```sql
-- 1. metadata_field.embedding
ALTER TABLE metadata_field
  ALTER COLUMN embedding TYPE halfvec(4096)
  USING embedding::halfvec(4096);

-- 2. chunk_abstract.l0_embedding
ALTER TABLE chunk_abstract
  ALTER COLUMN l0_embedding TYPE halfvec(4096)
  USING l0_embedding::halfvec(4096);

-- 3. 重建 IVFFlat 索引（旧索引在 ALTER COLUMN 时失效）
DROP INDEX IF EXISTS idx_field_embedding;
CREATE INDEX idx_field_embedding
  ON metadata_field
  USING ivfflat (embedding halfvec_cosine_ops)
  WITH (lists = 100);

DROP INDEX IF EXISTS idx_chunk_abstract_l0_embedding;
CREATE INDEX idx_chunk_abstract_l0_embedding
  ON chunk_abstract
  USING ivfflat (l0_embedding halfvec_cosine_ops)
  WITH (lists = 100);
```

幂等性：迁移前先 `SELECT atttypid::regtype FROM pg_attribute WHERE attrelid='metadata_field'::regclass AND attname='embedding'`；若已是 halfvec 跳过。

### Phase B · 无 schema 变更（Citation 字段新增是应用层）

`Citation` 类型字段 `image_id` / `image_url` 不落盘——它们由 ragPipeline 在拼装回包时按 chunk 行的 `image_id` 计算而来。无需 ALTER TABLE。

## TypeScript 契约（`apps/qa-service/src/ragTypes.ts`）

```ts
export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /** 仅当 chunk 行 kind='image_caption' 时回填；前端可据此渲染缩略图 */
  image_id?: number
  /** 后端拼装：`/api/assets/images/${image_id}`；前端无需自行推导 */
  image_url?: string
}
```

`Citation` 字段全部为可选追加，**与 v1.x 反序列化兼容**——遗留前端忽略未知字段即可。

## ragPipeline 拼装逻辑

`ragPipeline.ts` 在 emit citation 时新增一段：

```ts
// 之前：从 retrieval 结果取 asset_id / asset_name / chunk_content / score
const cite: Citation = { index, asset_id, asset_name, chunk_content, score }

// 新增：若 chunk 行 kind='image_caption' 且 image_id 非空，回填两字段
if (chunkRow.kind === 'image_caption' && chunkRow.image_id) {
  cite.image_id = chunkRow.image_id
  cite.image_url = `/api/assets/images/${chunkRow.image_id}`
}
```

约束：
- `chunkRow.kind` / `chunkRow.image_id` 已在 `metadata_field` 表（pgDb.ts L84-98 已有列），**SELECT 列表需新增这两个字段**——这是唯一的 retrieval SQL 改动。
- 若同一 query 命中多张图片 caption，每条 citation 各自带自己的 `image_id` / `image_url`，不去重不合并。

## 前端契约（`apps/web/src/...`）

**最小改动版**（推荐 Step 3 落地）：

- `MarkdownView.tsx` 或 `Cards/*.tsx`（具体在 Step 3 跑 `grep "Citation"` 确认）渲染 citation 列表时，对每条 citation 检查 `image_url`：
  - 非空：在 citation 卡片头部加一个 64×64 缩略图 `<img src={image_url} ... />`，alt 写 `chunk_content` 截断
  - 空：保持原有渲染不变

- 不引入新组件、不改 routing、不改 query/mutation。

## flag 与可逆性

| flag | 默认 | 含义 |
|---|---|---|
| `PGVECTOR_HALF_PRECISION` | `true` | 关闭 → 启动时 `runPgMigrations` 走 vector(4096) 兜底（仅给"暂时无 0.8 容器的环境"用，生产留 true） |
| `CITATION_IMAGE_URL_ENABLED` | `true` | 关闭 → ragPipeline 不回填 image_id/image_url，前端自动退回纯文本 |

回滚路径：
- halfvec 列回滚：`ALTER TABLE … ALTER COLUMN embedding TYPE vector(4096) USING embedding::vector(4096)` + 重建 vector_cosine_ops 索引。脚本 `scripts/rollback-halfvec.mjs` 提供。
- citation 回滚：env 一关、前端无副作用。

## 测试

- `apps/qa-service/src/__tests__/citationImage.test.ts`：构造一个 kind='image_caption' chunk，跑 ragPipeline.runRagPipeline，断言返回的 citation 含 `image_id` / `image_url`。
- `apps/qa-service/src/__tests__/halfvecMigration.test.ts`：在 in-memory PG（或 docker-pg）跑迁移上下行；断言 cosine score 与 fp32 误差 < 0.001。
- 端到端：`scripts/eval-recall.mjs` 在 GM-LIFTGATE32-v2 上 recall@5 ≥ 1.000，**强约束**。

## 不动范围（再次明确）

- 不动 vectorSearch.ts / hybridSearch.ts / l0Filter.ts 的算法骨架，只把 SQL 中的 `$1::vector` cast 改 `$1::halfvec`（对应一行各文件）。
- 不动 chunk 切分、不动 VLM caption 生成、不动 file_path、不动 reranker。
- 不动 OQ-VEC-QUANT-V2 / OQ-VEC-DISKANN / OQ-CAPTION-DUAL-EMBED 三个 deferral 项——它们由 Step 4 ADR-44 统一登记。
