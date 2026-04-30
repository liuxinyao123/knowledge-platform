/**
 * KnowledgeTabs —— 对齐原型 .kc-tabs / .kc-tab 样式
 * 每页顶部放一行，点击跳路由。
 */
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const tabs = [
  { id: 'overview',   to: '/overview',   labelKey: 'tabs.overview' },
  { id: 'search',     to: '/search',     labelKey: 'tabs.search' },
  { id: 'spaces',     to: '/spaces',     labelKey: 'tabs.spaces' },
  { id: 'ingest',     to: '/ingest',     labelKey: 'tabs.ingest' },
  { id: 'qa',         to: '/qa',         labelKey: 'tabs.qa' },
  { id: 'agent',      to: '/agent',      labelKey: 'tabs.agent' },
  { id: 'governance', to: '/governance', labelKey: 'tabs.governance' },
  { id: 'assets',     to: '/assets',     labelKey: 'tabs.assets' },
  { id: 'mcp',        to: '/mcp',        labelKey: 'tabs.mcp' },
]

export default function KnowledgeTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation('nav')

  return (
    <div className="kc-tabs" role="tablist" aria-label={t('tabsAriaLabel')}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-testid={`tab-${tab.id}`}
          aria-selected={pathname.startsWith(tab.to)}
          onClick={() => navigate(tab.to)}
          className={`kc-tab${pathname.startsWith(tab.to) ? ' active' : ''}`}
        >
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  )
}
