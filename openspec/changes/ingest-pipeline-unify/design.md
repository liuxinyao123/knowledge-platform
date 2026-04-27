# Design: Ingest Pipeline 统一

## 组件结构

```
apps/qa-service/src/services/ingestPipeline/
  ├── index.ts              — ingestDocument() 入口
  ├── types.ts              — ExtractResult / IngestInput / IngestOutput
  ├── router.ts             — 扩展名 → extractor 映射
  ├── pipeline.ts           — 写 DB / embed / tags / images / VLM（PDF 专用）
  └── extractors/
      ├── pdf.ts            — 包装 pdfPipeline v2（ODL + VLM）
      ├── docx.ts           — 包装 mammoth（Phase 1 只抽正文）
      ├── pptx.ts           — 包装 officeparser（Phase 1）
      ├── xlsx.ts           — 包装 officeparser（Phase 1；未来 SheetJS）
      ├── markdown.ts       — 当前走 plaintext；未来 heading-aware
      ├── plaintext.ts      — 原样切
      └── image.ts          — 单独上传 png/jpg；VLM 描述 → 1 条 chunk
```

## 类型

```ts
// types.ts
export type ChunkKind = 'heading' | 'paragraph' | 'table' | 'image_caption' | 'generic'

export interface ExtractedChunk {
  kind: ChunkKind
  text: string
  page?: number
  headingLevel?: number
  bbox?: [number, number, number, number]
  headingPath?: string          // "1.0 Purpose / 1.1 Lower Corner Fixed Bumpers"
  imageRefIndex?: { page: number; index: number }   // image_caption 对应的图
}

export interface ExtractedImage {
  page?: number
  index: number
  bbox?: [number, number, number, number]
  ext: 'png' | 'jpg' | 'jpeg'
  bytes: Buffer
  caption?: string | null       // PDF VLM 已算；其它为 null
}

export interface ExtractResult {
  chunks: ExtractedChunk[]
  images: ExtractedImage[]
  /** 仅供 tagExtract 用；由 extractor 自己决定是 chunks.join 还是原始 */
  fullText: string
  warnings: string[]
  /** extractor 自报其用到的方案，供可观测 */
  extractorId: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'markdown' | 'plaintext' | 'image' | 'fallback'
}

export interface IngestInput {
  buffer: Buffer
  name: string
  sourceId: number
  principal?: Principal         // 来自 requireAuth；调用方保证非空
  opts?: {
    skipVlm?: boolean
    skipTags?: boolean
  }
}

export interface IngestOutput {
  assetId: number
  chunks: { l1: number; l3: number }    // 简化为 headings vs 其它
  structuredChunks: number
  images: { total: number; withCaption: number }
  tags: string[]
  extractorId: ExtractResult['extractorId']
  warnings: string[]
}
```

## 数据库 schema 增量（一次 migration 全加）

```sql
ALTER TABLE metadata_field
  ADD COLUMN IF NOT EXISTS kind         VARCHAR(32),
  ADD COLUMN IF NOT EXISTS bbox         JSONB,
  ADD COLUMN IF NOT EXISTS heading_path TEXT,
  ADD COLUMN IF NOT EXISTS image_id     INT REFERENCES metadata_asset_image(id) ON DELETE SET NULL;
```

（`page` 列上一 change 已加过，幂等的 `IF NOT EXISTS` 确保重复运行无问题）

## 路由（router.ts）

```ts
const map: Record<string, Extractor> = {
  '.pdf': pdfExtractor,
  '.docx': docxExtractor,
  '.pptx': pptxExtractor,
  '.ppt': pptxExtractor,
  '.xlsx': xlsxExtractor,
  '.xls': xlsxExtractor,
  '.md': markdownExtractor,
  '.html': markdownExtractor,
  '.htm': markdownExtractor,
  '.txt': plaintextExtractor,
  '.csv': plaintextExtractor,
  '.png': imageExtractor,
  '.jpg': imageExtractor,
  '.jpeg': imageExtractor,
}
export function routeExtractor(ext: string): Extractor {
  return map[ext.toLowerCase()] ?? plaintextExtractor    // 未知类型兜底
}
```

## pipeline.ts 核心伪代码

```ts
export async function ingestDocument(input: IngestInput): Promise<IngestOutput> {
  const ext = path.extname(input.name).toLowerCase()
  const extractor = routeExtractor(ext)
  const result = await extractor.extract(input.buffer, input.name)

  const pool = getPgPool()

  // 1) metadata_asset
  const { rows: [asset] } = await pool.query(
    `INSERT INTO metadata_asset (source_id, name, type, content, updated_at)
     VALUES ($1, $2, 'document', $3, NOW()) RETURNING id`,
    [input.sourceId, input.name, result.fullText],
  )
  const assetId = Number(asset.id)

  // 2) 图片落档 + VLM caption 回写 metadata_asset_image
  const persistedByKey = await persistAndCaptionImages(pool, assetId, result.images)

  // 3) metadata_field（带 kind/bbox/heading_path/image_id）
  const rows = buildChunkRows(result.chunks, persistedByKey)
  const toEmbed = rows.filter(r => r.level === 3).map(r => r.content)
  const embeddings = toEmbed.length ? await embedTexts(toEmbed) : []
  await batchInsertFields(pool, assetId, rows, embeddings)

  // 4) tags + update indexed_at
  const tags = input.opts?.skipTags ? [] : await extractTags(result.fullText, { assetName: input.name })
  await pool.query('UPDATE metadata_asset SET indexed_at=NOW(), tags=$2 WHERE id=$1', [assetId, tags])

  return {
    assetId,
    chunks: countByLevel(rows),
    structuredChunks: result.chunks.length,
    images: { total: persistedByKey.size, withCaption: [...persistedByKey.values()].filter(v=>v.caption).length },
    tags,
    extractorId: result.extractorId,
    warnings: result.warnings,
  }
}
```

## extractors 统一契约

```ts
export interface Extractor {
  extract(buffer: Buffer, name: string): Promise<ExtractResult>
}
```

### pdf.ts

包装现有 `extractPdfStructured`；映射：
- `PdfChunk{kind:'heading',...}` → `ExtractedChunk{kind:'heading', headingLevel}`
- `PdfChunk{kind:'paragraph',...}` → `kind:'paragraph'`
- `PdfChunk{kind:'table',...}` → `kind:'table'`
- `PdfChunk{kind:'image_caption',...}` → `kind:'image_caption'`
- `PdfImage[]` + `PdfImageCaption[]` → `ExtractedImage[]`（caption 已附上）
- `warnings` 透传

失败降级：抛 `OdlNotAvailableError` 时由 pdf 内部退化成"纯文本 + 0 图"，但 extractorId='fallback'，调用方据此打点。

### docx.ts（Phase 1）

```ts
const { value: text } = await mammoth.extractRawText({ buffer })
return {
  chunks: splitByParagraph(text).map(t => ({ kind:'paragraph', text:t })),
  images: [], fullText: text, warnings: [], extractorId: 'docx',
}
```

### pptx / xlsx / markdown / plaintext

Phase 1 全部：走 officeparser/原样读 → 作为 generic chunks（chunkDocument 三级或简单切）。
保持与旧行为一致。

### image.ts

单张上传直接送 VLM（仅当 INGEST_VLM_ENABLED）；得 caption 作为唯一 chunk；ExtractedImage 包含原图。

## 路由层改造

### `POST /api/knowledge/ingest`
```ts
knowledgeDocsRouter.post('/ingest',
  requireAuth(),
  enforceAcl({ action:'WRITE', resourceExtractor: req => ({ source_id: Number(req.body.source_id ?? 1) }) }),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error:'file required' })
    const out = await ingestDocument({
      buffer: req.file.buffer,
      name: req.file.originalname,
      sourceId: Number(req.body.source_id ?? 1),
      principal: req.principal,
    })
    res.json(out)
  },
)
```

### `POST /api/ingest/scan-folder`
循环里把 `extractDocument + 手写 PG insert` 换成 `ingestDocument`；SSE 事件形状不变。

### BookStack sync（indexBookstackPage.ts）
把拉到的 HTML/PDF 内容喂 `ingestDocument`，不再自己写 DB。

## 测试策略

- `ingestPipeline.pipeline.test.ts` —— mock extractor / pool / embedTexts / extractTags，验证：
  - INSERT metadata_asset 参数
  - INSERT metadata_field 带 kind/bbox/heading_path
  - tags / update indexed_at 调用
  - 返 IngestOutput 形状
- `ingestPipeline.router.test.ts` —— .pdf/.docx/.xlsx/.md/.png/未知扩展 各自路由正确
- `ingestPipeline.extractors.pdf.test.ts` —— 映射 PdfChunk → ExtractedChunk 正确
- `ingestPipeline.extractors.plaintext.test.ts` —— 基础切片
- 集成：`routes/knowledgeDocs.ts /ingest` 调用 ingestDocument（supertest + mock ingestDocument）

## 降级与兼容

- PDF 降级：pdfExtractor 内部 catch OdlNotAvailableError → 退到 PDFParse v2 平文本 + extractorId='fallback'
- 未知扩展：用 plaintextExtractor 兜底；warnings 标注
- 老调用方应继续工作：响应体字段向后兼容（`chunks.l1/l2/l3` 保留；l2 新路径恒为 0）

## 风险

- 重构 touches 面广（route、sync、tests）；先 PDF 路径验证 OK 再迁 scan-folder、sync
- `metadata_field` 加列需要 PG ALTER，线上大表时耗时；本项目 PG 体量小，可忽略
- BookStack sync 链路复杂，如果改造超过预期，本 change 把它留作 TODO（不回归即可）
