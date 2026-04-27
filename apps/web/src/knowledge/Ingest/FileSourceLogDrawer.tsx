/**
 * FileSourceLogDrawer —— 展示某 source 最近扫描日志
 */
import { useEffect, useState } from 'react'
import { fileSourceApi, type ScanLog } from '@/api/fileSource'

interface Props {
  sourceId: number
  onClose: () => void
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function fmtDuration(s: ScanLog): string {
  if (!s.finished_at) return '进行中'
  const ms = new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

function statusPill(s: ScanLog['status']): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 999 }
  switch (s) {
    case 'ok':      return { ...base, background: '#d1fae5', color: '#065f46' }
    case 'partial': return { ...base, background: '#fef3c7', color: '#92400e' }
    case 'error':   return { ...base, background: '#fee2e2', color: '#991b1b' }
    case 'running': return { ...base, background: '#dbeafe', color: '#1e40af' }
  }
}

export default function FileSourceLogDrawer({ sourceId, onClose }: Props) {
  const [logs, setLogs] = useState<ScanLog[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fileSourceApi.logs(sourceId, 30)
      .then((r) => { if (!cancelled) setLogs(r.items) })
      .catch((e) => { if (!cancelled) setErr((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sourceId])

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 600, height: '100vh',
      background: '#fff', borderLeft: '1px solid var(--border)', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
      zIndex: 100, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>扫描日志 · source #{sourceId}</span>
        <button className="btn ghost" onClick={onClose}>关闭</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>}
        {err && <div style={{ color: 'var(--red)', padding: 10 }}>{err}</div>}
        {!loading && !err && logs.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>还没有扫描记录</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="surface-card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>#{log.id} · 开始 {fmtTime(log.started_at)}</div>
              <span style={statusPill(log.status)}>{log.status}</span>
            </div>
            <div style={{ fontSize: 13, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>新增 <b>{log.added_count}</b></span>
              <span>更新 <b>{log.updated_count}</b></span>
              <span>移除 <b>{log.removed_count}</b></span>
              <span>耗时 <b>{fmtDuration(log)}</b></span>
            </div>
            {log.error_message && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>错误：{log.error_message}</div>
            )}
            {log.failed_items && log.failed_items.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>失败 {log.failed_items.length} 条</summary>
                <div style={{ marginTop: 6, maxHeight: 160, overflow: 'auto' }}>
                  {log.failed_items.map((f, i) => (
                    <div key={i} style={{ padding: 4, fontFamily: 'monospace', fontSize: 11, borderBottom: '1px dashed var(--border)' }}>
                      <div style={{ color: 'var(--text)' }}>{f.id}</div>
                      <div style={{ color: 'var(--red)' }}>{f.error}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
