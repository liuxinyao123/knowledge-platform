/**
 * KnowledgeGraph/colors.ts —— Asset.type → 颜色映射
 *
 * 与 Assets/DetailGraph.tsx 的 KIND_COLOR 不冲突：那个按 kind（asset/source/...）配色，
 * 本表按 Asset.type（pdf/md/...）配色。
 */

const TYPE_COLORS: Record<string, string> = {
  pdf: '#0ea5e9',
  md: '#10b981',
  markdown: '#10b981',
  docx: '#3b82f6',
  doc: '#3b82f6',
  xlsx: '#f59e0b',
  xls: '#f59e0b',
  csv: '#f59e0b',
  ods: '#f59e0b',
  pptx: '#ef4444',
  ppt: '#ef4444',
  png: '#a855f7',
  jpg: '#a855f7',
  jpeg: '#a855f7',
  gif: '#a855f7',
  webp: '#a855f7',
  svg: '#a855f7',
  url: '#06b6d4',
  web: '#06b6d4',
  html: '#06b6d4',
  _tag: '#fbbf24',
}

const FALLBACK = '#94a3b8'

export function colorForType(type: string): string {
  if (!type) return FALLBACK
  const lower = type.toLowerCase().trim()
  if (TYPE_COLORS[lower]) return TYPE_COLORS[lower]
  // image* 模糊匹配
  if (lower.startsWith('image')) return TYPE_COLORS.png
  return FALLBACK
}

/** 给 NodeLegend 用的有序展示列表 */
export const LEGEND_ENTRIES: Array<{ label: string; color: string; types: string[] }> = [
  { label: 'PDF', color: TYPE_COLORS.pdf, types: ['pdf'] },
  { label: 'Markdown', color: TYPE_COLORS.md, types: ['md', 'markdown'] },
  { label: 'Word', color: TYPE_COLORS.docx, types: ['docx', 'doc'] },
  { label: '表格', color: TYPE_COLORS.xlsx, types: ['xlsx', 'xls', 'csv', 'ods'] },
  { label: '幻灯片', color: TYPE_COLORS.pptx, types: ['pptx', 'ppt'] },
  { label: '图片', color: TYPE_COLORS.png, types: ['png', 'jpg', 'image*'] },
  { label: '网页', color: TYPE_COLORS.url, types: ['url', 'web', 'html'] },
  { label: '其它', color: FALLBACK, types: ['*'] },
  { label: '标签', color: TYPE_COLORS._tag, types: ['_tag'] },
]
