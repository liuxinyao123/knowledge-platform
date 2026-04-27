# Design: Ingest L0/L1 Abstract + RAG L0 Coarse Filter

> 配套 `proposal.md` 与外部 `docs/superpowers/specs/ingest-l0-abstract/design.md`。
> 本文件只保留团队 review 必看的"行为契约 + 兼容性"，详细架构图与决策推导见外部 design.md。

## 数据结构

```sql
CREATE TABLE IF NOT EXISTS chunk_abstract (
  id            SERIAL PRIMARY KEY,
  chunk_id      INT NOT NULL REFERENCES metadata_field(id) ON DELETE CASCADE,
  asset_id      INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
  l0_text       TEXT NOT NULL,
  l0_embedding  vector(4096),
  l1_text       TEXT,
  generator_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  generated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_chunk_abstract_asset
  ON chunk_abstract(asset_id);

CREATE INDEX IF NOT EXISTS idx_chunk_abstract_l0_embedding
  ON chunk_abstract USING ivfflat (l0_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE VIEW asset_abstract AS
  SELECT ca.asset_id,
         string_agg(ca.l0_text, ' / ' ORDER BY ca.id) AS l0_summary,
         count(*) AS l0_chunk_count,
         max(ca.generated_at) AS latest_generated_at
  FROM chunk_abstract ca
  GROUP BY ca.asset_id;
```

vector(N) 的 N 与现有 `metadata_field.embedding` 同维度（环境配置决定，4096 是默认）。

## ingestPipeline 流程

phase 顺序：`parse(10) → chunk(60) → tag(75) → embed(95) → abstract(98) → done(100)`。

`generateAbstractsForAsset(assetId)`：
1. `SELECT id, content FROM metadata_field WHERE asset_id=$1 AND chunk_level=3 AND id NOT IN (SELECT chunk_id FROM chunk_abstract WHERE asset_id=$1)`；
2. `content.length < L0_GENERATE_MIN_CHARS` 跳过 → `skipped++`；
3. 按 `L0_GENERATE_CONCURRENCY` 并发跑 `runOneAbstract(chunk)`：
   - prompt = system 锁 JSON 格式 + user `{chunk}`；
   - 调 `chatComplete(getLlmFastModel())` 拿 `{l0, l1}`；
   - 解析失败 / l0 长度违规 / l1 长度违规 → `failed++`；
   - 解析成功 → `embedTexts([l0])` → `INSERT chunk_abstract`；
4. emit 一次结构化日志 `abstract_done` 含 `{generated, failed, skipped, duration_ms}`。

## ragPipeline L0 粗筛

`coarseFilterByL0(question, opts)`：

```ts
async function coarseFilterByL0(
  question: string,
  emit: EmitFn,
  opts: { topAssets?: number; spaceId?: number; sourceIds?: number[] }
): Promise<number[] | undefined>
```

返回值契约：

| 值 | 含义 | 调用方动作 |
|---|---|---|
| `undefined` | flag 关、表空、生成失败、catch 异常 | 走原路径不 emit |
| `[]` | 检索完整跑完 0 命中 | emit warn（不退化全库扫描），走原路径 |
| `[id1, id2, ...]` | 命中 N 个 asset | 注入 `retrieveInitial({assetIds:[...]})`，emit `🧰 L0 粗筛：N 个候选 asset` |

实现：
- `embedTexts([question])` → 拿 question vector；
- `SELECT DISTINCT asset_id FROM chunk_abstract ORDER BY l0_embedding <=> $1 LIMIT $2`；
- `LIMIT = L0_FILTER_TOP_ASSETS`；
- 加 spaceId / sourceIds 下推过滤（同 retrieveInitial 行为）。

## lazy 回填

`enqueueAbstractBackfill(chunkIds: number[])`：
1. `INSERT INTO ingest_job (kind, status, payload) VALUES ('abstract', 'queued', $1)`；
2. payload JSON `{chunk_ids: [...]}`；
3. ingestWorker.runIngestJob 看到 `kind='abstract'` → 调 `generateAbstractsForChunks(payload.chunk_ids)`；
4. 完成后 `status='indexed'`（复用现有词汇，不新增 status）。

`L0_LAZY_BACKFILL_ENABLED=false` 默认；ragPipeline 不调用 enqueue。

## active 回填

`scripts/backfill-l0.mjs`（Node 22 ESM，无新 npm 依赖）：

```
node scripts/backfill-l0.mjs \
  [--dry-run] [--limit N] [--resume-from CHUNK_ID] \
  [--concurrency N] [--rate-per-min N]
```

- 默认 `--dry-run` 不写库；
- 进度落 `.backfill-l0.cursor`，崩溃同命令再跑自动续；
- 限流：硬上限 `--rate-per-min` 默认 60；
- 直引 `apps/qa-service/src/services/ingestPipeline/abstract.ts:generateAbstractsForChunks`，逻辑零分叉。

## 兼容性

- 老客户端：本 change 不引入新 SSE 事件类型（`rag_step` 复用），前端不改也能跑；trace 新字段 `l0_filter_used` / `l0_candidate_count` 可选；
- 新装机：`pnpm dev:up` 自动建 chunk_abstract 表 + 索引；
- 升级机：`CREATE TABLE IF NOT EXISTS` 幂等；
- 老 chunk：没有 chunk_abstract → coarseFilterByL0 看到候选不足或 0 命中时降级到原路径；
- 回滚：三个 flag 全关 + 表保留即可，无副作用。

## 兼容老 ADR

- ADR-22（rag-relevance-hygiene）：本 change 不动其七层兜底，只在 retrieveInitial 之前插一层；short-circuit 阈值 `RAG_NO_LLM_THRESHOLD=0.05` 不变；
- ADR-40（ingest-async-pipeline）：复用 ingest_job 表 + worker，新增 `kind='abstract'` 不破坏 ADR-40 已有 kind 词汇；progress phase 'abstract' 加在 `embed` 之后；
- ADR-27（KG sidecar）：和 KG 完全解耦，KG 写 `CITED` 边的逻辑在 generateAnswer 之后，与本 change 无交集；
- ADR-31（OpenViking sidecar）：保留作为对照实验存档，flag 默认 off 不影响本 change。

## 性能预算

- ingest 时间增加：单 chunk LLM 调用 ~1s，并发 4 → 一份 100 chunk 的 PDF 多 ~25s；可接受（本来就是异步任务）；
- 表大小：单条 chunk_abstract ≈ 200 中文字 + 4096-dim float vector ≈ 16KB；100k chunk ≈ 1.6 GB；用 IVFFLAT 索引；
- L0 检索成本：50 行 distinct asset_id ANN 查询，pgvector 上 < 50ms；
- token 节省：rerank+grade 候选从 chunk top 20 缩到 candidate asset top N 内的 chunk top 10，理论 token -50%~-70%；以 eval 实测为准。
