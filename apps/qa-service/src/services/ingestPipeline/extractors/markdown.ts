import type { Extractor, ExtractResult, ExtractedChunk } from '../types.ts'

/**
 * Phase 1：按 #/##/... heading 拆分；段落简单按双换行拆。
 * heading 行 → kind='heading' 带 headingLevel；其它 → kind='paragraph'。
 * 不渲染 markdown，原样保留 inline 标记（`* / [link] / ` 等）。
 */
export const markdownExtractor: Extractor = {
  id: 'markdown',
  async extract(buffer) {
    const text = buffer.toString('utf-8')
    const lines = text.split('\n')

    const chunks: ExtractedChunk[] = []
    let buf: string[] = []
    let headingPath: string[] = []

    const flush = () => {
      const para = buf.join('\n').trim()
      if (para) {
        chunks.push({
          kind: 'paragraph',
          text: para,
          headingPath: headingPath.length ? headingPath.join(' / ') : undefined,
        })
      }
      buf = []
    }

    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (m) {
        flush()
        const level = m[1].length
        const title = m[2].trim()
        headingPath = headingPath.slice(0, level - 1)
        headingPath[level - 1] = title
        chunks.push({
          kind: 'heading',
          text: title,
          headingLevel: level,
          headingPath: headingPath.join(' / '),
        })
      } else {
        buf.push(line)
      }
    }
    flush()

    return {
      chunks,
      images: [],
      fullText: text,
      warnings: [],
      extractorId: 'markdown',
    } as ExtractResult
  },
}
