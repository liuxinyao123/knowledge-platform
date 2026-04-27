import { useState, useEffect, useCallback } from 'react'
import { govApi, type DuplicatePair } from '@/api/governance'
import { Skeleton, ErrorView, EmptyView } from './TagsPanel'

export default function DuplicatesPanel() {
  const [threshold, setThreshold] = useState(0.85)
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    govApi.listDuplicates(threshold, 50)
      .then((r) => { setPairs(r.items); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [threshold])
  useEffect(() => { load() }, [load])

  const onMerge = async (srcId: number, dstId: number) => {
    if (!confirm(`合并 asset ${srcId} → ${dstId}？源会被软标删除，其 chunks 转给目标。`)) return
    try {
      await govApi.mergeAssets(srcId, dstId)
      setMsg(`✓ 已合并 ${srcId} → ${dstId}`)
      load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMsg('✗ ' + (err?.response?.data?.error || '合并失败'))
    }
  }

  const onDismiss = async (a: number, b: number) => {
    try {
      await govApi.dismissDuplicate(a, b)
      setMsg(`✓ 已标记非重复 (${a},${b})`)
      load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMsg('✗ ' + (err?.response?.data?.error || '失败'))
    }
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 12, marginBottom: 12, background: '#f9fafb',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>相似度阈值</label>
        <input
          type="range" min="0.5" max="1" step="0.05"
          value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <code style={{ minWidth: 50, textAlign: 'center' }}>{threshold.toFixed(2)}</code>
        <button className="btn" onClick={load} style={{ padding: '4px 12px' }}>重新检测</button>
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: msg.startsWith('✓') ? '#e6f4ea' : '#fce8e6',
          color: msg.startsWith('✓') ? '#1e7e34' : '#c53030', fontSize: 13,
        }}>{msg}</div>
      )}

      {loading ? <Skeleton />
        : err ? <ErrorView msg={err} onRetry={load} />
        : !pairs || pairs.length === 0 ? (
          <EmptyView icon="✨" title="当前没有高相似条目" text={`阈值 ${threshold.toFixed(2)} 下没有候选对。可调低阈值再试。`} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
                <th style={th}>条目 A</th>
                <th style={th}>条目 B</th>
                <th style={{ ...th, textAlign: 'right' }}>相似度</th>
                <th style={{ ...th, textAlign: 'right' }}>建议</th>
                <th style={{ ...th, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={td}><code>#{p.a.id}</code> {p.a.name}</td>
                  <td style={td}><code>#{p.b.id}</code> {p.b.name}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: p.similarity > 0.9 ? 'var(--red)' : 'var(--amber)' }}>
                      {(p.similarity * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
                    合并并保留新版本
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-primary" onClick={() => onMerge(p.a.id, p.b.id)}
                      style={{ padding: '4px 10px', fontSize: 12, marginRight: 4 }}>
                      合并
                    </button>
                    <button className="btn" onClick={() => onDismiss(p.a.id, p.b.id)}
                      style={{ padding: '4px 10px', fontSize: 12 }}>
                      非重复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 12px' }
