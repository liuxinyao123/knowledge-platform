import { useState, type ReactElement } from 'react'
import type { InsightSurprise } from '@/api/insights'
import MiniGraph from '../MiniGraph'
import DismissButton from '../DismissButton'
import DeepResearchDialog from '../DeepResearchDialog'

interface Props {
  spaceId: number
  items: InsightSurprise[]
  onDismiss: (key: string) => void
}

export default function SurprisesCard({ spaceId, items, onDismiss }: Props): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [dialogKey, setDialogKey] = useState<string | null>(null)
  const dialogItem = dialogKey ? items.find((x) => x.key === dialogKey) : null

  const visible = expanded ? items : items.slice(0, 2)
  const remaining = Math.max(0, items.length - visible.length)

  return (
    <section className="surface-card" style={{ padding: '1rem 1.25rem', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pill" style={{ background: '#E1F5EE', color: '#085041', fontSize: 12, padding: '4px 10px' }}>
            惊奇连接
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>跨社区或跨类型的 CO_CITED 边</span>
        </div>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} 项</span>
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
          没有检测到惊奇连接（或 Louvain 降级中）。
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {visible.map((it) => {
            const flags: string[] = []
            if (it.cross_community) flags.push('跨社区')
            if (it.cross_type) flags.push('跨类型')
            return (
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
                  <MiniGraph seeds={[it.a.id, it.b.id]} neighbors={[]} size={64} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{it.a.name}</span>
                      <span style={{ color: 'var(--muted)' }}>↔</span>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{it.b.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {flags.join(' · ')} · 边权重 {it.edge_weight} · 惊奇度 {it.surprise_score}
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
            )
          })}
          {remaining > 0 && (
            <div style={{ textAlign: 'center', paddingTop: 10 }}>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                style={{ background: 'transparent', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}
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
          initialSeedIds={[dialogItem.a.id, dialogItem.b.id]}
          onClose={() => setDialogKey(null)}
        />
      )}
    </section>
  )
}
