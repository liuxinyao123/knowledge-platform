import { useState, useEffect, useCallback } from 'react'
import { govApi, type TagInfo } from '@/api/governance'

export default function TagsPanel() {
  const [tags, setTags] = useState<TagInfo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mergeDst, setMergeDst] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    govApi.listTags()
      .then((r) => { setTags(r.items); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const doMerge = async () => {
    if (!mergeDst.trim() || selected.size === 0) return
    try {
      const r = await govApi.mergeTags([...selected], mergeDst.trim())
      setMsg(`✓ 合并成功：影响 ${r.affected} 条资产`)
      setSelected(new Set()); setMergeDst('')
      load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setMsg('✗ ' + (err?.response?.data?.error || err?.message || '合并失败'))
    }
  }

  if (loading) return <Skeleton />
  if (err) return <ErrorView msg={err} onRetry={load} />
  if (!tags || tags.length === 0) return (
    <EmptyView
      icon="🏷"
      title="尚无标签"
      text="从「入库」页面上传文件后会自动抽取标签"
    />
  )

  return (
    <div>
      {msg && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: msg.startsWith('✓') ? '#e6f4ea' : '#fce8e6',
          color: msg.startsWith('✓') ? '#1e7e34' : '#c53030', fontSize: 13,
        }}>{msg}</div>
      )}

      {selected.size > 0 && (
        <div style={{
          padding: 12, marginBottom: 12, border: '1px solid var(--border)',
          borderRadius: 8, background: '#faf5ff',
        }}>
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            已选 {selected.size} 个：<code>{[...selected].join(' · ')}</code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="合并到目标标签名"
              value={mergeDst}
              onChange={(e) => setMergeDst(e.target.value)}
              style={{
                flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6,
              }}
            />
            <button
              className="btn btn-primary"
              onClick={doMerge}
              disabled={!mergeDst.trim()}
              style={{ padding: '6px 14px' }}
            >
              合并
            </button>
            <button className="btn" onClick={() => setSelected(new Set())} style={{ padding: '6px 14px' }}>
              取消
            </button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
            <th style={th}>选</th>
            <th style={th}>标签</th>
            <th style={{ ...th, textAlign: 'right' }}>条目数</th>
            <th style={{ ...th, textAlign: 'right' }}>近 7 天</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((t) => (
            <tr key={t.name} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={td}>
                <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggle(t.name)} />
              </td>
              <td style={td}><code>{t.name}</code></td>
              <td style={{ ...td, textAlign: 'right' }}>{t.count}</td>
              <td style={{ ...td, textAlign: 'right', color: t.recentGrowth > 0 ? 'var(--green)' : 'var(--muted)' }}>
                {t.recentGrowth > 0 ? `+${t.recentGrowth}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 12px' }

export function Skeleton() {
  return <div style={{ padding: 20, color: 'var(--muted)' }}>加载中...</div>
}

export function ErrorView({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 20, textAlign: 'center' }}>
      <div style={{ color: 'var(--red)', marginBottom: 8 }}>⚠ {msg}</div>
      <button className="btn" onClick={onRetry}>重试</button>
    </div>
  )
}

export function EmptyView({ icon, title, text, action }: {
  icon: string; title: string; text: string; action?: React.ReactNode
}) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, marginBottom: 12 }}>{text}</div>
      {action}
    </div>
  )
}
