/**
 * pdfPipeline/types.ts —— PDF Pipeline v2 公共类型
 * 契约：openspec/changes/pdf-pipeline-v2/
 */

export type Bbox = [number, number, number, number]   // [left, bottom, right, top]

export type PdfChunkKind = 'paragraph' | 'heading' | 'table' | 'image_caption'

export interface PdfChunk {
  kind: PdfChunkKind
  page: number
  text: string
  bbox?: Bbox
  /** 仅 kind='heading' */
  headingLevel?: number
  /** 仅 kind='image_caption'：指向落档文件 */
  imagePath?: string
}

export interface PdfImage {
  page: number
  /** 同一页内序号，从 1 开始 */
  index: number
  bbox?: Bbox
  fileName: string                      // 落盘前由 ODL 给出的临时名
  ext: 'png' | 'jpg' | 'jpeg'
  bytes: Buffer
}

export interface PdfPageStats {
  page: number
  textChars: number
  imageCount: number
}

/** VLM 生成的图片描述（与 images 按 page+index 对应）；VLM 关闭时 caption 全 null */
export interface PdfImageCaption {
  page: number
  index: number
  caption: string | null
  warning?: string
}

export interface PdfPipelineResult {
  chunks: PdfChunk[]
  images: PdfImage[]
  /** 图片 caption 结果；已在 extract 阶段调好，调用方不必再调 captionImages */
  captions: PdfImageCaption[]
  /** 每页统计（字符数、图片数），供调用方决策 */
  pageStats: PdfPageStats[]
  pages: number
  /** 标记本次是否最终降级到 officeparser */
  fellBackToOfficeParser: boolean
  warnings: string[]
}

export interface PdfPipelineOpts {
  /** 默认读 INGEST_VLM_ENABLED env */
  vlmEnabled?: boolean
  /** 默认读 INGEST_VLM_MODEL env，未设置回退到 'Qwen/Qwen2.5-VL-72B-Instruct' */
  vlmModel?: string
  imageHeavyMinChars?: number           // 默认 300
  imageHeavyMinImages?: number          // 默认 3
}

/** ODL 不可用（未装 / Java 缺失 / convert 抛错）时抛出的标识错误 */
export class OdlNotAvailableError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'OdlNotAvailableError'
  }
}
