/**
 * /overview —— 知识中台总览页
 * 对齐原型 uploads/dsclaw-knowledge-prototype-*.html §page-knowledge：
 *  - page-body / page-title / page-sub
 *  - kc-tabs (KnowledgeTabs 组件)
 *  - 4 个 metric-card（带 metric-top / label / val / sub）
 *  - 2 栏 surface-card：最近更新 + 我的收藏
 */
import { useQuery, useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { bsApi } from '@/api/bookstack'
import { fetchAssetItems } from '@/api/assetDirectory'
import { MetricCardsSkeleton, ListRowsSkeleton } from './Skeleton'
import KnowledgeTabs from '@/components/KnowledgeTabs'

interface Favorite { id: number; name: string; url: string }

function getFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem('kc_favorites') ?? '[]') } catch { return [] }
}

function sevenDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 7); return d
}

interface MetricProps {
  label: string
  value: number | string
  sub?: string
  pillLabel?: string
  pillClass?: 'blue' | 'amber' | 'red' | 'green' | ''
  recentCount?: number
}
function MetricCard({ label, value, sub, pillLabel, pillClass, recentCount }: MetricProps) {
  const { t } = useTranslation('overview')
  return (
    <div className="surface-card metric-card">
      <div className="metric-top">
        <div className="metric-label">{label}</div>
        {pillLabel && (
          <span className={`pill ${pillClass ?? ''}`} style={{ cursor: 'default' }}>
            {recentCount !== undefined
              ? <><span data-testid="metric-recent">{recentCount}</span>  {t('kpi.recentDays')}</>
              : pillLabel}
          </span>
        )}
      </div>
      <div className="metric-val">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

export default function Overview() {
  const navigate = useNavigate()
  const { t } = useTranslation('overview')
  // BUG-16 · 全局 staleTime=5min 会让"刚在空间管理里建的空间，回总览还是老数字"。
  // 总览是"首页概览"，期望近实时，显式把 staleTime 缩回 30s；
  // 再叠加 refetchOnMount: 'always'，用户每次切回总览都会拉一次新的。
  const overviewQueryOpts = { staleTime: 30_000, refetchOnMount: 'always' as const }
  const shelves = useQuery({ queryKey: ['shelves'], queryFn: () => bsApi.getShelves(), ...overviewQueryOpts })
  const books   = useQuery({ queryKey: ['books'],   queryFn: () => bsApi.getBooks(),   ...overviewQueryOpts })
  const pages   = useQuery({ queryKey: ['pages'],   queryFn: () => bsApi.getPages({ count: 500 }), ...overviewQueryOpts })
  const assets  = useQuery({
    queryKey: ['assetItems', 1],
    queryFn: () => fetchAssetItems(1, 200, 0).catch(() => ({ items: [], total: 0 })),
    ...overviewQueryOpts,
  })

  const shelfList = shelves.data?.data ?? []
  const shelfDetails = useQueries({
    queries: shelfList.map((s) => ({
      queryKey: ['shelf', s.id],
      queryFn:  () => bsApi.getShelf(s.id),
      enabled:  shelfList.length > 0,
    })),
  })

  const isLoading = shelves.isLoading || books.isLoading || pages.isLoading

  const pendingIngest = assets.data?.items.filter((i) => i.ingestStatus === 'not_indexed').length ?? 0
  const lowQuality = assets.data?.items.filter(
    (i) => i.ingestStatus === 'not_indexed' && i.summaryStatus === 'pending'
  ).length ?? 0

  const recentCount = pages.data?.data.filter(
    (p) => new Date(p.updated_at) >= sevenDaysAgo()
  ).length ?? 0

  const activeShelves = shelfDetails
    .filter((q) => q.data).map((q) => q.data!)
    .sort((a, b) => b.books.length - a.books.length).slice(0, 5)

  const favorites = getFavorites()

  if (shelves.isError) {
    return (
      <div className="page-body">
        <div style={{ color: 'var(--red)' }}>
          {t('errors.apiDown')}
        </div>
      </div>
    )
  }

  return (
    <div className="page-body">
      {/* Page header —— 左标题 + 右动作按钮 */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">{t('title')}</div>
          <div className="page-sub">
            {t('subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            onClick={() => navigate('/qa')}
          >{t('actions.askQuestion')}</button>
          <button className="btn" onClick={() => navigate('/search')}>{t('actions.search')}</button>
          <button className="btn" onClick={() => navigate('/spaces')} data-testid="overview-new-space">{t('actions.newSpace')}</button>
          <button
            className="btn"
            onClick={() => navigate('/ingest')}
            data-testid="overview-import-knowledge"
          >{t('actions.importKnowledge')}</button>
        </div>
      </div>

      {/* 快捷入口：问一问 / 搜一搜 / 上传与收录 */}
      <p className="kc-skip-heading">{t('quickStart.skipHeading')}</p>
      <div className="kc-user-start" role="navigation" aria-label={t('quickStart.ariaLabel')}>
        <button type="button" className="kc-start-card" onClick={() => navigate('/qa')}>
          <h3>{t('quickStart.qaTitle')}</h3>
          <p>{t('quickStart.qaDesc')}</p>
        </button>
        <button type="button" className="kc-start-card" onClick={() => navigate('/search')}>
          <h3>{t('quickStart.searchTitle')}</h3>
          <p>{t('quickStart.searchDesc')}</p>
        </button>
        <button type="button" className="kc-start-card" onClick={() => navigate('/ingest')}>
          <h3>{t('quickStart.ingestTitle')}</h3>
          <p>{t('quickStart.ingestDesc')}</p>
        </button>
      </div>

      {/* Tabs */}
      <KnowledgeTabs />

      <p className="kc-skip-heading" style={{ marginTop: 8 }}>
        {t('kpiSection')}
      </p>
      {/* 4 KPI */}
      <div className="kc-grid-4">
        {isLoading ? <MetricCardsSkeleton /> : (
          <>
            <MetricCard
              label={t('kpi.documents')}
              value={pages.data?.total ?? 0}
              pillLabel={t('kpi.documentsRecent', { count: recentCount })}
              pillClass="blue"
              recentCount={recentCount}
              sub={t('kpi.documentsSub')}
            />
            <MetricCard
              label={t('kpi.spaces')}
              value={shelves.data?.total ?? 0}
              pillLabel={t('kpi.spacesPill', { count: shelves.data?.total ?? 0 })}
              sub={t('kpi.spacesSub')}
            />
            <MetricCard
              label={t('kpi.ingestPending')}
              value={pendingIngest}
              pillLabel={pendingIngest > 0 ? t('kpi.ingestProcessing') : t('kpi.ingestAllDone')}
              pillClass={pendingIngest > 0 ? 'amber' : 'green'}
              sub={t('kpi.ingestPendingSub')}
            />
            <MetricCard
              label={t('kpi.anomaly')}
              value={lowQuality}
              pillLabel={lowQuality > 0 ? t('kpi.anomalyNeedsReview') : t('kpi.anomalyNoIssue')}
              pillClass={lowQuality > 0 ? 'red' : 'green'}
              sub={t('kpi.anomalySub')}
            />
          </>
        )}
      </div>

      {/* 两栏：最近更新 + 我的收藏 */}
      <div className="kc-grid-2">
        {/* 最近更新 */}
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <div className="panel-title">{t('panels.recentUpdates')}</div>
            <div style={{ flex: 1 }} />
            <button
              className="btn ghost"
              onClick={() => navigate('/search')}
              style={{ color: 'var(--p)', fontWeight: 800 }}
            >
              {t('panels.goSearch')}
            </button>
          </div>
          {pages.isLoading ? (
            <ListRowsSkeleton />
          ) : !pages.data || pages.data.data.length === 0 ? (
            <div className="empty-state">
              <span className="empty-illus">📄</span>
              <p className="empty-text">{t('empty.noDocs')}</p>
            </div>
          ) : (
            pages.data.data.slice(0, 8).map((page) => (
              <a
                key={page.id}
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="list-row"
                style={{ textDecoration: 'none' }}
              >
                <div style={{ fontSize: 16 }}>📄</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-title" style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{page.name}</div>
                  <div className="list-meta">
                    <span className="pill" style={{ cursor: 'default' }}>BookStack</span>
                    {page.book_id && <span>{t('panels.bookPrefix', { id: page.book_id })}</span>}
                  </div>
                </div>
                <div className="list-right">
                  {new Date(page.updated_at).toLocaleDateString()}
                </div>
              </a>
            ))
          )}
        </div>

        {/* 我的收藏 */}
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <div className="panel-title">{t('panels.myFavorites')}</div>
          </div>
          {favorites.length === 0 ? (
            <div className="empty-state">
              <span className="empty-illus">⭐</span>
              <p className="empty-text">{t('empty.noFavorites')}</p>
              <button className="btn" onClick={() => navigate('/search')}>{t('panels.goSearchPlain')}</button>
            </div>
          ) : (
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              {favorites.map((fav) => (
                <a
                  key={fav.id}
                  href={fav.url}
                  target="_blank"
                  rel="noreferrer"
                  className="surface-card"
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    padding: 12, borderRadius: 12, textDecoration: 'none', display: 'block',
                  }}
                >
                  <div style={{ fontWeight: 900, color: 'var(--text)', marginBottom: 6 }}>{fav.name}</div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* 活跃空间 Top5 */}
        <div className="surface-card" style={{ gridColumn: '1 / -1', overflow: 'hidden' }}>
          <div className="panel-head">
            <div className="panel-title">{t('panels.activeSpaces')}</div>
          </div>
          {shelfDetails.some((q) => q.isLoading) ? <ListRowsSkeleton count={5} /> : (
            activeShelves.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illus">🗂</span>
                <p className="empty-text">{t('empty.noShelves')}</p>
              </div>
            ) : (
              (() => {
                // BUG-21 · 同名空间加 #id 区分；不同名保持原样
                // 名字归一化：NFC unicode + 折叠空白 + trim，避免 "测试" 与 "测试 " 被判为不同名
                const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()
                const nameCount = new Map<string, number>()
                for (const s of activeShelves) {
                  const k = norm(s.name)
                  nameCount.set(k, (nameCount.get(k) ?? 0) + 1)
                }
                return activeShelves.map((shelf) => {
                  const dupName = (nameCount.get(norm(shelf.name)) ?? 0) > 1
                  return (
                    <div key={shelf.id} className="list-row" data-testid="active-shelf-item">
                      <div style={{ fontSize: 16 }}>🗂</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="list-title">
                          {shelf.name}
                          {dupName && (
                            <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>
                              #{shelf.id}
                            </span>
                          )}
                        </div>
                        <div className="list-meta">
                          <span className="pill blue" style={{ cursor: 'default' }}>{t('panels.spaceBooksCount', { count: shelf.books.length })}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
              })()
            )
          )}
        </div>
      </div>
    </div>
  )
}
