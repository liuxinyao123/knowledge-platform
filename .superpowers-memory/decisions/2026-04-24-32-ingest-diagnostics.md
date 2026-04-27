# ADR-32 · 2026-04-24 · 提取诊断可见性

> 工作流：C（superpowers-feature · 可观测性补齐）
> 触发：用户上传 xlsx 后看到「切片 2」，但 UI 完全看不出 ① 走的是哪个 extractor ② 产出多少 heading / paragraph / image_caption ③ 有没有 warning。只能靠 tail log 猜。前面 3 轮反复迭代都是被这个可观测性盲区拖住。
> 影响文件：
>   - `apps/qa-service/src/services/pgDb.ts`（3 个新列）
>   - `apps/qa-service/src/services/ingestPipeline/pipeline.ts`（runPipeline 写入诊断字段）
>   - `apps/qa-service/src/routes/assetDirectory.ts`（pg-assets/:id/detail 返回诊断字段）
>   - `apps/web/src/api/assetDirectory.ts`（PgAssetDetail 类型扩展）
>   - `apps/web/src/knowledge/Assets/Detail.tsx`（Banner 诊断区块）

## 背景

之前 ingest 完成后唯一可见信号：`切片 N · 图 M` 聚合数 + tags。完全没办法回答"为啥只有 2 chunks 是 heading 没有 paragraph？"这种问题。只能靠：
- `tail .dev-logs/qa-service.log` 找 `ingest_done` JSON
- 或 SQL 直接 `SELECT kind, count(*) FROM metadata_field WHERE asset_id=X GROUP BY kind`

两个都是开发者视角，不适合用户自助诊断。用户反馈环路因此被拖到 4 轮才定位到真因。

## 决策

### D-001 · `metadata_asset` 扩 3 列

```sql
ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS extractor_id          VARCHAR(32);
ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_warnings       TEXT;     -- JSON array string
ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_chunks_by_kind JSONB;
```

字段语义：
- `extractor_id` —— `xlsx` / `pdf` / `docx` / `plaintext` / `image` / `pptx` / `markdown` / `fallback`。一眼能看出有没有走对 extractor
- `ingest_warnings` —— warnings[] 序列化；若为空数组则 NULL
- `ingest_chunks_by_kind` —— `{ heading: n, paragraph: n, image_caption: n, ... }`。用户最关心的"到底有几条 paragraph"

为什么不直接 `COUNT(metadata_field.kind) GROUP BY kind`：
- 每次 detail 页渲染都要额外一次 COUNT 聚合查询，多余
- 写入时一次算好存快照语义更清晰（ingest 当时的结构，不受后续治理操作影响）

### D-002 · `runPipeline` 写入诊断字段

原来只 `UPDATE ... SET indexed_at, tags`；现在：

```ts
const chunksByKind: Record<string, number> = {}
for (const c of result.chunks) {
  chunksByKind[c.kind] = (chunksByKind[c.kind] ?? 0) + 1
}
const warningsJson = result.warnings.length ? JSON.stringify(result.warnings) : null

await pool.query(
  `UPDATE metadata_asset
     SET indexed_at = NOW(), tags = $2,
         extractor_id = $3, ingest_warnings = $4, ingest_chunks_by_kind = $5
   WHERE id = $1`,
  [assetId, tags, result.extractorId, warningsJson, JSON.stringify(chunksByKind)],
)
```

### D-003 · 前端 Banner 两层展示

1. **一行摘要行**（诊断条）
   - `提取器：xlsx`（monospace）
   - `切片分类：heading 2 · paragraph 3`（一眼看出 paragraph 是否出来了）
   - `bookstack:attachment:42`（如果是 BookStack 附件来的）
   - `⚠ 2 条警告（悬停查看）`

2. **`<details>` 折叠区**
   - 列所有 warnings，monospace 字符串

条件渲染：只有任一诊断字段非空时才显示整个区块。老 asset（没有 extractor_id）完全不打扰。

### D-004 · 不做的事

- **extractor 历史**：每次 re-ingest 会覆盖快照（`UPDATE` 而非 `INSERT` 历史表）。审计链有 `audit_log::ingest_done` 可查过去的变化
- **warning 级别**：warnings 字符串平铺，不拆 `WARN` / `ERROR` / `INFO`。复杂度暂不值得
- **前端按 extractor_id 筛选列表**：没做。真用到再加列表页过滤器
- **图形化 chunk 分类**（柱状图等）：Banner 文字已经足够

## 验证闸门

| 闸门 | 结果 |
|---|---|
| qa-service `tsc --noEmit` | ✅ 本 change 0 新错（已存 pre-existing 错误在 actions/ ontologyContext / actionEngine / ragPipeline，和本 change 无关） |
| web `tsc --noEmit` | ✅ EXIT=0 |
| 单测 | ⏸ 不写（UI 诊断条靠视觉验收 + SQL 查 DB 验） |

## 用户本机验证步骤

1. **重启 qa-service**：`pnpm dev:restart` —— schema 迁移会跑（新加 3 列）
2. **重新上传** xlsx（或对现有老 asset 触发 reindex）
3. **进资产详情页**，Banner 底下应该多一行：
   ```
   提取器：xlsx · 切片分类：heading 2 · paragraph 3
   ```
4. **如果是老 xlsx（没走 xlsx extractor）**：诊断条会显示 `提取器：plaintext`，立刻知道路由错了
5. **如果看到 warning 折叠区**：点开看具体 warning 内容

## 下一次再遇上类似问题

1. 直接进 detail 页看诊断条
2. 看 `extractor_id` 是否符合预期
3. 看 `ingest_chunks_by_kind` 是否产出了 paragraph
4. 看 `ingest_warnings` 里有没有 `'yielded no chunks'` / `'AST empty'` / `'officeparser failed'` 等线索
5. 30 秒内定位，不用 tail log

## 相关

- 上游：ADR-28（xlsx ingest）、ADR-29（tests drift）、ADR-31（BookStack 附件）
- 历史经验：`MEMORY.md::工作流心得` 补一条："用户可观测性缺失会把反馈环拖长好几轮 —— 可观测优先于对抗性调试"
