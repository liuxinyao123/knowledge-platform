import path from 'node:path'
import type { Extractor } from './types.ts'
import { pdfExtractor } from './extractors/pdf.ts'
import { docxExtractor } from './extractors/docx.ts'
import { pptxExtractor, xlsxExtractor } from './extractors/officeFamily.ts'
import { markdownExtractor } from './extractors/markdown.ts'
import { plaintextExtractor } from './extractors/plaintext.ts'
import { imageExtractor } from './extractors/image.ts'

const TABLE: Record<string, Extractor> = {
  '.pdf': pdfExtractor,
  '.docx': docxExtractor,
  '.pptx': pptxExtractor,
  '.ppt': pptxExtractor,
  '.xlsx': xlsxExtractor,
  '.xls': xlsxExtractor,
  '.md': markdownExtractor,
  '.markdown': markdownExtractor,
  '.html': markdownExtractor,
  '.htm': markdownExtractor,
  '.txt': plaintextExtractor,
  '.csv': plaintextExtractor,
  '.png': imageExtractor,
  '.jpg': imageExtractor,
  '.jpeg': imageExtractor,
}

export function routeExtractor(name: string): Extractor {
  const ext = path.extname(name).toLowerCase()
  return TABLE[ext] ?? plaintextExtractor
}

export function isKnownExt(name: string): boolean {
  return path.extname(name).toLowerCase() in TABLE
}
