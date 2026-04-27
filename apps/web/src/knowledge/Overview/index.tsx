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
  return (
    <div className="surface-card metric-card">
      <div className="metric-top">
        <div className="metric-label">{label}</div>
        {pillLabel && (
          <span className={`pill ${pillClass ?? ''}`} style={{ cursor: 'default' }}>
            {recentCount !== undefined
              ? <><span data-testid="metric-recent">{recentCount}</span>  近 7 天</>
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
          API 连接失败。请确认 BookStack（:6875）与 qa-service（:3001）已运行，且服务端已配置 BookStack Token。
        </div>
      </div>
    )
  }

  return (
    <div className="page-body">
      {/* Page header —— 左标题 + 右动作按钮（对齐原型「运行概览」） */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">运行概览</div>
          <div className="page-sub">
            先想「我要做什么」：问清楚、找得到、放得进；数字概览给需要盯盘的人看。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            onClick={() => navigate('/qa')}
          >问一个问题</button>
          <button className="btn" onClick={() => navigate('/search')}>搜资料</button>
          <button className="btn" onClick={() => navigate('/spaces')} data-testid="overview-new-space">+ 新建空间</button>
          <button
            className="btn"
            onClick={() => navigate('/ingest')}
            data-testid="overview-import-knowledge"
          >导入知识</button>
        </div>
      </div>

      {/* 快捷入口：问一问 / 搜一搜 / 上传与收录 */}
      <p className="kc-skip-heading">想不起来点哪？从下面选一件最常见的事</p>
      <div className="kc-user-start" role="navigation" aria-label="快捷入口">
        <button type="button" className="kc-start-card" onClick={() => navigate('/qa')}>
          <h3>问一问</h3>
          <p>用自然语言提问，看引用片段与来源，适合「这规定怎么说」「有没有先例」。</p>
        </button>
        <button type="button" className="kc-start-card" onClick={() => navigate('/search')}>
          <h3>搜一搜</h3>
          <p>按关键词、标签或语义找文档、纪要、网页摘录，自己定位原文。</p>
        </button>
        <button type="button" className="kc-start-card" onClick={() => navigate('/ingest')}>
          <h3>上传与收录</h3>
          <p>把文件、链接或剪贴内容放进可检索的知识库，让后面的人能复用。</p>
        </button>
      </div>

      {/* Tabs */}
      <KnowledgeTabs />

      <p className="kc-skip-heading" style={{ marginTop: 8 }}>
        空间与数据健康度（管理者、Owner 常看）
      </p>
      {/* 4 KPI */}
      <div className="kc-grid-4">
        {isLoading ? <MetricCardsSkeleton /> : (
          <>
            <MetricCard
              label="文档条目"
              value={pages.data?.total ?? 0}
              pillLabel={`+${recentCount} 近7天`}
              pillClass="blue"
              recentCount={recentCount}
              sub="含：文档、FAQ、会议纪要、网页"
            />
            <MetricCard
              label="知识空间"
              value={shelves.data?.total ?? 0}
              pillLabel={`我管理 ${shelves.data?.total ?? 0}`}
              sub="跨部门共享与私有空间"
            />
            <MetricCard
              label="待处理入库"
              value={pendingIngest}
              pillLabel={pendingIngest > 0 ? '处理中' : '已全部入库'}
              pillClass={pendingIngest > 0 ? 'amber' : 'green'}
              sub="切分 / 解析 / 向量化"
            />
            <MetricCard
              label="异常 / 低质"
              value={lowQuality}
              pillLabel={lowQuality > 0 ? '需治理' : '无问题'}
              pillClass={lowQuality > 0 ? 'red' : 'green'}
              sub="重复、过期、缺字段"
            />
          </>
        )}
      </div>

      {/* 两栏：最近更新 + 我的收藏 */}
      <div className="kc-grid-2">
        {/* 最近更新 */}
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <div className="panel-title">最近更新</div>
            <div style={{ flex: 1 }} />
            <button
              className="btn ghost"
              onClick={() => navigate('/search')}
              style={{ color: 'var(--p)', fontWeight: 800 }}
            >
              去检索 ›
            </button>
          </div>
          {pages.isLoading ? (
            <ListRowsSkeleton />
          ) : !pages.data || pages.data.data.length === 0 ? (
            <div className="empty-state">
              <span className="empty-illus">📄</span>
              <p className="empty-text">暂无文档，去导入知识吧</p>
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
                    {page.book_id && <span>书 #{page.book_id}</span>}
                  </div>
                </div>
                <div className="list-right">
                  {new Date(page.updated_at).toLocaleDateString('zh-CN')}
                </div>
              </a>
            ))
          )}
        </div>

        {/* 我的收藏 */}
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <div className="panel-title">我的收藏</div>
          </div>
          {favorites.length === 0 ? (
            <div className="empty-state">
              <span className="empty-illus">⭐</span>
              <p className="empty-text">还没有收藏的内容，去检索页收藏文档吧</p>
              <button className="btn" onClick={() => navigate('/search')}>去检索</button>
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
            <div className="panel-title">活跃空间 Top5</div>
          </div>
          {shelfDetails.some((q) => q.isLoading) ? <ListRowsSkeleton count={5} /> : (
            activeShelves.length === 0 ? (
              <div className="empty-state">
                <span className="empty-illus">🗂</span>
                <p className="empty-text">暂无空间数据</p>
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
                          <span className="pill blue" style={{ cursor: 'default' }}>{shelf.books.length} 个知识库</span>
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
