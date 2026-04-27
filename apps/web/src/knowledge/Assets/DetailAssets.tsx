import type { PgAssetDetail } from '@/api/assetDirectory'

export default function DetailAssets({ detail }: { detail: PgAssetDetail }) {
  const headings = detail.chunks.headings
  if (!headings.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        🗂 当前资产没有结构化标题；可能是平文本或图片型，请到"RAGFlow 摘要"看正文
      </div>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
          <th style={th}>页</th>
          <th style={th}>标题</th>
          <th style={th}>层级路径</th>
        </tr>
      </thead>
      <tbody>
        {headings.map((h, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...td, width: 60 }}>{h.page}</td>
            <td style={td}>{h.text}</td>
            <td style={{ ...td, fontSize: 11, color: 'var(--muted)' }}>{h.heading_path || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 12px' }
