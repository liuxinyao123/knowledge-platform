/**
 * /notebooks —— Notebook 列表
 *
 * 每个 user 看到自己创建的 notebooks（owner_email 过滤已在后端做）。
 * 「+ 新建笔记本」弹窗 → 创建后跳详情页填资料。
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import {
  listNotebooks, createNotebook, deleteNotebook, listTemplates,
  type NotebookSummary, type NotebookTemplateId, type NotebookTemplateSpec,
} from '@/api/notebooks'

export default function NotebooksPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<NotebookSummary[] | null>(null)
  const [shared, setShared] = useState<NotebookSummary[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const r = await listNotebooks()
      setItems(r.items); setShared(r.shared); setErr(null)
    } catch (e) {
      setItems((prev) => prev ?? [])
      const msg = e instanceof Error ? e.message : 'load failed'
      setErr(/404/.test(msg)
        ? `${msg} —— /api/notebooks 不存在；qa-service 需要重启 (pnpm dev:down && pnpm dev:up)，且确认 vite proxy 已加 /api/notebooks`
        : msg)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  return (
    <div className="page-body">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">笔记本</div>
          <div className="page-sub">
            为每个研究任务建一个 notebook，挑入资料后做 scope 内的对话与简报
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回总览</button>
          <button className="btn primary" onClick={() => setCreateOpen(true)}>+ 新建笔记本</button>
        </div>
      </div>

      <KnowledgeTabs />

      {err && (
        <div style={{
          padding: 12, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13,
        }}>{err}</div>
      )}

      {items == null ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
      ) : items.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', color: 'var(--muted)',
          background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📓</div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>还没有任何笔记本</div>
          <div style={{ fontSize: 12 }}>点右上角「+ 新建笔记本」开始</div>
        </div>
      ) : (
        <>
          <div style={{
            fontSize: 12, color: 'var(--muted)', margin: '14px 4px 6px',
            textTransform: 'uppercase', letterSpacing: 0.4,
          }}>我的（{items.length}）</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}>
            {items.map((nb) => (
              <NotebookCard
                key={nb.id} nb={nb}
                onOpen={() => navigate(`/notebooks/${nb.id}`)}
                onDelete={async () => {
                  if (!confirm(`删除「${nb.name}」？所有 sources / chat / 简报都会一起删除。`)) return
                  await deleteNotebook(nb.id)
                  void reload()
                }}
              />
            ))}
          </div>

          {shared.length > 0 && (
            <>
              <div style={{
                fontSize: 12, color: 'var(--muted)', margin: '24px 4px 6px',
                textTransform: 'uppercase', letterSpacing: 0.4,
              }}>共享给我的（{shared.length}）</div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 14,
              }}>
                {shared.map((nb) => (
                  <NotebookCard
                    key={nb.id} nb={nb}
                    onOpen={() => navigate(`/notebooks/${nb.id}`)}
                    /* 共享给我的不能删，只能 owner 删 */
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <CreateNotebookModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); navigate(`/notebooks/${id}`) }}
      />
    </div>
  )
}

/** 兜底：name 为空 / 只含空白 时给一个可视化占位 */
function displayName(nb: NotebookSummary): string {
  const n = (nb.name ?? '').trim()
  return n || `（未命名 · #${nb.id}）`
}

function NotebookCard({ nb, onOpen, onDelete }: {
  nb: NotebookSummary; onOpen: () => void; onDelete?: () => void
}) {
  // BUG-15 守护：updated_at_ms 缺失 / NaN 时不要渲染 "NaN/NaN NaN:NaN"
  const updated = nb.updated_at_ms ? new Date(nb.updated_at_ms) : null
  const hasValidTime = updated !== null && !Number.isNaN(updated.getTime())
  const accessTone = nb.access === 'owner' ? null
    : nb.access === 'editor' ? { bg: 'rgba(108,71,255,0.1)', color: 'var(--p,#6C47FF)', label: '可编辑' }
    : { bg: '#f3f4f6', color: 'var(--muted)', label: '只读' }
  return (
    <div
      style={{
        background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
        padding: 16, cursor: 'pointer', transition: 'border-color 0.15s, transform 0.15s',
      }}
      onClick={onOpen}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--p, #6C47FF)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>📓 {displayName(nb)}</div>
        {accessTone && (
          <span style={{
            padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 500,
            background: accessTone.bg, color: accessTone.color, whiteSpace: 'nowrap',
          }}>{accessTone.label}</span>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            style={{
              background: 'transparent', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', fontSize: 14, padding: '0 4px',
            }}
            title="删除"
          >×</button>
        )}
      </div>
      {nb.description && (
        <div style={{
          fontSize: 12, color: 'var(--muted)', marginBottom: 10,
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{nb.description}</div>
      )}
      <div style={{
        display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)',
        paddingTop: 8, borderTop: '1px dashed var(--border)',
      }}>
        <span>📎 {nb.source_count} 资料</span>
        <span>💬 {nb.message_count} 消息</span>
        <span style={{ marginLeft: 'auto' }}>
          {hasValidTime
            ? `${updated!.getMonth() + 1}/${updated!.getDate()} ${String(updated!.getHours()).padStart(2, '0')}:${String(updated!.getMinutes()).padStart(2, '0')}`
            : '—'}
        </span>
      </div>
    </div>
  )
}

function CreateNotebookModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // N-006：模板选择
  const [templates, setTemplates] = useState<NotebookTemplateSpec[]>([])
  const [pickedTemplate, setPickedTemplate] = useState<NotebookTemplateId | null>(null)

  useEffect(() => {
    if (open) {
      setName(''); setDesc(''); setErr(null); setBusy(false); setPickedTemplate(null)
      // 拉模板列表（首次或重开都拉，后端有 1h cache）
      listTemplates().then(setTemplates).catch(() => setTemplates([]))
    }
  }, [open])
  if (!open) return null

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('请输入名称'); return }
    setBusy(true); setErr(null)
    try {
      const r = await createNotebook({
        name: trimmed,
        description: desc.trim() || undefined,
        template_id: pickedTemplate,
      })
      onCreated(r.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
      setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
           zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
         }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '92vw',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
          新建笔记本
        </div>

        {/* N-006：模板选择器（含"📄 空白"兜底）*/}
        <div style={{ marginBottom: 16 }}>
          <Label>选择模板（可选）</Label>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8, marginTop: 6,
          }}>
            <TemplateOption
              icon="📄" label="空白" desc="从零开始"
              picked={pickedTemplate === null}
              onClick={() => setPickedTemplate(null)}
            />
            {templates.map((t) => (
              <TemplateOption
                key={t.id}
                icon={t.icon} label={t.label} desc={t.desc}
                picked={pickedTemplate === t.id}
                onClick={() => setPickedTemplate(t.id)}
              />
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <Label>名称 <span style={{ color: '#dc2626' }}>*</span></Label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="如：举升门温度补偿调研"
                 style={fieldStyle} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Label>描述（选填）</Label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
                    rows={3} placeholder="这个笔记本要解决什么问题"
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{
          padding: 10, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn primary"
                  disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TemplateOption({ icon, label, desc, picked, onClick }: {
  icon: string; label: string; desc: string; picked: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={desc}
      style={{
        background: picked ? '#eff6ff' : '#fff',
        border: `1px solid ${picked ? 'var(--p, #6C47FF)' : 'var(--border)'}`,
        borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
        textAlign: 'left',
        boxShadow: picked ? '0 0 0 2px rgba(108,71,255,0.15)' : 'none',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {icon} {label}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--muted)', marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {desc}
      </div>
    </button>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 13, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{
    fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 4,
  }}>{children}</div>
}
