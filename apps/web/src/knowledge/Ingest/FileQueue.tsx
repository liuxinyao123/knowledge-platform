import type { Row } from './Wizard'

const PHASE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: '#f3f4f6', color: '#6b7280', label: '待解析' },
  parsing:   { bg: '#fef3c7', color: '#92400e', label: '解析中…' },
  parsed:    { bg: '#dbeafe', color: '#1e40af', label: '已解析' },
  uploading: { bg: '#fef3c7', color: '#92400e', label: '上传中…' },
  done:      { bg: '#dcfce7', color: '#166534', label: '✓ 完成' },
  failed:    { bg: '#fee2e2', color: '#991b1b', label: '✗ 失败' },
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  rows: Row[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onRetry: (row: Row) => void
}

export default function FileQueue({ rows, selectedId, onSelect, onRemove, onAdd, onRetry }: Props) {
  return (
    <div data-testid="file-queue" style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column', maxHeight: 520, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>队列</div>
        <span style={{ flex: 1 }} />
        <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onAdd}>+ 添加</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>📂</div>
            <div>点右上"+ 添加"选多个文件</div>
          </div>
        ) : rows.map((row) => {
          const style = PHASE_STYLE[row.phase]
          const isSelected = row.id === selectedId
          return (
            <div
              key={row.id}
              onClick={() => onSelect(row.id)}
              style={{
                padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                background: isSelected ? 'var(--p-light)' : '#fff',
                border: isSelected ? '1px solid var(--p)' : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={row.file.name}>
                  {row.file.name}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(row.id) }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: 0, width: 16,
                  }}
                >×</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                  background: style.bg, color: style.color,
                }}>{style.label}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtSize(row.file.size)}</span>
                {row.extract?.kind === 'text' && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {row.extract.text.length} chars</span>
                )}
                {row.extract?.kind === 'attachment' && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>· 附件</span>
                )}
                {row.phase === 'failed' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRetry(row) }}
                    style={{
                      marginLeft: 'auto', background: 'transparent', border: 'none',
                      color: 'var(--p)', cursor: 'pointer', fontSize: 11,
                    }}
                  >重试</button>
                )}
              </div>
              {row.error && (
                <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={row.error}>
                  {row.error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
