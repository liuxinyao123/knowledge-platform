import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRecentImports, type RecentImport } from '@/api/ingest'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

const ACTION_LABEL: Record<string, { icon: string; label: string }> = {
  ingest_done:            { icon: '✓', label: '入库完成' },
  ingest_failed:          { icon: '✗', label: '入库失败' },
  ingest_started:         { icon: '▶', label: '开始解析' },
  bookstack_page_create:  { icon: '📄', label: '建页' },
  asset_register:         { icon: '📦', label: '登记资产' },
}

export default function RecentImports({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<RecentImport[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getRecentImports(10)
        .then((r) => { if (!cancelled) { setItems(r); setErr(null) } })
        .catch((e) => { if (!cancelled) setErr(e?.response?.data?.error || e?.message || '加载失败') })
    }
    load()
    const iv = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [refreshKey])

  return (
    <div style={{
      marginTop: 16, padding: 14,
      background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>🕑 最近入库</div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>每 10s 刷新</span>
      </div>
      {err ? (
        <div style={{ color: '#dc2626', fontSize: 12, padding: 8 }}>{err}</div>
      ) : !items ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>加载中…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
          暂无记录（先通过向导提交一个文件试试）
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={th}>时间</th>
              <th style={th}>动作</th>
              <th style={th}>文件</th>
              <th style={th}>目标</th>
              <th style={th}>切片/图</th>
              <th style={th}>用户</th>
              <th style={{ ...th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const meta = ACTION_LABEL[it.action] ?? { icon: '·', label: it.action }
              const canJump = it.target_type === 'asset' && it.target_id != null
              return (
                <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={td}>{timeAgo(it.at)}</td>
                  <td style={td}>
                    <span title={it.action}>
                      <span style={{ marginRight: 4 }}>{meta.icon}</span>{meta.label}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name ?? ''}>
                    {it.name ?? <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={td}>
                    {it.target_type && it.target_id
                      ? <code>{it.target_type}#{it.target_id}</code>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={td}>
                    {it.chunks != null && <span>{it.chunks}</span>}
                    {it.chunks != null && it.images != null && <span style={{ color: 'var(--muted)' }}> / {it.images}</span>}
                    {it.chunks == null && <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{it.email ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canJump && (
                      <button
                        className="btn"
                        style={{ padding: '2px 10px', fontSize: 11 }}
                        onClick={() => nav(`/assets/${it.target_id}`)}
                      >详情</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)',
  fontSize: 11, color: 'var(--muted)', fontWeight: 600,
}
const td: React.CSSProperties = { padding: '6px 10px' }
