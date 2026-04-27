/**
 * KnowledgeTabs —— 对齐原型 .kc-tabs / .kc-tab 样式
 * 每页顶部放一行，点击跳路由。
 */
import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  { id: 'overview',   to: '/overview',   label: '🏠 总览' },
  { id: 'search',     to: '/search',     label: '🔎 检索' },
  { id: 'spaces',     to: '/spaces',     label: '🗂 空间' },
  { id: 'ingest',     to: '/ingest',     label: '⬆️ 入库' },
  { id: 'qa',         to: '/qa',         label: '💬 问答' },
  { id: 'agent',      to: '/agent',      label: '🤖 Agent' },
  { id: 'governance', to: '/governance', label: '🛡 治理' },
  { id: 'assets',     to: '/assets',     label: '📦 资产' },
  { id: 'mcp',        to: '/mcp',        label: '🔌 数据接入' },
]

export default function KnowledgeTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <div className="kc-tabs" role="tablist" aria-label="知识中台模块">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-testid={`tab-${tab.id}`}
          aria-selected={pathname.startsWith(tab.to)}
          onClick={() => navigate(tab.to)}
          className={`kc-tab${pathname.startsWith(tab.to) ? ' active' : ''}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
