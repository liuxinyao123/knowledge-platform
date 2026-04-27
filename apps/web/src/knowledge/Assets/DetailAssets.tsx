/**
 * DetailAssets —— 资产详情 / 资产列表 tab
 *
 * 升级（2026-04-26 · ADR-34 v3）：
 *   后端把 headings 字段从只 chunk_level=1 扩展为 1+3 一起返回，包含 kind/chunk_level。
 *   前端这里区分渲染：
 *     · 标题 chunk（heading）：粗体 + 浅色 badge
 *     · 段落 chunk（paragraph / table / generic）：截断 + tooltip 显示完整文本
 *   提供「展开全文」按钮悬停看完整段落（避免长行毁掉表格）。
 */
import { useState } from 'react'
import type { PgAssetDetail } from '@/api/assetDirectory'

type ChunkRow = PgAssetDetail['chunks']['headings'][number]

/** chunk kind / level → 中文标签 + 颜色 */
function kindBadge(row: ChunkRow): { label: string; color: string; bg: string } {
  // 优先看 chunk_level（1=heading，3=embed 段落）
  if (row.chunk_level === 1) {
    return { label: '标题', color: '#7c3aed', bg: '#f3e8ff' }
  }
  // chunk_level=3 时按 kind 进一步分类（来自 ingestPipeline ExtractedChunk.kind）
  switch (row.kind) {
    case 'heading':       return { label: '标题', color: '#7c3aed', bg: '#f3e8ff' }
    case 'paragraph':     return { label: '段落', color: '#0369a1', bg: '#e0f2fe' }
    case 'table':         return { label: '表格', color: '#15803d', bg: '#dcfce7' }
    case 'image_caption': return { label: '图注', color: '#c2410c', bg: '#ffedd5' }
    case 'generic':       return { label: '正文', color: '#475569', bg: '#f1f5f9' }
    default:              return { label: row.kind || '段落', color: '#64748b', bg: '#f1f5f9' }
  }
}

const TEXT_PREVIEW_LIMIT = 160

function ChunkText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > TEXT_PREVIEW_LIMIT
  if (!isLong) {
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</span>
  }
  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {expanded ? text : text.slice(0, TEXT_PREVIEW_LIMIT) + '…'}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginLeft: 8, padding: '0 6px', fontSize: 11, height: 20,
          background: 'transparent', border: '1px solid var(--border)',
          borderRadius: 4, color: 'var(--p)', cursor: 'pointer',
        }}>
        {expanded ? '收起' : '展开'}
      </button>
    </span>
  )
}

export default function DetailAssets({ detail }: { detail: PgAssetDetail }) {
  const headings = detail.chunks.headings

  if (!headings.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        🗂 当前资产没有结构化切片；可能是平文本或图片型，请到「RAGFlow 摘要」看正文
      </div>
    )
  }

  // 统计每种 kind 的数量（顶部摘要）
  const kindCount = new Map<string, number>()
  for (const h of headings) {
    const k = kindBadge(h).label
    kindCount.set(k, (kindCount.get(k) ?? 0) + 1)
  }

  return (
    <div>
      {/* 顶部统计条 */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 10, fontSize: 12, color: 'var(--muted)',
        padding: '6px 10px', background: '#fafbfc',
        border: '1px solid var(--border)', borderRadius: 6, flexWrap: 'wrap',
      }}>
        <span>共 <strong style={{ color: '#0f172a' }}>{headings.length}</strong> 个切片</span>
        {detail.chunks.total > headings.length && (
          <span>· 显示前 {headings.length} / 共 {detail.chunks.total} 段</span>
        )}
        {[...kindCount.entries()].map(([label, n]) => (
          <span key={label}>· {label} {n}</span>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, width: 50 }}>页</th>
            <th style={{ ...th, width: 70 }}>类型</th>
            <th style={th}>内容</th>
            <th style={{ ...th, width: 220 }}>层级路径</th>
          </tr>
        </thead>
        <tbody>
          {headings.map((h, i) => {
            const b = kindBadge(h)
            const isHeading = h.chunk_level === 1 || h.kind === 'heading'
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, width: 50, color: 'var(--muted)' }}>
                  {h.page ?? '—'}
                </td>
                <td style={{ ...td, width: 70 }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 7px',
                    fontSize: 11, fontWeight: 500, borderRadius: 4,
                    color: b.color, background: b.bg,
                  }}>
                    {b.label}
                  </span>
                </td>
                <td style={{
                  ...td,
                  fontWeight: isHeading ? 600 : 400,
                  color: isHeading ? '#0f172a' : '#374151',
                }}>
                  <ChunkText text={h.text} />
                </td>
                <td style={{ ...td, width: 220, fontSize: 11, color: 'var(--muted)' }}>
                  {h.heading_path || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, fontSize: 12, color: '#64748b' }
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' }
