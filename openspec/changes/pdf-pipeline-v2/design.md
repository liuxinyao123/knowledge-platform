# Design: PDF Pipeline v2

## 数据流

```
PDF buffer (multer)
  │
  ├─ writeTempFile() ──▶ /tmp/odl-{uuid}.pdf
  │
  ▼
[Step 1] odlExtract.convertPdf(tempPath, outDir)
        │ JVM spawn (~1-2s) → markdown + json
        ▼
[Step 2] odlParse.toChunks(json) → PdfChunk[]
        │   { kind: 'paragraph' | 'heading' | 'table' | 'image',
        │     page, text?, imagePath?, bbox? }
        ▼
[Step 3] imageStore.persist(images, assetId)
        │   → infra/asset_images/{assetId}/{page}-{idx}.png
        │   → INSERT metadata_asset_image
        ▼
[Step 4 (opt-in)] vlmCaption.runForImageHeavyPages()
        │   - 仅命中阈值的页 / 图调 Qwen2.5-VL
        │   - caption 入 metadata_asset_image.caption
        │   - caption 也作为 chunk
        ▼
[Step 5] embeddings + INSERT metadata_field
```

## 文件结构

```
apps/qa-service/src/services/pdfPipeline/
  ├── index.ts          —— 入口 extractPdfStructured(buffer, name): Promise<PdfPipelineResult>
  ├── odlExtract.ts     —— @opendataloader/pdf 软依赖封装
  ├── odlParse.ts       —— ODL JSON → PdfChunk[]
  ├── vlmCaption.ts     —— Qwen2.5-VL（opt-in）
  ├── imageStore.ts     —— 文件落盘 + DB 写入
  ├── javaCheck.ts      —— 启动时 java -version 探测
  └── types.ts
```

## 类型

```ts
export interface PdfChunk {
  kind: 'paragraph' | 'heading' | 'table' | 'image_caption'
  page: number
  text: string                          // image_caption 时是 VLM 描述
  bbox?: [number, number, number, number]   // [left, bottom, right, top]
  headingLevel?: number                 // 1..6 仅 kind='heading'
  imagePath?: string                    // 仅 image_caption；指向落档文件
}

export interface PdfImage {
  page: number
  index: number                         // 同一页内序号
  bbox: [number, number, number, number]
  fileName: string                      // {page}-{index}.{ext}
  ext: 'png' | 'jpg'
  bytes: Buffer
}

export interface PdfPipelineResult {
  chunks: PdfChunk[]
  images: PdfImage[]
  pages: number
  fellBackToOfficeParser: boolean       // ODL/VLM 全程是否降级
  warnings: string[]
}

export interface PdfPipelineOpts {
  vlmEnabled?: boolean                  // 默认读 INGEST_VLM_ENABLED env
  vlmModel?: string                     // 默认读 INGEST_VLM_MODEL env
  imageHeavyMinChars?: number           // 默认 300
  imageHeavyMinImages?: number          // 默认 3
}
```

## 数据库 schema 增量

```sql
CREATE TABLE IF NOT EXISTS metadata_asset_image (
  id          SERIAL PRIMARY KEY,
  asset_id    INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
  page        INT NOT NULL,
  image_index INT NOT NULL,
  bbox        JSONB,
  file_path   TEXT NOT NULL,
  caption     TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (asset_id, page, image_index)
);
CREATE INDEX IF NOT EXISTS idx_metadata_asset_image_asset ON metadata_asset_image(asset_id);
```

## opendataloader 软依赖封装（odlExtract.ts）

```ts
// 动态名 import 绕过 TS 模块解析；未装时降级
const modName = '@opendataloader/pdf'
const odl = await import(modName)
await odl.convert([tempPath], {
  outputDir: outDir,
  format: 'json,markdown',
  imageMode: 'external',                // 图片落盘
  imageFormat: 'png',
  ocr: process.env.INGEST_OCR === 'true',
})
```

返回值是写到 `outputDir` 的文件路径列表；用 `fs.readFile` 读 JSON 解析。
失败 / 未装 → 抛 `OdlNotAvailableError`，调用方 catch 后降级。

## VLM caption（vlmCaption.ts）

复用 `chatComplete`，但需要扩展 ChatMessage 支持 image content blocks。
**做法**：在 `services/llm.ts` 把 `ChatMessage.content` 类型放宽：

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

content: string | null | ContentBlock[]
```

调用形式：
```ts
chatComplete([
  {
    role: 'user',
    content: [
      { type: 'text', text: '简要描述这张工程图的关键信息（标签 / 箭头 / 测量值）。100 字内。' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ],
  },
], { model: process.env.INGEST_VLM_MODEL ?? 'Qwen/Qwen2.5-VL-72B-Instruct', maxTokens: 200 })
```

## image-heavy 启发（D-004）

```ts
function isImageHeavyPage(page: { textChars: number; imageCount: number }): boolean {
  return page.textChars < 300 || page.imageCount >= 3
}
```

页粒度判断；命中则该页所有图都送 VLM。否则仅落盘不打描述。

## 集成点

### `routes/knowledgeDocs.ts` POST /ingest
原 PDF 分支：
```ts
if (ext === 'pdf') {
  const { PDFParse } = await import('pdf-parse')
  ...
}
```
替换为：
```ts
if (ext === 'pdf') {
  try {
    const result = await extractPdfStructured(req.file.buffer, req.file.originalname, { /*opts*/ })
    text = result.chunks.filter(c => c.kind !== 'image_caption').map(c => c.text).join('\n\n')
    // 图片 + caption 在 result.images / image_caption chunk 里
    // 在写完 metadata_asset 后，imageStore.persistImages(assetId, result.images)
  } catch (e) {
    // 降级到旧 pdf-parse 路径
  }
}
```

### `services/ingestExtract.ts` extractDocument
对 `.pdf` 路径单独切到新 pipeline；其它扩展名（.pptx/.docx/.xlsx）保留 officeparser/mammoth 路径。

## Docker

新建 `apps/qa-service/Dockerfile`：

```Dockerfile
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm fetch
COPY . .
RUN pnpm install --offline --prod=false
EXPOSE 3001
CMD ["pnpm", "dev"]
```

更新 `infra/docker-compose.yml` 的 `qa_service` `build:` 指向 `apps/qa-service`（已存在的话只确认）。

## 启动检查

`javaCheck.ts` 在 index.ts 启动时 spawn `java -version`：

```ts
const r = spawnSync('java', ['-version'], { encoding: 'utf8' })
if (r.status !== 0) {
  console.warn('WARN: java not found in PATH; PDF pipeline v2 will fall back to officeparser')
}
```

## 测试策略

- **odlParse 单测**：用固定的 ODL JSON fixture（采样自实际输出 schema），验证 chunks/images 切分
- **vlmCaption 单测**：mock chatComplete，验证 image-heavy 阈值 / 失败兜底
- **imageStore 单测**：临时目录，验证路径布局 / DB 行写入
- **integration**：mock `@opendataloader/pdf` 让 convert 写一组 fixture 文件，跑 `extractPdfStructured`
- **降级测试**：模拟 ODL 抛 OdlNotAvailableError → 验证旧路径接管

## 风险

- **ODL JSON schema 真实结构未知**：先按文档描述 + DeepWiki 推测的 schema 写 parser；首次本机集成时可能要调整字段名（用 fixture 隔离）
- **JVM 启动开销**：每文件 ~1-2s。批量 ingest 慢——下一阶段用"一次喂多个文件"或常驻 daemon 模式优化
- **Qwen2.5-VL token 成本**：每图 ~100-300 token；批量上传需要监控费用
- **磁盘膨胀**：抽出图片可能比原 PDF 大；需要后续做"按 asset 删除时级联清理 file" 的回收
