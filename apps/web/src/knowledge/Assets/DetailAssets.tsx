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
import { useTranslation } from 'react-i18next'
import type { PgAssetDetail } from '@/api/assetDirectory'

type ChunkRow = PgAssetDetail['chunks']['headings'][number]

type KindKey = 'heading' | 'paragraph' | 'table' | 'image_caption' | 'generic'

/** chunk kind / level → key + 颜色（label 由调用方按 i18n 翻译） */
function kindMeta(row: ChunkRow): { key: KindKey; rawKind: string; color: string; bg: string } {
  if (row.chunk_level === 1) {
    return { key: 'heading', rawKind: 'heading', color: '#7c3aed', bg: '#f3e8ff' }
  }
  switch (row.kind) {
    case 'heading':       return { key: 'heading',       rawKind: 'heading',       color: '#7c3aed', bg: '#f3e8ff' }
    case 'paragraph':     return { key: 'paragraph',     rawKind: 'paragraph',     color: '#0369a1', bg: '#e0f2fe' }
    case 'table':         return { key: 'table',         rawKind: 'table',         color: '#15803d', bg: '#dcfce7' }
    case 'image_caption': return { key: 'image_caption', rawKind: 'image_caption', color: '#c2410c', bg: '#ffedd5' }
    case 'generic':       return { key: 'generic',       rawKind: 'generic',       color: '#475569', bg: '#f1f5f9' }
    default:              return { key: 'paragraph',     rawKind: row.kind || 'paragraph', color: '#64748b', bg: '#f1f5f9' }
  }
}

const TEXT_PREVIEW_LIMIT = 160

function ChunkText({ text }: { text: string }) {
  const { t } = useTranslation('assets')
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
        {expanded ? t('chunks.collapse') : t('chunks.expand')}
      </button>
    </span>
  )
}

export default function DetailAssets({ detail }: { detail: PgAssetDetail }) {
  const { t } = useTranslation('assets')
  const headings = detail.chunks.headings

  if (!headings.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        {t('chunks.empty')}
      </div>
    )
  }

  // 统计每种 kind 的数量（顶部摘要）—— key 用 i18n key，渲染时 t()
  const kindCount = new Map<string, number>()
  for (const h of headings) {
    const k = kindMeta(h).key
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
        <span>{t('chunks.totalLabel', { count: headings.length })}</span>
        {detail.chunks.total > headings.length && (
          <span>{t('chunks.showingPart', { shown: headings.length, total: detail.chunks.total })}</span>
        )}
        {[...kindCount.entries()].map(([key, n]) => (
          <span key={key}>· {t(`chunks.kinds.${key}`)} {n}</span>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, width: 50 }}>{t('chunks.cols.page')}</th>
            <th style={{ ...th, width: 70 }}>{t('chunks.cols.kind')}</th>
            <th style={th}>{t('chunks.cols.content')}</th>
            <th style={{ ...th, width: 220 }}>{t('chunks.cols.headingPath')}</th>
          </tr>
        </thead>
        <tbody>
          {headings.map((h, i) => {
            const b = kindMeta(h)
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
                    {t(`chunks.kinds.${b.key}`)}
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
