import { useState, type ReactElement } from 'react'
import type { InsightIsolated } from '@/api/insights'
import MiniGraph from '../MiniGraph'
import DismissButton from '../DismissButton'
import DeepResearchDialog from '../DeepResearchDialog'

interface Props {
  spaceId: number
  items: InsightIsolated[]
  onDismiss: (key: string) => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '未知'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未知'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  return `${days} 天前`
}

export default function IsolatedCard({ spaceId, items, onDismiss }: Props): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [dialogKey, setDialogKey] = useState<string | null>(null)
  const dialogItem = dialogKey ? items.find((x) => x.key === dialogKey) : null

  const visible = expanded ? items : items.slice(0, 2)
  const remaining = Math.max(0, items.length - visible.length)

  return (
    <section
      className="surface-card"
      style={{ padding: '1rem 1.25rem', marginBottom: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pill amber" style={{ fontSize: 12, padding: '4px 10px' }}>
            孤立页面
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            度 ≤ 1 且资产年龄 ≥ 7 天
          </span>
        </div>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} 项</span>
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
          当前没有检测到孤立页面。
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {visible.map((it) => (
            <div
              key={it.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-faint, rgba(0,0,0,0.05))',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                <MiniGraph seeds={[it.asset_id]} neighbors={[]} size={64} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {it.type} · 度 {it.degree} · {formatDate(it.created_at)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setDialogKey(it.key)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '2px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Deep research
                </button>
                <DismissButton
                  spaceId={spaceId}
                  insightKey={it.key}
                  onDismissed={() => onDismiss(it.key)}
                />
              </div>
            </div>
          ))}
          {remaining > 0 && (
            <div style={{ textAlign: 'center', paddingTop: 10 }}>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 12,
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                展开剩余 {remaining} 项
              </button>
            </div>
          )}
        </div>
      )}

      {dialogItem && (
        <DeepResearchDialog
          spaceId={spaceId}
          insightKey={dialogItem.key}
          initialSeedIds={[dialogItem.asset_id]}
          onClose={() => setDialogKey(null)}
        />
      )}
    </section>
  )
}
