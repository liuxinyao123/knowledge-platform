/**
 * AttachSourceModal —— 把现有 metadata_source 纳入空间
 * 数据：/api/asset-directory/pg-sources
 *
 * 2026-04-23-26：底部补"+ 新建数据源"入口，解决新装部署从空间主页无法建源的死路。
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import { attachSources } from '@/api/spaces'
import CreateSourceModal from './CreateSourceModal'

interface Props {
  spaceId: number
  attachedIds: Set<number>
  onClose: () => void
  onAttached: () => void
}

interface SourceRow {
  id: number
  name: string
  type: string | null
  connector: string | null
  asset_count: number
}

export default function AttachSourceModal({ spaceId, attachedIds, onClose, onAttached }: Props) {
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function loadSources() {
    axios.get<{ sources: SourceRow[] }>('/api/asset-directory/pg-sources')
      .then((r) => setSources(r.data.sources ?? []))
      .catch((e) => { setErr((e as Error).message); setSources([]) })
  }

  useEffect(() => { loadSources() }, [])

  function toggle(id: number) {
    const n = new Set(picked)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setPicked(n)
  }

  async function save() {
    if (picked.size === 0) return onClose()
    setSaving(true); setErr(null)
    try {
      await attachSources(spaceId, [...picked])
      onAttached()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const filtered = (sources ?? []).filter((s) => {
    if (attachedIds.has(s.id)) return false
    if (!filter.trim()) return true
    return s.name.toLowerCase().includes(filter.toLowerCase())
  })

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
          关联数据源到空间
        </div>
        <div style={{ padding: 16 }}>
          <input
            placeholder="搜索数据源…"
            value={filter} onChange={(e) => setFilter(e.target.value)}
            style={inp}
          />
          <div style={{ maxHeight: 360, overflowY: 'auto', marginTop: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
            {sources === null && <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)' }}>加载中…</div>}
            {sources && filtered.length === 0 && (
              <div style={{ padding: 20, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                {sources.length === 0 ? '暂无可关联的数据源' : '已全部关联或无匹配'}
              </div>
            )}
            {filtered.map((s) => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    #{s.id} · {s.type ?? '—'} · {s.asset_count} 资产
                  </div>
                </div>
              </label>
            ))}
          </div>
          {err && <div style={{ padding: 8, marginTop: 10, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
        </div>
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
        }}>
          <button className="btn" onClick={() => setCreating(true)}>
            + 新建数据源
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} style={{ marginRight: 6 }}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving || picked.size === 0}>
            {saving ? '关联中…' : `关联 ${picked.size} 个`}
          </button>
        </div>
      </div>
      <CreateSourceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(src) => {
          setCreating(false)
          // 新建完自动选中 + 刷新列表
          loadSources()
          setPicked((prev) => new Set(prev).add(src.id))
        }}
      />
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalBox: React.CSSProperties = { width: '90%', maxWidth: 560, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }
