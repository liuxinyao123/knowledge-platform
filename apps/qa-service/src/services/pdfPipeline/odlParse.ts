/**
 * pdfPipeline/odlParse.ts —— 把 opendataloader-pdf 的 JSON 解析成 PdfChunk[] / PdfImage[]
 *
 * 真实 ODL JSON schema（2026-04 @opendataloader/pdf 1.11.x 实测）：
 *
 *   {
 *     "file name": "...pdf",
 *     "number of pages": 23,
 *     "kids": [
 *       {
 *         "type": "heading" | "paragraph" | "image" | "list" | "list item" | "table",
 *         "page number": 1,                    ← 注意：字段名含空格
 *         "bounding box": [x0, y0, x1, y1],    ← 同上
 *         "content": "文本内容",               ← 非 'text'
 *         "source": "images/imageFile1.png",   ← 仅 image
 *         "heading level": 2,                  ← 仅 heading，非 'level'
 *         "level": "Subtitle" | "1" | ...,     ← heading 语义 / list 嵌套深度，不用
 *         "list items": [...],                 ← 仅 list
 *         "kids": [...],                       ← list item 内部可嵌套 list
 *         "id": 207
 *       }
 *     ]
 *   }
 *
 * 解析规则：
 *   - 全文 flat 遍历 kids；list/list item 递归展开成 paragraph（保留缩进前缀）
 *   - image 元素 → PdfImage（source 取 basename 匹配 imageFiles）
 *   - 页眉页脚启发式过滤：以 "GM Confidential" / "Copyright" 开头；纯数字
 *   - heading 的 `heading level` 优先；不在则退到 1
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Bbox, PdfChunk, PdfImage, PdfPageStats } from './types.ts'

// ── 真实 ODL 元素结构（字段名含空格）──────────────────────────────────────────

interface OdlElement {
  type?: string
  id?: number
  content?: string
  source?: string
  'page number'?: number
  'bounding box'?: number[]
  'heading level'?: number
  level?: string | number | null
  'list items'?: OdlElement[]
  kids?: OdlElement[]
  // table 相关字段预留；2026-04 观察到是 list+list_item 居多，table 真实字段稍后验证
  cells?: unknown[][]
  rows?: unknown[][]
}

interface OdlRoot {
  'file name'?: string
  'number of pages'?: number
  kids?: OdlElement[]
}

// ── 页眉页脚过滤（更贴近真实文档）────────────────────────────────────────────

const HEADER_FOOTER_PREFIXES = [
  /^GM Confidential\b/i,
  /^Confidential\b/i,
  /^Copyright\b/i,
  /^©/,
]

function isHeaderFooter(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^\d{1,4}$/.test(t)) return true                         // 纯数字（页码）
  if (/^Page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return true
  if (HEADER_FOOTER_PREFIXES.some((re) => re.test(t))) return true
  return false
}

function toBbox(b: number[] | undefined): Bbox | undefined {
  if (!Array.isArray(b) || b.length < 4) return undefined
  return [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])]
}

function tableToMarkdown(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  // 容错：每行需是数组；若不是（ODL 可能给 row 对象 {cells:[...]}），尝试展开 cells
  const normRows: string[][] = []
  const stringify = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'object') {
      const o = v as { content?: unknown; text?: unknown }
      if (typeof o.content === 'string') return o.content.trim()
      if (typeof o.text === 'string') return o.text.trim()
      return ''
    }
    return String(v).replace(/\|/g, '\\|').trim()
  }
  for (const row of rows) {
    if (Array.isArray(row)) {
      normRows.push(row.map(stringify))
    } else if (row && typeof row === 'object') {
      const cells = (row as { cells?: unknown; kids?: unknown }).cells
        ?? (row as { kids?: unknown }).kids
      if (Array.isArray(cells)) normRows.push(cells.map(stringify))
    }
  }
  if (normRows.length === 0) return ''
  const head = normRows[0]
  const sep = head.map(() => '---')
  const body = normRows.slice(1)
  return [
    `| ${head.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

/** 从 table 元素的 kids/list-items 抽出所有可用文本作为 fallback paragraph */
function tableTextFallback(el: { kids?: unknown; 'list items'?: unknown; content?: unknown }): string[] {
  const out: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const o = node as { content?: unknown; kids?: unknown[]; 'list items'?: unknown[] }
    if (typeof o.content === 'string' && o.content.trim()) out.push(o.content.trim())
    if (Array.isArray(o.kids)) o.kids.forEach(visit)
    const li = (o as { 'list items'?: unknown[] })['list items']
    if (Array.isArray(li)) li.forEach(visit)
  }
  visit(el)
  return out
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

export interface ParseInput {
  json: unknown
  imageFiles: Array<{ fileName: string; absPath: string; ext: 'png' | 'jpg' | 'jpeg' }>
}

export interface ParseOutput {
  chunks: PdfChunk[]
  images: PdfImage[]
  pageStats: PdfPageStats[]
  pages: number
}

export async function parseOdlJson(input: ParseInput): Promise<ParseOutput> {
  const { json, imageFiles } = input
  const root = (json ?? {}) as OdlRoot

  const chunks: PdfChunk[] = []
  const images: PdfImage[] = []
  const pageStatsMap = new Map<number, { textChars: number; imageCount: number }>()
  const pageImageIdx = new Map<number, number>()

  // 按 basename 索引图片文件
  const fileByName = new Map<string, { absPath: string; ext: 'png' | 'jpg' | 'jpeg' }>()
  for (const f of imageFiles) fileByName.set(f.fileName, { absPath: f.absPath, ext: f.ext })

  const statsFor = (page: number) => {
    let s = pageStatsMap.get(page)
    if (!s) {
      s = { textChars: 0, imageCount: 0 }
      pageStatsMap.set(page, s)
    }
    return s
  }

  async function walkElement(el: OdlElement, indent = 0): Promise<void> {
    const type = (el.type ?? '').toLowerCase()
    const page = Number(el['page number'] ?? 0) || 1
    const bbox = toBbox(el['bounding box'])
    const content = typeof el.content === 'string' ? el.content.trim() : ''

    if (type === 'heading' || type === 'title') {
      if (!content || isHeaderFooter(content)) return
      chunks.push({
        kind: 'heading',
        page,
        text: content,
        bbox,
        headingLevel:
          typeof el['heading level'] === 'number' ? el['heading level'] : 1,
      })
      statsFor(page).textChars += content.length
    } else if (type === 'paragraph' || type === 'text') {
      if (!content || isHeaderFooter(content)) return
      chunks.push({ kind: 'paragraph', page, text: content, bbox })
      statsFor(page).textChars += content.length
    } else if (type === 'list item' || type === 'list_item' || type === 'listitem') {
      if (content && !isHeaderFooter(content)) {
        const prefix = '  '.repeat(indent)
        const text = `${prefix}- ${content}`
        chunks.push({ kind: 'paragraph', page, text, bbox })
        statsFor(page).textChars += content.length
      }
      // 递归进入 kids（可能嵌套 list）
      if (Array.isArray(el.kids)) {
        for (const child of el.kids) await walkElement(child, indent + 1)
      }
    } else if (type === 'list') {
      if (Array.isArray(el['list items'])) {
        for (const item of el['list items']) await walkElement(item, indent)
      }
      if (Array.isArray(el.kids)) {
        for (const child of el.kids) await walkElement(child, indent)
      }
    } else if (type === 'table') {
      // 尝试把 rows/cells 当 2D 渲染；不行就 fallback 到打平 kids 的 content
      let md = ''
      try {
        md = tableToMarkdown(el.rows ?? el.cells)
      } catch {
        md = ''
      }
      if (md) {
        chunks.push({ kind: 'table', page, text: md, bbox })
        statsFor(page).textChars += md.length
      } else {
        const texts = tableTextFallback(el as { kids?: unknown; 'list items'?: unknown })
        if (texts.length) {
          const joined = texts.join(' · ')
          chunks.push({ kind: 'paragraph', page, text: joined, bbox })
          statsFor(page).textChars += joined.length
        }
      }
      // 表格内可能还嵌 image / list 等，继续递归进 kids 捞
      if (Array.isArray(el.kids)) {
        for (const child of el.kids) await walkElement(child, indent)
      }
    } else if (type === 'image' || type === 'figure') {
      const source = el.source ?? ''
      if (!source) return
      const basename = path.basename(source)
      const file = fileByName.get(basename)
      const idx = (pageImageIdx.get(page) ?? 0) + 1
      pageImageIdx.set(page, idx)
      statsFor(page).imageCount += 1
      if (!file) return                                         // 可能被 content safety 过滤掉
      try {
        const bytes = await readFile(file.absPath)
        images.push({ page, index: idx, bbox, fileName: basename, ext: file.ext, bytes })
      } catch {
        // 读失败跳过
      }
    }
    // 其它类型（formula / chart / background / ...）先忽略，保留原语料字段
  }

  const kids = Array.isArray(root.kids) ? root.kids : []
  for (const el of kids) await walkElement(el)

  const declaredPages = Number(root['number of pages'] ?? 0) || 0
  const seenMaxPage =
    pageStatsMap.size > 0 ? Math.max(...pageStatsMap.keys()) : 0

  const pageStats: PdfPageStats[] = [...pageStatsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, s]) => ({ page, textChars: s.textChars, imageCount: s.imageCount }))

  return {
    chunks,
    images,
    pageStats,
    pages: declaredPages || seenMaxPage,
  }
}
