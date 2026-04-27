# Spec: asset-vector-coloc

## 修改文件

| 文件 | 变更 |
|------|------|
| `apps/qa-service/src/services/pgDb.ts` | `runPgMigrations()` 新增 halfvec 迁移段（幂等：若列已是 halfvec 跳过）；新增 `idx_field_embedding` / `idx_chunk_abstract_l0_embedding` 重建段 |
| `apps/qa-service/src/services/vectorSearch.ts` | SQL `embedding <=> $1::vector` → `embedding <=> $1::halfvec`（一行） |
| `apps/qa-service/src/services/hybridSearch.ts` | 同上 cast 升级 |
| `apps/qa-service/src/services/l0Filter.ts` | 同上 cast 升级（l0_embedding 算子也升） |
| `apps/qa-service/src/services/knowledgeSearch.ts` | retrieval SQL `SELECT` 列表新增 `kind`, `image_id`（拼 citation 用） |
| `apps/qa-service/src/services/ragPipeline.ts` | citation 拼装新增 image_id/image_url 回填段（约 8 行） |
| `apps/qa-service/src/ragTypes.ts` | `Citation` 接口新增 `image_id?: number` 与 `image_url?: string` |
| `apps/web/src/...` 相关 Citation 渲染组件 | 渲染 64×64 缩略图（具体路径 Step 3 grep 确认；候选：`MarkdownView.tsx` / `knowledge/Insights/Cards/*.tsx` / `notebook` 任一渲染 citation 卡的位置） |

## 新增文件

| 文件 | 作用 |
|------|------|
| `apps/qa-service/src/__tests__/citationImage.test.ts` | 单测：image_caption chunk → citation 含 image_id/image_url |
| `apps/qa-service/src/__tests__/halfvecMigration.test.ts` | 单测：迁移幂等 + cosine 与 fp32 误差 < 0.001 |
| `scripts/rollback-halfvec.mjs` | 回滚脚本：halfvec → vector(4096)，含索引重建 |

## 接口契约

### `Citation`（TypeScript）

```ts
{
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  image_id?: number       // 新增；仅当来源 chunk kind='image_caption' 时存在
  image_url?: string      // 新增；后端拼装；格式 `/api/assets/images/${image_id}`
}
```

**反序列化兼容**：v1.x 客户端见到未知字段忽略；后端在 image 字段不可用时不回填，返回 v1.x 形态。

### 数据库列类型

```sql
metadata_field.embedding        halfvec(4096)   -- 原 vector(4096)
chunk_abstract.l0_embedding     halfvec(4096)   -- 原 vector(4096)
```

**索引算子类**：`halfvec_cosine_ops`（替换原 `vector_cosine_ops`）。lists=100 不变。

### env 开关

| 名称 | 默认 | 行为 |
|---|---|---|
| `PGVECTOR_HALF_PRECISION` | `false`（**ADR-44 锁定**） | 默认不跑 halfvec 迁移；显式 `true` 才迁。改默认理由：实测 halfvec 在 4096-d corpus 上让 GM-LIFTGATE32 recall@5 从 1.000 跌到 0.865（5 题漏召回），fp16 精度损失把 borderline 分数压到 MIN_SCORE 线下面 |
| `CITATION_IMAGE_URL_ENABLED` | `true` | `false` 时 ragPipeline 不回填 image_id/image_url |

### 静态资源路由（已存在，不新增）

`GET /api/assets/images/:imageId` — 由 `assetDirectory.ts` 提供，本 change 不动。

## 不变范围

- BookStack 代理 `/api/bookstack/*`、MySQL 治理表（knowledge_user_roles 等）。
- mcp-service 8 个工具的协议（不消费 RagTrace.citations 的 image 字段）。
- chunk 切分逻辑、VLM caption 生成、file_path 命名、reranker 阈值、L0 filter 三返回值契约。
- OQ-VEC-QUANT-V2 / OQ-VEC-DISKANN / OQ-CAPTION-DUAL-EMBED 三个 deferral 项继续在 `open-questions.md` 中等触发，本 change 不实现。

## 验证准入

进入 Archive 必须：

- [ ] `pnpm -r exec tsc --noEmit` 双 0
- [ ] `pnpm -r test` 全绿（含两条新测）
- [ ] `node --experimental-strip-types scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 ≥ 1.000
- [ ] 端到端体感：在前端跑一道 PDF 含图问答，确认 citation 区出现缩略图
- [ ] 运行 `scripts/rollback-halfvec.mjs --dry-run` 验证回滚 SQL 可执行
