import { chunkText } from '../../chunkText.ts'
import type { Extractor, ExtractResult, ExtractedChunk } from '../types.ts'

/**
 * UTF-8 原样读 → 用现有 chunkText 工具切成多个 generic chunks
 *   - 短文本（< 200 字）保持单 chunk，避免无意义切割
 *   - 长文本（如 BookStack 页面）切成 ~500 字片段，每个独立 embed
 */
export const plaintextExtractor: Extractor = {
  id: 'plaintext',
  async extract(buffer) {
    const text = buffer.toString('utf-8')
    const trimmed = text.trim()
    if (!trimmed) {
      return {
        chunks: [],
        images: [],
        fullText: text,
        warnings: [],
        extractorId: 'plaintext',
      } as ExtractResult
    }

    let chunks: ExtractedChunk[]
    if (trimmed.length < 200) {
      // 太短不切；保留原文上下文
      chunks = [{ kind: 'generic', text: trimmed }]
    } else {
      const parts = chunkText(trimmed)
      chunks = parts.length
        ? parts.map((t) => ({ kind: 'generic' as const, text: t }))
        : [{ kind: 'generic', text: trimmed }]
    }

    return {
      chunks,
      images: [],
      fullText: text,
      warnings: [],
      extractorId: 'plaintext',
    } as ExtractResult
  },
}
