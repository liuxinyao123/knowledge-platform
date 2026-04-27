/**
 * SourcesPanel —— 左栏：notebook 当前的资料列表
 *
 * - 「+ 添加资料」打开 AssetPickerModal
 * - 每行可移除
 * - 高亮（highlightedAssetId）：用户点击 chat 里的 [^N] 后由父组件传入
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addSources, removeSource,
  type NotebookSource,
} from '@/api/notebooks'
import { listPgSources, listPgAssets, type PgSourceRow, type PgAssetCard } from '@/api/assetDirectory'

interface Props {
  notebookId: number
  sources: NotebookSource[]
  highlightedAssetId: number | null
  onChanged: () => void   // 增删后通知父级 reload
}

const TYPE_ICON: Record<string, string> = {
  document: '📄', structured: '🗄', online: '🌐',
}

export default function SourcesPanel({
  notebookId, sources, highlightedAssetId, onChanged,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const highlightRef = useRef<HTMLDivElement>(null)

  // 高亮变化时滚到对应行
  useEffect(() => {
    if (highlightedAssetId == null) return
    highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [highlightedAssetId])

  return (
    <>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sources.length} 份资料</span>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--p, #6C47FF)',
            cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '2px 6px',
          }}
        >+ 添加资料</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
        {sources.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            尚未添加资料 <br />点上方「+ 添加资料」开始
          </div>
        ) : (
          sources.map((s) => {
            const isHi = highlightedAssetId === s.asset_id
            return (
              <div
                key={s.asset_id}
                ref={isHi ? highlightRef : null}
                style={{
                  padding: '8px 12px', borderRadius: 6, marginBottom: 2,
                  background: isHi ? 'rgba(108,71,255,0.15)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'background 0.2s',
                }}
              >
                <span>{TYPE_ICON[s.type] ?? '📄'}</span>
                <span style={{
                  flex: 1, fontSize: 12, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={s.asset_name}>{s.asset_name}</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`从笔记本移除「${s.asset_name}」？\n（不会删除原 asset，只是从本笔记本剔除）`)) return
                    await removeSource(notebookId, s.asset_id)
                    onChanged()
                  }}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: 12, padding: '0 4px', flexShrink: 0,
                  }}
                  title="移除"
                >×</button>
              </div>
            )
          })
        )}
      </div>

      <AssetPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existingIds={sources.map((s) => s.asset_id)}
        onAdd={async (ids) => {
          if (ids.length === 0) { setPickerOpen(false); return }
          await addSources(notebookId, ids)
          setPickerOpen(false)
          onChanged()
        }}
      />
    </>
  )
}

// ── AssetPickerModal ────────────────────────────────────────────────────────

function AssetPickerModal({ open, onClose, existingIds, onAdd }: {
  open: boolean
  onClose: () => void
  existingIds: number[]
  onAdd: (assetIds: number[]) => Promise<void>
}) {
  const [sources, setSources] = useState<PgSourceRow[]>([])
  const [assets, setAssets] = useState<PgAssetCard[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPicked(new Set()); setFilter(''); setErr(null); setBusy(false)
    setLoading(true)
    Promise.all([
      listPgSources(),
      listPgAssets({ limit: 200 }),
    ])
      .then(([s, a]) => { setSources(s); setAssets(a.items); setLoading(false) })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'load failed'); setLoading(false) })
  }, [open])

  const sourceById = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of sources) m.set(s.id, s.name)
    return m
  }, [sources])

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const filtered = f
      ? assets.filter((a) => a.name.toLowerCase().includes(f) || (a.tags ?? []).some((t) => t.toLowerCase().includes(f)))
      : assets
    const map = new Map<string, PgAssetCard[]>()
    for (const a of filtered) {
      const srcName = a.source_name ?? '其它'
      if (!map.has(srcName)) map.set(srcName, [])
      map.get(srcName)!.push(a)
    }
    return [...map.entries()]
  }, [assets, filter])

  if (!open) return null
  const existing = new Set(existingIds)

  function toggle(id: number) {
    if (existing.has(id)) return
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
           zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
         }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: 720, maxWidth: '92vw',
        height: 600, maxHeight: '85vh',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>添加资料到笔记本</div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>已选 {picked.size}</span>
        </div>

        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="按名字 / 标签过滤"
            style={{
              width: '100%', padding: '8px 12px',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              background: '#fff', color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px' }}>
          {loading && <div style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>加载中…</div>}
          {err && <div style={{ color: '#b91c1c', padding: 16, fontSize: 13 }}>{err}</div>}
          {!loading && !err && grouped.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>无匹配资产</div>
          )}
          {grouped.map(([srcName, list]) => (
            <div key={srcName} style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
                letterSpacing: 0.4, padding: '6px 0',
              }}>📂 {srcName} · {list.length}</div>
              {list.map((a) => {
                const inNb = existing.has(a.id)
                const checked = picked.has(a.id) || inNb
                return (
                  <label
                    key={a.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', borderRadius: 6,
                      cursor: inNb ? 'not-allowed' : 'pointer',
                      opacity: inNb ? 0.55 : 1,
                      background: picked.has(a.id) ? 'rgba(108,71,255,0.08)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={inNb}
                      onChange={() => toggle(a.id)}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>
                      {a.name}
                      {inNb && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>已添加</span>}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {a.chunks_total} chunks{a.tags?.length ? ` · ${a.tags.slice(0, 2).join(', ')}` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>

        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn primary"
                  disabled={busy || picked.size === 0}
                  onClick={async () => { setBusy(true); try { await onAdd([...picked]) } finally { setBusy(false) } }}>
            {busy ? '添加中…' : `添加 ${picked.size} 项`}
          </button>
        </div>
      </div>

      {/* sourceById 仅作 future hover tooltip 备用，避免 unused */}
      {void sourceById}
    </div>
  )
}
