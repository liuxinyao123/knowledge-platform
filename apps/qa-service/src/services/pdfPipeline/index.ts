/**
 * pdfPipeline/index.ts —— PDF Pipeline v2 入口
 *
 * 调用方典型用法（见 routes/knowledgeDocs.ts）：
 *   try {
 *     const r = await extractPdfStructured(buffer, name)
 *     // r.chunks → 入 metadata_field
 *     // r.images → 调 persistImages(pool, assetId, r.images) 落档
 *     // r.warnings → 日志/告警
 *   } catch (e) {
 *     if (e instanceof OdlNotAvailableError) {
 *       // 走 PDFParse v2 / officeparser 旧路径
 *     } else throw e
 *   }
 */
import { odlConvert } from './odlExtract.ts'
import { parseOdlJson } from './odlParse.ts'
import { captionImages } from './vlmCaption.ts'
import {
  OdlNotAvailableError,
  type PdfChunk,
  type PdfPipelineOpts,
  type PdfPipelineResult,
} from './types.ts'

export { OdlNotAvailableError } from './types.ts'
export type {
  PdfChunk, PdfImage, PdfImageCaption, PdfPipelineResult, PdfPipelineOpts, Bbox,
} from './types.ts'
export { persistImages, updateImageCaption } from './imageStore.ts'
export { captionImages, isImageHeavyPage } from './vlmCaption.ts'
export { parseOdlJson } from './odlParse.ts'

/**
 * 主入口：把 PDF buffer 转成结构化 chunks + 图片元数据 + （可选）VLM caption chunk。
 */
export async function extractPdfStructured(
  buffer: Buffer,
  originalName: string,
  opts: PdfPipelineOpts = {},
): Promise<PdfPipelineResult> {
  const warnings: string[] = []
  let convert
  try {
    convert = await odlConvert(buffer, originalName)
  } catch (e) {
    if (e instanceof OdlNotAvailableError) throw e
    throw new OdlNotAvailableError(
      `odl unavailable: ${e instanceof Error ? e.message : 'unknown'}`,
    )
  }

  try {
    const parsed = await parseOdlJson({
      json: convert.jsonContent,
      imageFiles: convert.imageFiles,
    })

    // 调 VLM（opt-in）—— 一次调用，返结果供路由层写 DB 和生成 caption chunk
    const captions = await captionImages({
      images: parsed.images,
      pageStats: parsed.pageStats,
      opts,
    })
    captions.forEach((c) => { if (c.warning) warnings.push(c.warning) })

    const captionChunks: PdfChunk[] = captions
      .filter((c) => c.caption)
      .map((c) => {
        const img = parsed.images.find((i) => i.page === c.page && i.index === c.index)
        return {
          kind: 'image_caption' as const,
          page: c.page,
          text: c.caption!,
          imagePath: img?.fileName,
        }
      })

    return {
      chunks: [...parsed.chunks, ...captionChunks],
      images: parsed.images,
      captions,
      pageStats: parsed.pageStats,
      pages: parsed.pages,
      fellBackToOfficeParser: false,
      warnings,
    }
  } finally {
    await convert.cleanup()
  }
}

/**
 * 给调用方用：把 captionImages 的输出按 (page, index) 索引化，便于按持久化后的 imageId 写 caption。
 */
export interface CaptionLookup {
  byPageIndex: Map<string, string>      // key=`${page}|${index}` → caption
}
export function indexCaptions(captions: { page: number; index: number; caption: string | null }[]): CaptionLookup {
  const m = new Map<string, string>()
  for (const c of captions) {
    if (c.caption) m.set(`${c.page}|${c.index}`, c.caption)
  }
  return { byPageIndex: m }
}
