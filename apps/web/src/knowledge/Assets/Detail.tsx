/**
 * /assets/:id —— PRD §10.3 资产详情页
 * 对齐原型 §page-knowledge-asset-detail：
 *  - topbar-crumb 面包屑 + page-title + 返回目录/配置权限
 *  - banner（类型/状态/更新/规模）
 *  - kc-subtabs: 资产列表 / RAGFlow 摘要 / 知识图谱
 *  - surface-card 内容壳，各 Tab 子组件复用
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { getPgAssetDetail, deleteAsset, type PgAssetDetail } from '@/api/assetDirectory'
import DetailAssets from './DetailAssets'
import DetailRagflow from './DetailRagflow'
import DetailGraph from './DetailGraph'
import PermissionsDrawer from '@/knowledge/_shared/PermissionsDrawer'
import RequirePermission from '@/auth/RequirePermission'

type Tab = 'assets' | 'ragflow' | 'graph'

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('assets')
  const { t: tNav } = useTranslation('nav')
  const [tab, setTab] = useState<Tab>('assets')
  const [detail, setDetail] = useState<PgAssetDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // F-2 权限抽屉
  const [permOpen, setPermOpen] = useState(false)
  // ADR-30 · 删除状态
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    getPgAssetDetail(Number(id))
      .then((r) => { setDetail(r); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || t('detail.loadFailed')))
      .finally(() => setLoading(false))
  }, [id, t])
  useEffect(() => { load() }, [load])

  const handleDelete = useCallback(async () => {
    if (!detail) return
    const ok = window.confirm(
      t('detail.deleteAssetConfirm', {
        name: detail.asset.name,
        chunks: detail.chunks.total,
        images: detail.images.length,
      }),
    )
    if (!ok) return
    setDeleting(true)
    try {
      await deleteAsset(detail.asset.id)
      navigate('/assets')
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message || t('card.deleteFailed')
      window.alert(t('detail.deleteFailedAlert', { msg }))
      setDeleting(false)
    }
  }, [detail, navigate, t])

  return (
    <div className="page-body">
      {/* Breadcrumb + header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="topbar-crumb" style={{ marginBottom: 8 }}>
            <span style={{ cursor: 'pointer' }} onClick={() => navigate('/overview')}>{tNav('brand')}</span>
            <span style={{ margin: '0 6px' }}>›</span>
            <span style={{ cursor: 'pointer' }} onClick={() => navigate('/assets')}>{t('title')}</span>
            <span style={{ margin: '0 6px' }}>›</span>
            <span className="crumb-now">{detail?.asset.name ?? '…'}</span>
          </div>
          <div className="page-title" style={{ marginBottom: 4 }}>
            {detail?.asset.name ?? t('detail.loading')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/assets')}>{t('detail.backToList')}</button>
          <RequirePermission name="iam:manage">
            <button
              className="btn primary"
              onClick={() => setPermOpen(true)}
              title={t('detail.permButtonTitle')}
              data-testid="perm-btn-asset"
              style={{ whiteSpace: 'nowrap' }}
            >
              {t('detail.permButton')}
            </button>
          </RequirePermission>
          {detail && (
            <RequirePermission name="iam:manage">
              <button
                className="btn"
                onClick={handleDelete}
                disabled={deleting}
                title={t('detail.deleteAssetTitle')}
                data-testid="delete-btn-asset"
                style={{
                  whiteSpace: 'nowrap',
                  color: 'var(--red, #dc2626)',
                  borderColor: 'var(--red, #dc2626)',
                }}
              >
                {deleting ? t('detail.deleting') : t('detail.deleteAssetBtn')}
              </button>
            </RequirePermission>
          )}
        </div>
      </div>

      <KnowledgeTabs />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{t('detail.loading')}</div>
      ) : err ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: 'var(--red)', marginBottom: 8 }}>⚠ {err}</div>
          <button className="btn" onClick={() => navigate('/assets')}>{t('detail.backToList')}</button>
        </div>
      ) : detail ? (
        <>
          {/* Banner */}
          <Banner detail={detail} />

          <div style={{ height: 12 }} />

          {/* 3 Tab */}
          <div className="kc-subtabs">
            {([
              { id: 'assets'  as const, labelKey: 'detail.tabAssets' },
              { id: 'ragflow' as const, labelKey: 'detail.tabRagflow' },
              { id: 'graph'   as const, labelKey: 'detail.tabGraph' },
            ]).map((sub) => (
              <button
                key={sub.id}
                onClick={() => setTab(sub.id)}
                className={`kc-subtab${tab === sub.id ? ' active' : ''}`}
              >
                {t(sub.labelKey)}
              </button>
            ))}
          </div>

          <div className="surface-card" style={{ padding: 14 }}>
            {tab === 'assets'  && <DetailAssets detail={detail} />}
            {tab === 'ragflow' && <DetailRagflow detail={detail} />}
            {tab === 'graph'   && <DetailGraph detail={detail} />}
          </div>
        </>
      ) : null}
      {/* F-2 权限抽屉 */}
      {detail && (
        <PermissionsDrawer
          open={permOpen}
          resourceKind="asset"
          resourceId={detail.asset.id}
          resourceName={detail.asset.name}
          onClose={() => setPermOpen(false)}
        />
      )}
    </div>
  )
}

function Banner({ detail }: { detail: PgAssetDetail }) {
  const { t } = useTranslation('assets')
  const a = detail.asset
  const statusLabel = a.indexed_at ? t('status.ok') : t('status.pending')
  const updateStr = a.indexed_at
    ? new Date(a.indexed_at).toLocaleString()
    : '—'

  // ADR-32 · 解析诊断
  const breakdown = a.ingest_chunks_by_kind ?? {}
  const breakdownEntries = Object.entries(breakdown).filter(([, n]) => (n as number) > 0)
  const warnings = a.ingest_warnings ?? []
  const hasDiag = !!a.extractor_id || breakdownEntries.length > 0 || warnings.length > 0

  return (
    <div className="banner">
      <div className="banner-title">{t('detail.banner.overview')}</div>
      <div className="banner-sub">
        {t('detail.banner.metaLine', { type: a.type || '—', status: statusLabel, time: updateStr })}
        {t('detail.banner.chunksSuffix', { count: detail.chunks.total })}
        {detail.images.length > 0 && t('detail.banner.imagesSuffix', { count: detail.images.length })}
        {detail.source.name && t('detail.banner.sourceSuffix', { name: detail.source.name })}
      </div>

      {/* ADR-32 · 解析诊断行 —— 让用户直接看到 extractorId / chunks 分类 / warnings */}
      {hasDiag && (
        <div
          className="banner-sub"
          style={{
            marginTop: 6,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 12,
            opacity: 0.85,
          }}
          data-testid="ingest-diagnostics"
        >
          {a.extractor_id && (
            <span>
              {t('detail.banner.extractor')}<strong style={{ fontFamily: 'monospace' }}>{a.extractor_id}</strong>
            </span>
          )}
          {breakdownEntries.length > 0 && (
            <span>
              {t('detail.banner.chunkBreakdown')}{breakdownEntries.map(([k, n]) => `${k} ${n}`).join(' · ')}
            </span>
          )}
          {a.external_path && (
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {a.external_path}
            </span>
          )}
          {warnings.length > 0 && (
            <span
              style={{ color: 'var(--amber, #d97706)' }}
              title={warnings.join('\n')}
            >
              {t('detail.banner.warningsSummary', { count: warnings.length })}
            </span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <details style={{ marginTop: 8, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--amber, #d97706)' }}>
            {t('detail.banner.warningsToggle', { count: warnings.length })}
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(a.tags?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {a.tags.map((tg) => (
            <span key={tg} className="pill" style={{ cursor: 'default' }}>
              {t('detail.banner.tagPrefix', { tag: tg })}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
