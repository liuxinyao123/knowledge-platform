/**
 * /assets —— PRD §10.2 资产目录（列表）
 * 对齐原型 §page-knowledge-assets：
 *  - page-body / page-title / page-sub + 右侧 btn/btn primary
 *  - KnowledgeTabs + kc-subtabs（知识治理/资产目录/数据权限）
 *  - 搜索+类型筛选卡
 *  - kc-grid-2 + asset-card/asset-head/asset-ico/asset-name/status-pill/asset-meta-grid/asset-k/asset-v
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { listPgAssets, deleteAsset, type PgAssetCard } from '@/api/assetDirectory'
import { listSpaces, type SpaceSummary } from '@/api/spaces'
import RequirePermission from '@/auth/RequirePermission'

const TYPE_FILTERS = [
  { id: '',           labelKey: 'typeFilters.all' },
  { id: 'structured', labelKey: 'typeFilters.structured' },
  { id: 'document',   labelKey: 'typeFilters.document' },
  { id: 'online',     labelKey: 'typeFilters.online' },
] as const

function typeIcon(t: string): string {
  if (t === 'structured') return '🗄'
  if (t === 'online')     return '📄'
  return '📁'   // document / fallback
}

export default function Assets() {
  const navigate = useNavigate()
  const { t } = useTranslation('assets')

  // 类型 / 状态 / 时间格式化都依赖 i18n，放在组件内
  const typeLabel = (kind: string): string => {
    if (kind === 'structured') return t('typeFilters.structured')
    if (kind === 'online')     return t('typeFilters.online')
    if (kind === 'document')   return t('typeFilters.document')
    return kind || t('typeFilters.fallbackDash')
  }

  const statusKind = (card: PgAssetCard): { cls: 'ok' | 'proc'; text: string } => {
    if (card.indexed_at) return { cls: 'ok', text: t('status.ok') }
    return { cls: 'proc', text: t('status.pending') }
  }

  const fmtTime = (iso: string | null): string => {
    if (!iso) return t('time.notIndexed')
    const ms = Date.now() - new Date(iso).getTime()
    const m = Math.floor(ms / 60000)
    if (m < 1)  return t('time.justNow')
    if (m < 60) return t('time.minutes', { n: m })
    const h = Math.floor(m / 60)
    if (h < 24) return t('time.hours', { n: h })
    return t('time.days', { n: Math.floor(h / 24) })
  }

  const [type, setType] = useState<string>('')
  const [kw, setKw] = useState<string>('')
  const [spaceId, setSpaceId] = useState<number | null>(null)
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [items, setItems] = useState<PgAssetCard[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    listPgAssets({
      type: type || undefined,
      spaceId: spaceId ?? undefined,
      limit: 100,
    })
      .then((r) => { setItems(r.items); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || t('list.loadFailed')))
      .finally(() => setLoading(false))
  }, [type, spaceId, t])
  useEffect(() => { load() }, [load])

  // 拉空间列表给筛选器用（只拉一次）
  useEffect(() => {
    listSpaces().then(setSpaces).catch(() => setSpaces([]))
  }, [])

  const filtered = items?.filter((a) =>
    !kw.trim() ? true :
      a.name.toLowerCase().includes(kw.trim().toLowerCase())
      || (a.tags ?? []).some((t) => t.toLowerCase().includes(kw.trim().toLowerCase())),
  ) ?? null

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">{t('title')}</div>
          <div className="page-sub">{t('subtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>{t('backToOverview')}</button>
          <button className="btn primary" onClick={() => navigate('/ingest')}>{t('newSource')}</button>
        </div>
      </div>

      <KnowledgeTabs />

      {/* 三联 subtabs —— 治理域导航 */}
      <div className="kc-subtabs">
        <button className="kc-subtab" onClick={() => navigate('/governance')}>{t('subtabs.governance')}</button>
        <button className="kc-subtab active">{t('subtabs.assets')}</button>
        <button className="kc-subtab" onClick={() => navigate('/iam')}>{t('subtabs.iam')}</button>
      </div>

      {/* 搜索 + 空间 + 类型筛选 */}
      <div className="surface-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input
              className="field"
              placeholder={t('search.placeholder')}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </div>
          <select
            value={spaceId == null ? '' : String(spaceId)}
            onChange={(e) => {
              const v = e.target.value
              setSpaceId(v === '' ? null : Number(v))
            }}
            style={{
              padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 13, background: '#fff', minWidth: 180,
            }}
          >
            <option value="">{t('search.spaceAll')}</option>
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.visibility === 'private' ? '🔒 ' : '📁 '}{sp.name}
              </option>
            ))}
          </select>
          {kw && <button className="pill" onClick={() => setKw('')}>{t('search.clear')}</button>}
        </div>
        <div style={{ height: 10 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setType(f.id)}
              className={`kc-subtab${type === f.id ? ' active' : ''}`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 资产卡网格 */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{t('list.loading')}</div>
      ) : err ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ color: 'var(--red)', marginBottom: 8 }}>⚠ {err}</div>
          <button className="btn" onClick={load}>{t('list.retry')}</button>
        </div>
      ) : !filtered || filtered.length === 0 ? (
        <div className="empty-state" style={{
          padding: 60, background: '#f9fafb',
          border: '1px dashed var(--border)', borderRadius: 12,
        }}>
          <div className="empty-illus">📦</div>
          <div className="empty-text">{t('list.empty')}</div>
          {(kw || type || spaceId != null) && (
            <button className="btn" onClick={() => { setKw(''); setType(''); setSpaceId(null) }}>{t('list.clearFilters')}</button>
          )}
        </div>
      ) : (
        <div className="kc-grid-2">
          {filtered.map((card) => {
            const status = statusKind(card)
            const onRowDelete = async (e: React.MouseEvent) => {
              e.stopPropagation()  // 不要触发卡片的 onClick 跳转
              const imagesPart = card.images_total ? t('card.deleteImagesPart', { count: card.images_total }) : ''
              const ok = window.confirm(
                t('card.deleteConfirm', { name: card.name, chunks: card.chunks_total, imagesPart }),
              )
              if (!ok) return
              try {
                await deleteAsset(card.id)
                // 本地乐观更新，不等重新拉
                setItems((prev) => (prev ? prev.filter((c) => c.id !== card.id) : prev))
              } catch (err) {
                const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
                  || (err as { message?: string })?.message || t('card.deleteFailed')
                window.alert(t('card.deleteFailedAlert', { msg }))
              }
            }
            return (
              <div
                key={card.id}
                className="asset-card"
                onClick={() => navigate(`/assets/${card.id}`)}
              >
                <div className="asset-head">
                  <div className="asset-ico">{typeIcon(card.type)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="asset-name"
                      style={{
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={card.name}
                    >
                      {card.name}
                    </div>
                  </div>
                  <div className={`status-pill ${status.cls}`}>
                    <span className="status-dot" />
                    {status.text}
                  </div>
                  <RequirePermission name="iam:manage">
                    <button
                      className="btn"
                      onClick={onRowDelete}
                      title={t('card.deleteTitle')}
                      aria-label={t('card.deleteAria', { name: card.name })}
                      data-testid={`delete-btn-card-${card.id}`}
                      style={{
                        marginLeft: 8,
                        padding: '2px 8px',
                        fontSize: 12,
                        color: 'var(--red, #dc2626)',
                        borderColor: 'var(--red, #dc2626)',
                      }}
                    >
                      🗑
                    </button>
                  </RequirePermission>
                </div>
                <div className="asset-meta-grid">
                  <div>
                    <div className="asset-k">{t('card.type')}</div>
                    <div className="asset-v">{typeLabel(card.type)}</div>
                  </div>
                  <div>
                    <div className="asset-k">{t('card.updated')}</div>
                    <div className="asset-v">{fmtTime(card.indexed_at)}</div>
                  </div>
                  <div>
                    <div className="asset-k">{t('card.scale')}</div>
                    <div className="asset-v">
                      {t('card.scaleChunks', { count: card.chunks_total })}
                      {card.images_total ? t('card.scaleImagesSuffix', { count: card.images_total }) : ''}
                    </div>
                  </div>
                </div>
                {card.tags && card.tags.length > 0 && (
                  <div className="tag-row">
                    {card.tags.slice(0, 5).map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
