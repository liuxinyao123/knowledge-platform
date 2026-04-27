/**
 * pdf extractor —— 包装 pdfPipeline v2（ODL + VLM）
 * ODL 不可用时降级 PDFParse v2 平文本，extractorId='fallback'。
 */
import {
  extractPdfStructured,
  OdlNotAvailableError,
  type PdfChunk,
  type PdfImage,
  type PdfImageCaption,
} from '../../pdfPipeline/index.ts'
import type {
  Extractor, ExtractResult, ExtractedChunk, ExtractedImage,
} from '../types.ts'

function mapChunk(c: PdfChunk): ExtractedChunk {
  return {
    kind: c.kind,
    text: c.text,
    page: c.page,
    bbox: c.bbox,
    headingLevel: c.headingLevel,
    // image_caption 需要带 page + (稍后补) index；当前 PdfChunk 只给 page，index 要靠 imagePath 反查
    // 简化：先用 page 作为 ref；pipeline 里按 page 匹配首张未配 caption 的 image
    imageRefIndex: c.kind === 'image_caption' && c.page ? { page: c.page, index: 0 } : undefined,
  }
}

function mapImage(img: PdfImage, captions: PdfImageCaption[]): ExtractedImage {
  const cap = captions.find((c) => c.page === img.page && c.index === img.index)
  return {
    page: img.page,
    index: img.index,
    bbox: img.bbox,
    ext: img.ext,
    bytes: img.bytes,
    caption: cap?.caption ?? null,
  }
}

export const pdfExtractor: Extractor = {
  id: 'pdf',
  async extract(buffer, name) {
    try {
      const r = await extractPdfStructured(buffer, name, {
        vlmEnabled: process.env.INGEST_VLM_ENABLED === 'true'
          || process.env.INGEST_VLM_ENABLED === '1',
      })
      return {
        chunks: r.chunks.map(mapChunk),
        images: r.images.map((img) => mapImage(img, r.captions)),
        fullText: r.chunks.map((c) => c.text).join('\n\n'),
        warnings: r.warnings,
        extractorId: 'pdf',
      } as ExtractResult
    } catch (e) {
      if (!(e instanceof OdlNotAvailableError)) throw e
      // 降级：PDFParse v2 平文本
      const warnings = [`pdf-pipeline-v2 fallback: ${e.message}`]
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      let text = ''
      try {
        const result = await parser.getText()
        text = result.text
      } finally {
        await parser.destroy()
      }
      return {
        chunks: text.trim()
          ? [{ kind: 'paragraph', text }]
          : [],
        images: [],
        fullText: text,
        warnings,
        extractorId: 'fallback',
      } as ExtractResult
    }
  },
}
