/**
 * ingestPipeline/types.ts —— 统一 ingest 中间产物 + 入参 / 出参契约
 * 契约：openspec/changes/ingest-pipeline-unify/
 */
import type { Principal } from '../../auth/types.ts'

export type ChunkKind =
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'image_caption'
  | 'generic'

export type Bbox = [number, number, number, number]

export interface ExtractedChunk {
  kind: ChunkKind
  text: string
  page?: number
  headingLevel?: number
  bbox?: Bbox
  headingPath?: string                  // "1.0 / 1.1"
  imageRefIndex?: { page: number; index: number }   // image_caption 对应的图
}

export interface ExtractedImage {
  page?: number
  index: number                         // 在 page 内的序号；page=undefined 时全局序号
  bbox?: Bbox
  ext: 'png' | 'jpg' | 'jpeg'
  bytes: Buffer
  /** 仅 PDF：pdfPipeline 内部已算好；其它类型为 null */
  caption?: string | null
}

export type ExtractorId =
  | 'pdf' | 'docx' | 'pptx' | 'xlsx'
  | 'markdown' | 'plaintext' | 'image'
  | 'fallback'

export interface ExtractResult {
  chunks: ExtractedChunk[]
  images: ExtractedImage[]
  fullText: string                      // 给 tagExtract 用
  warnings: string[]
  extractorId: ExtractorId
}

export interface Extractor {
  id: ExtractorId
  extract(buffer: Buffer, name: string): Promise<ExtractResult>
}

export interface IngestInput {
  buffer: Buffer
  name: string
  sourceId: number
  /** 由调用方在 requireAuth 之后传入；用于审计/日志，不做权限二次判定（已在 enforceAcl 拦） */
  principal?: Principal
  opts?: {
    skipVlm?: boolean
    skipTags?: boolean
    /** file-source 链路：外部 adapter 稳定 id（SMB 绝对路径 / S3 key 等） */
    externalId?: string
    /** file-source 链路：相对 source root 的路径，用于 UI 面包屑 */
    externalPath?: string
    /** file-source 链路：源头文件 mtime */
    mtime?: Date
    /** file-source 链路：metadata_file_source.id；有此字段 + externalId → UPSERT */
    fileSourceId?: number
  }
}

export interface IngestOutput {
  assetId: number
  /** 兼容旧客户端 —— PDF 路径下 l2 恒为 0，l1=heading 数，l3=其它可 embed 的数 */
  chunks: { l1: number; l2: number; l3: number }
  structuredChunks: number
  images: { total: number; withCaption: number }
  tags: string[]
  extractorId: ExtractorId
  warnings?: string[]
}
