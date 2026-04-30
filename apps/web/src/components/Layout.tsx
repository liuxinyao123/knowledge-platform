/**
 * Layout —— 直接照原型 dsclaw-knowledge-prototype 的 sidebar + topbar + main shell。
 * 结构：
 *   .app
 *     .sidebar
 *       .sidebar-top（brand + 搜索框 + 「+ 新建会话」CTA）
 *       .nav（按原型「知识中台」「管理与数据」两组）
 *       .sidebar-footer（avatar + 用户 + chevron）
 *     .main
 *       .topbar（面包屑 + 顶栏 icon 按钮）
 *       .page-host（路由出口，自身可滚）
 */
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import RequirePermission from '@/auth/RequirePermission'
import { useAuth } from '@/auth/AuthContext'
import ChangePasswordModal from '@/auth/ChangePasswordModal'
import LanguageSwitcher from './LanguageSwitcher'

interface NavEntry {
  to: string
  /** i18n key under namespace 'nav.labels' */
  labelKey: string
  icon: ReactNode
  perm?: string
}

/* ── SVG 图标（原型 viewBox 17×17，1.5 stroke） ─────────────────────────── */

const Ico = {
  qa: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3.5h11v8H8l-3.5 2.5V11.5H3z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7.2" cy="7.2" r="4.5" /><path d="M10.8 10.8l3 3" />
    </svg>
  ),
  spaces: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.8 5.2h11.4v8.8H2.8z" /><path d="M2.8 5.2l2-2h9.4v2" />
    </svg>
  ),
  ingest: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8.5 12V3" /><path d="M5.5 6l3-3 3 3" /><path d="M3 14h11" />
    </svg>
  ),
  overview: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3.5h8.5a2 2 0 012 2V14a2 2 0 00-2-2H3z" />
      <path d="M3 12h8.5a2 2 0 012 2" /><path d="M3 3.5V12" />
    </svg>
  ),
  govern: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8.5 2.5l5 2v4.8c0 3.2-2 5.3-5 6.2-3-.9-5-3-5-6.2V4.5l5-2z" />
    </svg>
  ),
  mcp: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 9a5.5 5.5 0 019.5-3.9" /><path d="M14 3v3h-3" />
      <path d="M14 8a5.5 5.5 0 01-9.5 3.9" /><path d="M3 14v-3h3" />
    </svg>
  ),
  iam: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8.5" cy="5.5" r="3" />
      <path d="M2.5 16c0-3.5 2.9-6 6-6s6 2.5 6 6" />
    </svg>
  ),
  asset: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3" width="12" height="11" rx="2" /><path d="M5 6h7M5 9h5M5 12h6" />
    </svg>
  ),
  agent: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.2" y="2.6" width="5.8" height="5.8" rx="1.5" />
      <rect x="9" y="2.6" width="5.8" height="5.8" rx="1.5" />
      <rect x="2.2" y="9.4" width="5.8" height="5.8" rx="1.5" />
      <rect x="9" y="9.4" width="5.8" height="5.8" rx="1.5" />
    </svg>
  ),
  notebook: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2.5" width="11" height="12" rx="1.5" /><path d="M6 5h5M6 8h5M6 11h3" />
    </svg>
  ),
  eval: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 13.5V3.5" /><path d="M2.5 13.5H14.5" />
      <path d="M4.8 11.5l2.5-3 2 2 3.5-5" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="4.5" cy="4.5" r="1.7" />
      <circle cx="12.5" cy="4.5" r="1.7" />
      <circle cx="8.5" cy="12" r="1.7" />
      <path d="M4.5 6.2l4 5.8M12.5 6.2l-4 5.8" />
    </svg>
  ),
  kgGraph: (
    <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3.5" cy="8.5" r="1.6" />
      <circle cx="8.5" cy="3.8" r="1.6" />
      <circle cx="13.5" cy="8.5" r="1.6" />
      <circle cx="8.5" cy="13.2" r="1.6" />
      <path d="M3.5 8.5l5-4.7M13.5 8.5l-5-4.7M3.5 8.5l5 4.7M13.5 8.5l-5 4.7" />
    </svg>
  ),
}

const NAV_PRIMARY: NavEntry[] = [
  { to: '/qa',      labelKey: 'labels.qa',      icon: Ico.qa },
  { to: '/search',  labelKey: 'labels.search',  icon: Ico.search },
  { to: '/spaces',  labelKey: 'labels.spaces',  icon: Ico.spaces },
  { to: '/ingest',  labelKey: 'labels.ingest',  icon: Ico.ingest },
]

const NAV_MANAGE: NavEntry[] = [
  { to: '/overview',        labelKey: 'labels.overview',       icon: Ico.overview },
  { to: '/insights',        labelKey: 'labels.insights',       icon: Ico.insights },
  { to: '/knowledge-graph', labelKey: 'labels.knowledgeGraph', icon: Ico.kgGraph },
  { to: '/governance',      labelKey: 'labels.governance',     icon: Ico.govern },
  { to: '/assets',          labelKey: 'labels.assets',         icon: Ico.asset },
  { to: '/mcp',             labelKey: 'labels.mcp',            icon: Ico.mcp },
]

const NAV_EXTRA: NavEntry[] = [
  { to: '/agent',     labelKey: 'labels.agent',     icon: Ico.agent },
  { to: '/notebooks', labelKey: 'labels.notebooks', icon: Ico.notebook },
  { to: '/eval',      labelKey: 'labels.eval',      icon: Ico.eval },
]

const NAV_ADMIN: NavEntry[] = [
  { to: '/iam', labelKey: 'labels.iam', icon: Ico.iam, perm: 'iam:manage' },
]

/* ── Topbar 面包屑：根据当前路由匹配 nav 项 ─────────────────────── */

function useCrumb() {
  const { pathname } = useLocation()
  const all = [...NAV_PRIMARY, ...NAV_MANAGE, ...NAV_EXTRA, ...NAV_ADMIN]
  return all.find((n) => pathname.startsWith(n.to))
}

/* ── 侧栏顶部搜索（沿用原 SidebarSearch 行为：回车跳 /search） ───── */

function SidebarSearch() {
  const navigate = useNavigate()
  const { t } = useTranslation('nav')
  const [q, setQ] = useState('')
  return (
    <div className="search-wrap">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="6" cy="6" r="4.5" /><path d="M10 10l3 3" />
      </svg>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const trimmed = q.trim()
            if (!trimmed) return
            navigate(`/search?q=${encodeURIComponent(trimmed)}`)
          }
        }}
        placeholder={t('sidebarSearchPlaceholder')}
        data-testid="sidebar-search"
      />
    </div>
  )
}

/* ── 单个 NavLink，套 .nav-item 类 ──────────────────────────────── */

function NavRow({ entry }: { entry: NavEntry }) {
  const { t } = useTranslation('nav')
  return (
    <NavLink
      to={entry.to}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {entry.icon}
      <span>{t(entry.labelKey)}</span>
    </NavLink>
  )
}

/* ── 用户区（avatar + 改密 / 登出 ── 复用原本的逻辑） ──────────── */

function UserArea() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation('auth')
  const [pwModal, setPwModal] = useState(false)
  const initial = (user?.email ?? 'U').trim().charAt(0).toUpperCase()
  const isDev = !!user?.dev_bypass

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <div className="sidebar-footer" title={user?.email ?? ''}>
        <div className="avatar">{initial}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            data-testid="current-user-email"
            className="user-name"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {user?.email ?? '—'}
          </div>
          <div className="user-sub">
            {user?.roles.join(',') || '—'}
            {isDev && <span style={{ marginLeft: 4, color: '#874d00' }}> · {t('userArea.devSuffix')}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            data-testid="btn-change-password"
            onClick={() => setPwModal(true)}
            disabled={isDev}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, padding: '2px 8px', fontSize: 10,
              cursor: isDev ? 'not-allowed' : 'pointer',
              color: isDev ? 'var(--border)' : 'var(--muted)',
            }}
            title={isDev ? t('userArea.changePasswordDevTooltip') : t('userArea.changePasswordTitle')}
          >{t('userArea.changePassword')}</button>
          <button
            data-testid="btn-logout"
            onClick={() => void handleLogout()}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, padding: '2px 8px', fontSize: 10,
              cursor: 'pointer', color: 'var(--muted)',
            }}
            title={t('userArea.logoutTitle')}
          >{t('userArea.logout')}</button>
        </div>
      </div>
      {pwModal && <ChangePasswordModal onClose={() => setPwModal(false)} />}
    </>
  )
}

/* ── Topbar：面包屑 + 右侧 icon 按钮 ─────────────────────────────── */

function Topbar() {
  const crumb = useCrumb()
  const navigate = useNavigate()
  const { t } = useTranslation('nav')
  return (
    <header className="topbar">
      <div className="topbar-crumb">
        {t('brand')}
        {crumb && (
          <>
            <span style={{ margin: '0 6px', color: 'var(--muted)', fontWeight: 400 }}>›</span>
            <span className="crumb-now">{t(crumb.labelKey)}</span>
          </>
        )}
      </div>
      <div className="tb-space" />
      <button
        className="tb-icon-btn"
        title={t('topbarQuickCreate')}
        onClick={() => navigate('/qa')}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="11" height="11" rx="2" />
          <path d="M5 7.5h5M7.5 5v5" />
        </svg>
      </button>
      <button
        className="tb-icon-btn"
        title={t('topbarAssetsBtn')}
        onClick={() => navigate('/assets')}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M7.5 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM7.5 5v2.5L9 9" />
        </svg>
      </button>
      {/* i18n 语言切换 —— 顶栏右侧 */}
      <LanguageSwitcher />
    </header>
  )
}

/* ── 主组件 ─────────────────────────────────────────────────────── */

export default function Layout() {
  const navigate = useNavigate()
  const { t: tNav } = useTranslation('nav')
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-top">
          {/* Brand */}
          <div className="brand">
            <div className="brand-icon">
              <svg viewBox="0 0 20 20"><path d="M10 2L4 6v9h4v-4h4v4h4V6L10 2z" /></svg>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span className="brand-name">{tNav('brand')}</span>
                <span className="brand-ver">v1</span>
              </div>
            </div>
          </div>

          {/* 搜索框 */}
          <SidebarSearch />

          {/* CTA：去问一问 */}
          <button
            type="button"
            className="new-task-btn"
            onClick={() => navigate('/qa')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 2v10M2 7h10" />
            </svg>
            <span>{tNav('newTaskCta')}</span>
          </button>
        </div>

        <nav className="nav">
          {/* 知识中台 —— 用户高频入口 */}
          <div className="nav-label">{tNav('sectionPrimary')}</div>
          {NAV_PRIMARY.map((e) => (
            <NavRow key={e.to} entry={e} />
          ))}

          {/* 管理与数据 */}
          <div className="nav-sep" />
          <div className="nav-label">{tNav('sectionManage')}</div>
          {NAV_MANAGE.map((e) => (
            <NavRow key={e.to} entry={e} />
          ))}

          {/* 辅助工具 */}
          <div className="nav-sep" />
          <div className="nav-label">{tNav('sectionExtra')}</div>
          {NAV_EXTRA.map((e) => (
            <NavRow key={e.to} entry={e} />
          ))}

          {/* 管理端（需权限） */}
          <RequirePermission name="iam:manage">
            <div className="nav-sep" />
            <div className="nav-label">{tNav('sectionAdmin')}</div>
            {NAV_ADMIN.map((e) => (
              <NavRow key={e.to} entry={e} />
            ))}
          </RequirePermission>
        </nav>

        <UserArea />
      </aside>

      <div className="main">
        <Topbar />
        <div className="page-host">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
