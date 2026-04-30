/**
 * /notebooks —— Notebook 列表
 *
 * 每个 user 看到自己创建的 notebooks（owner_email 过滤已在后端做）。
 * 「+ 新建笔记本」弹窗 → 创建后跳详情页填资料。
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import {
  listNotebooks, createNotebook, deleteNotebook, listTemplates,
  getUserTemplatesMeta, deleteUserTemplate,
  type NotebookSummary, type NotebookTemplateSpec,
} from '@/api/notebooks'
import CreateTemplateModal from './CreateTemplateModal'
import MyTemplateActions from './MyTemplateActions'

export default function NotebooksPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('notebook')
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
          <div className="page-title">{t('list.title')}</div>
          <div className="page-sub">
            {t('list.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>{t('list.backToOverview')}</button>
          <button className="btn primary" onClick={() => setCreateOpen(true)}>{t('list.newButton')}</button>
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
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>
          {t('common:states.loading')}
        </div>
      ) : items.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', color: 'var(--muted)',
          background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📓</div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>{t('list.emptyOwned')}</div>
        </div>
      ) : (
        <>
          <div style={{
            fontSize: 12, color: 'var(--muted)', margin: '14px 4px 6px',
            textTransform: 'uppercase', letterSpacing: 0.4,
          }}>{t('list.ownedHeading', { count: items.length })}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}>
            {items.map((nb) => (
              <NotebookCard
                key={nb.id} nb={nb}
                onOpen={() => navigate(`/notebooks/${nb.id}`)}
                onDelete={async () => {
                  if (!confirm(t('list.deleteConfirm', { name: nb.name }))) return
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
              }}>{t('list.sharedHeading', { count: shared.length })}</div>
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
function useDisplayName() {
  const { t } = useTranslation('notebook')
  return (nb: NotebookSummary): string => {
    const n = (nb.name ?? '').trim()
    return n || t('list.untitled', { id: nb.id })
  }
}

function NotebookCard({ nb, onOpen, onDelete }: {
  nb: NotebookSummary; onOpen: () => void; onDelete?: () => void
}) {
  const { t } = useTranslation('notebook')
  const displayName = useDisplayName()
  // BUG-15 守护：updated_at_ms 缺失 / NaN 时不要渲染 "NaN/NaN NaN:NaN"
  const updated = nb.updated_at_ms ? new Date(nb.updated_at_ms) : null
  const hasValidTime = updated !== null && !Number.isNaN(updated.getTime())
  const accessTone = nb.access === 'owner' ? null
    : nb.access === 'editor'
      ? { bg: 'rgba(108,71,255,0.1)', color: 'var(--p,#6C47FF)', label: t('list.accessEditor') }
      : { bg: '#f3f4f6', color: 'var(--muted)', label: t('list.accessReader') }
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
            title={t('common:actions.delete')}
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
        <span>📎 {t('card.sources', { count: nb.source_count })}</span>
        <span>💬 {t('card.messages', { count: nb.message_count })}</span>
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
  const { t } = useTranslation('notebook')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // N-006/N-007：模板选择（id widening 到 string 容纳 community/user 模板）
  const [templates, setTemplates] = useState<NotebookTemplateSpec[]>([])
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null)
  // N-008：用户自定义模板入口（受 USER_TEMPLATES_ENABLED 守卫）
  const [userTplEnabled, setUserTplEnabled] = useState(false)
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [tplEditing, setTplEditing] = useState<NotebookTemplateSpec | undefined>(undefined)
  // hover state for MyTemplateActions
  const [hoverTplId, setHoverTplId] = useState<string | null>(null)

  async function reloadTemplates() {
    try {
      const all = await listTemplates()
      setTemplates(all)
    } catch {
      setTemplates([])
    }
  }

  useEffect(() => {
    if (open) {
      setName(''); setDesc(''); setErr(null); setBusy(false); setPickedTemplate(null)
      void reloadTemplates()
      // 探 N-008 enabled flag；失败时降级到 disabled
      getUserTemplatesMeta()
        .then((m) => setUserTplEnabled(m.enabled))
        .catch(() => setUserTplEnabled(false))
    }
  }, [open])
  if (!open) return null

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setErr(t('createModal.errors.nameRequired')); return }
    setBusy(true); setErr(null)
    try {
      const r = await createNotebook({
        name: trimmed,
        description: desc.trim() || undefined,
        template_id: pickedTemplate,
      })
      onCreated(r.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:errors.createFailed'))
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
          {t('createModal.title')}
        </div>

        {/* N-006/N-007/N-008：模板选择器（"📄 空白" + 6 system + community + 自己的 user）*/}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <Label>{t('createModal.templateSection')}</Label>
            {userTplEnabled && (
              <button type="button"
                      onClick={() => { setTplEditing(undefined); setTplModalOpen(true) }}
                      style={{
                        marginLeft: 'auto', fontSize: 11, padding: '2px 10px',
                        border: '1px dashed var(--border)', background: 'transparent',
                        color: 'var(--p, #6C47FF)', borderRadius: 999, cursor: 'pointer',
                      }}>{t('createModal.createMyTemplate')}</button>
            )}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8, marginTop: 6,
          }}>
            <TemplateOption
              icon={t('createModal.blankIcon')}
              label={t('createModal.blankLabel')}
              desc={t('createModal.blankDesc')}
              picked={pickedTemplate === null}
              source={null}
              onClick={() => setPickedTemplate(null)}
            />
            {templates.map((tpl) => {
              const isMine = tpl.source === 'user'
              return (
                <TemplateOption
                  key={tpl.id}
                  icon={tpl.icon} label={tpl.label} desc={tpl.desc}
                  picked={pickedTemplate === tpl.id}
                  source={tpl.source}
                  onClick={() => setPickedTemplate(tpl.id)}
                  onMouseEnter={() => setHoverTplId(tpl.id)}
                  onMouseLeave={() => setHoverTplId((cur) => cur === tpl.id ? null : cur)}
                  actions={isMine ? (
                    <MyTemplateActions
                      template={tpl}
                      visible={hoverTplId === tpl.id}
                      onEdit={(spec) => { setTplEditing(spec); setTplModalOpen(true) }}
                      onDelete={async (spec) => {
                        try {
                          await deleteUserTemplate(spec.id)
                          if (pickedTemplate === spec.id) setPickedTemplate(null)
                          await reloadTemplates()
                        } catch (e) {
                          const msg = (e as { response?: { data?: { error?: string } } })
                            ?.response?.data?.error
                          setErr(msg ?? (e instanceof Error ? e.message : t('common:errors.deleteFailed')))
                        }
                      }}
                    />
                  ) : null}
                />
              )
            })}
          </div>
        </div>

        {/* N-008：创建/编辑用户模板 modal */}
        {userTplEnabled && (
          <CreateTemplateModal
            open={tplModalOpen}
            mode={tplEditing ? 'edit' : 'create'}
            initial={tplEditing}
            onClose={() => { setTplModalOpen(false); setTplEditing(undefined) }}
            onSaved={async (spec) => {
              setTplModalOpen(false); setTplEditing(undefined)
              await reloadTemplates()
              setPickedTemplate(spec.id)   // 创建/编辑后自动选中
            }}
          />
        )}

        <div style={{ marginBottom: 12 }}>
          <Label>{t('createModal.nameLabel')} <span style={{ color: '#dc2626' }}>*</span></Label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder={t('createModal.namePlaceholder')}
                 style={fieldStyle} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Label>{t('createModal.descLabel')}</Label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
                    rows={3} placeholder={t('createModal.descPlaceholder')}
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{
          padding: 10, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common:actions.cancel')}
          </button>
          <button type="button" className="btn primary"
                  disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? t('common:states.creating') : t('common:actions.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TemplateOption({
  icon, label, desc, picked, source, onClick,
  onMouseEnter, onMouseLeave, actions,
}: {
  icon: string; label: string; desc: string; picked: boolean
  /** N-008: 'system' / 'community' / 'user' / null（空白） */
  source: 'system' | 'community' | 'user' | null
  onClick: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** N-008: hover-only 编辑/删除按钮（自己的 user 模板才传） */
  actions?: React.ReactNode
}) {
  const { t } = useTranslation('notebook')
  const sourceLabel =
    source === 'user' ? t('templateOption.sourceMine')
    : source === 'community' ? t('templateOption.sourceCommunity')
    : null   // system / null 不显示角标

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={onClick}
        title={desc}
        style={{
          width: '100%',
          background: picked ? 'rgba(108, 71, 255, 0.06)' : '#fff',
          border: `1px solid ${picked ? 'var(--p, #6C47FF)' : 'var(--border)'}`,
          borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
          textAlign: 'left',
          boxShadow: picked ? '0 0 0 2px rgba(108,71,255,0.15)' : 'none',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {icon} {label}
          </span>
          {sourceLabel && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: source === 'user' ? 'rgba(108, 71, 255, 0.12)' : 'rgba(34, 197, 94, 0.12)',
              color: source === 'user' ? 'var(--p, #6C47FF)' : '#15803d',
              fontWeight: 500,
            }}>{sourceLabel}</span>
          )}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--muted)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {desc}
        </div>
      </button>
      {actions}
    </div>
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
