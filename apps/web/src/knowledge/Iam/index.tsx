/**
 * /iam —— PRD §11-13 规则编辑器 + §15 IAM 面板（Permissions V2）
 * 五 Tab：用户 / 团队 / 规则 / 权限矩阵 / 审计（F-3）
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import RequirePermission from '@/auth/RequirePermission'
import RulesTab from './RulesTab'
import UsersTab from './UsersTab'
import MatrixTab from './MatrixTab'
import TeamsTab from './TeamsTab'
import AuditTab from './AuditTab'

type TabId = 'users' | 'teams' | 'rules' | 'matrix' | 'audit'

function useTabFromQuery(): [TabId, (t: TabId) => void] {
  const loc = useLocation()
  const nav = useNavigate()
  const params = new URLSearchParams(loc.search)
  const raw = params.get('tab')
  const current: TabId =
    raw === 'teams'  ? 'teams' :
    raw === 'rules'  ? 'rules' :
    raw === 'matrix' ? 'matrix' :
    raw === 'audit'  ? 'audit' : 'users'
  const set = (t: TabId) => {
    const p = new URLSearchParams(loc.search)
    p.set('tab', t)
    nav({ pathname: loc.pathname, search: p.toString() }, { replace: true })
  }
  return [current, set]
}

function IamInner() {
  const [tab, setTab] = useTabFromQuery()
  const navigate = useNavigate()
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    if (!search.get('tab')) setTab('users')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'users',  label: '👤 用户' },
    { id: 'teams',  label: '👥 团队' },
    { id: 'rules',  label: '📝 权限规则' },
    { id: 'matrix', label: '🔢 角色矩阵' },
    { id: 'audit',  label: '🕒 审计' },
  ]

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">身份与权限</div>
          <div className="page-sub">
            独立版用户体系 · 单租户（私有化）
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回运行概览</button>
        </div>
      </div>

      {/* 租户模式 / 授权策略 两张信息卡 */}
      <div className="kc-grid-2" style={{ marginBottom: 12 }}>
        <div className="surface-card" style={{ padding: 14 }}>
          <div style={{
            fontSize: 13, fontWeight: 950, color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <span>租户模式</span>
            <span className="pill" style={{ cursor: 'default' }}>单租户 · 私有化</span>
          </div>
          <div className="muted-2" style={{ marginTop: 8, lineHeight: 1.7 }}>
            默认租户：<b style={{ color: 'var(--text)' }}>DSClaw Knowledge Center</b>（部署级固定）。
            未来可平滑升级为多租户。
          </div>
        </div>
        <div className="surface-card" style={{ padding: 14 }}>
          <div style={{
            fontSize: 13, fontWeight: 950, color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <span>授权策略</span>
            <span className="pill" style={{ cursor: 'default' }}>permissions 优先</span>
          </div>
          <div className="muted-2" style={{ marginTop: 8, lineHeight: 1.7 }}>
            外部 token 同时含 <code>permissions</code> / <code>roles</code> 时以 <code>permissions</code> 为准；
            仅有 <code>roles</code> 时按映射表展开（权限矩阵 Tab 可查）。
          </div>
        </div>
      </div>

      {/* Tabs —— kc-tabs 原型样式 */}
      <div className="kc-tabs" role="tablist" aria-label="IAM Tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`kc-tab${tab === t.id ? ' active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users'  && <UsersTab />}
      {tab === 'teams'  && <TeamsTab />}
      {tab === 'rules'  && <RulesTab />}
      {tab === 'matrix' && <MatrixTab />}
      {tab === 'audit'  && <AuditTab />}
    </div>
  )
}

export default function Iam() {
  return (
    <RequirePermission
      name="permission:manage"
      fallback={
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>403 · 无权限</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            需要权限 <code>permission:manage</code>，请联系管理员开通
          </div>
        </div>
      }
    >
      <IamInner />
    </RequirePermission>
  )
}
