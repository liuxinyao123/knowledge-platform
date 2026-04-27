/**
 * FileSourceList —— 文件服务器接入点列表
 *
 * 行为：
 *  - 列表展示：名称 / 协议 / 周期 / 上次扫描状态
 *  - 立即扫 / 试连 / 编辑 / 禁用 / 删除
 *  - 新建按钮 → FileSourceForm
 *  - 查日志 → FileSourceLogDrawer
 */
import { useEffect, useState } from 'react'
import { fileSourceApi, type FileSource } from '@/api/fileSource'
import FileSourceForm from './FileSourceForm'
import FileSourceLogDrawer from './FileSourceLogDrawer'

function fmtTime(iso: string | null): string {
  if (!iso) return '未扫描'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未扫描'
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`
  return d.toLocaleString()
}

function statusBadge(s: FileSource): { text: string; color: string } {
  if (!s.enabled) return { text: '已禁用', color: '#6b7280' }
  switch (s.last_scan_status) {
    case 'ok':      return { text: '正常', color: '#16a34a' }
    case 'partial': return { text: '部分失败', color: '#d97706' }
    case 'error':   return { text: '失败', color: '#dc2626' }
    default:        return { text: '未扫描', color: '#6b7280' }
  }
}

export default function FileSourceList() {
  const [items, setItems] = useState<FileSource[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [formMode, setFormMode] = useState<null | { edit?: FileSource }>(null)
  const [logDrawerId, setLogDrawerId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)

  async function reload() {
    setLoading(true); setErr(null)
    try {
      const r = await fileSourceApi.list()
      setItems(r.items)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void reload() }, [])

  function showToast(msg: string, kind: 'ok' | 'err') {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 4000)
  }

  async function scan(s: FileSource) {
    try {
      const r = await fileSourceApi.scan(s.id)
      showToast(r.status === 'already_running' ? '已有扫描在进行' : '已触发扫描，请查看日志', 'ok')
    } catch (e) {
      showToast((e as Error).message, 'err')
    }
  }

  async function test(s: FileSource) {
    try {
      const r = await fileSourceApi.test(s.id)
      if (r.ok) {
        const names = r.sample.map((x) => x.name).join(' / ') || '(目录为空)'
        showToast(`试连成功 · 样本 ${r.sample.length} 条：${names}`, 'ok')
      } else {
        showToast(`试连失败 [${r.error_code}]：${r.message}`, 'err')
      }
    } catch (e) {
      showToast((e as Error).message, 'err')
    }
  }

  async function toggleEnabled(s: FileSource) {
    if (!confirm(`确定${s.enabled ? '禁用' : '启用'}「${s.name}」吗？`)) return
    try {
      await fileSourceApi.patch(s.id, { enabled: !s.enabled })
      await reload()
    } catch (e) {
      showToast((e as Error).message, 'err')
    }
  }

  async function remove(s: FileSource) {
    if (!confirm(`删除接入点「${s.name}」吗？已入库的文件不会受影响。`)) return
    try {
      await fileSourceApi.remove(s.id)
      await reload()
    } catch (e) {
      showToast((e as Error).message, 'err')
    }
  }

  if (formMode) {
    return (
      <FileSourceForm
        existing={formMode.edit}
        onDone={() => { setFormMode(null); void reload() }}
        onCancel={() => setFormMode(null)}
      />
    )
  }

  return (
    <div data-testid="file-source-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          从 SMB / NAS 等文件服务器定时拉文件入库；本轮支持 SMB/CIFS。
        </div>
        <button className="btn primary" onClick={() => setFormMode({})}>+ 新建接入点</button>
      </div>

      {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>}
      {err && <div style={{ color: 'var(--red)', padding: 10 }}>{err}</div>}

      {!loading && !err && items.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', background: '#f9fafb', borderRadius: 8 }}>
          还没有接入点。点「+ 新建接入点」添加一个 SMB 文件服务器。
        </div>
      )}

      {items.map((s) => {
        const badge = statusBadge(s)
        return (
          <div key={s.id} className="surface-card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                  <span className="pill" style={{ cursor: 'default' }}>{s.type.toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: badge.color, fontWeight: 600 }}>● {badge.text}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  周期 <code>{s.cron}</code> · 上次扫描 {fmtTime(s.last_scan_at)}
                  {s.last_scan_error && <span style={{ color: 'var(--red)', marginLeft: 8 }}>错误：{s.last_scan_error}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => void test(s)}>试连</button>
                <button className="btn" onClick={() => void scan(s)} disabled={!s.enabled}>立即扫</button>
                <button className="btn ghost" onClick={() => setLogDrawerId(s.id)}>日志</button>
                <button className="btn ghost" onClick={() => setFormMode({ edit: s })}>编辑</button>
                <button className="btn ghost" onClick={() => void toggleEnabled(s)}>{s.enabled ? '禁用' : '启用'}</button>
                <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={() => void remove(s)}>删除</button>
              </div>
            </div>
          </div>
        )
      })}

      {logDrawerId != null && (
        <FileSourceLogDrawer sourceId={logDrawerId} onClose={() => setLogDrawerId(null)} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 200,
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: toast.kind === 'ok' ? '#d1fae5' : '#fee2e2',
          color: toast.kind === 'ok' ? '#065f46' : '#991b1b',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>{toast.msg}</div>
      )}
    </div>
  )
}
