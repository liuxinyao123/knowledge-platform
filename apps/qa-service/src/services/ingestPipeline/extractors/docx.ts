import type { Extractor, ExtractResult, ExtractedChunk } from '../types.ts'

export const docxExtractor: Extractor = {
  id: 'docx',
  async extract(buffer) {
    const mammoth = await import('mammoth')
    const { value: text, messages } = await mammoth.extractRawText({ buffer })
    const warnings = (messages ?? [])
      .filter((m) => m.type === 'warning')
      .map((m) => `mammoth: ${m.message}`)

    // 简单按双换行分段；空段过滤
    const paragraphs = text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
    const chunks: ExtractedChunk[] = paragraphs.map((p) => ({
      kind: 'paragraph',
      text: p,
    }))

    return {
      chunks,
      images: [],                       // Phase 2：从 docx zip 抽 word/media/*
      fullText: text,
      warnings,
      extractorId: 'docx',
    } as ExtractResult
  },
}
