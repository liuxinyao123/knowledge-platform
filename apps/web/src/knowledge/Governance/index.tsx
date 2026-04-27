import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { govApi } from '@/api/governance'
import type { GovUser } from '@/api/governance'
import { bsApi } from '@/api/bookstack'
import KnowledgeOps from './KnowledgeOps'
import RequirePermission from '@/auth/RequirePermission'
import ActionsTab from './Actions'
import {
  listSpaces, updateSpace,
  type SpaceSummary, type SpaceVisibility,
} from '@/api/spaces'

// ── Types ─────────────────────────────────────────────────────────────────────

type SubTab = 'knowledge' | 'members' | 'spaces' | 'dataperm' | 'actions'

// ── Role labels ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = { admin: '管理员', editor: '编辑', viewer: '访客' }
// space-permissions (ADR 2026-04-23-26)：新 space 实体只开 org / private 两档
const VISIBILITY_LABELS: Record<SpaceVisibility, string> = { org: '组织内', private: '私有' }
const SPACE_ROLE_LABELS: Record<string, string> = {
  owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者',
}

// ── MembersTab ────────────────────────────────────────────────────────────────

function MembersTab() {
  const [users, setUsers] = useState<GovUser[]>([])
  const [loading, setLoading] = useState(true)
  const [roleSelections, setRoleSelections] = useState<Record<number, string>>({})

  useEffect(() => {
    govApi.getUsers().then(({ users: data }) => {
      setUsers(data)
      const init: Record<number, string> = {}
      data.forEach((u) => { init[u.id] = u.role })
      setRoleSelections(init)
      setLoading(false)
    })
  }, [])

  const handleSave = useCallback(async (userId: number) => {
    await govApi.updateUserRole(userId, roleSelections[userId])
  }, [roleSelections])

  return (
    <div data-testid="tab-content-members" className="surface-card" style={{ padding: '1rem' }}>
      <div className="panel-head">
        <span className="panel-title">成员管理</span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>加载中…</p>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illus">👥</div>
          <div className="empty-text">暂无成员</div>
        </div>
      ) : (
        <table className="kc-table" style={{ marginTop: '0.75rem', width: '100%' }}>
          <thead>
            <tr>
              <th>姓名</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>
                  <select
                    data-testid={`role-select-${user.id}`}
                    value={roleSelections[user.id] ?? 'viewer'}
                    onChange={(e) => setRoleSelections((prev) => ({ ...prev, [user.id]: e.target.value }))}
                    style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}
                  >
                    {(['admin', 'editor', 'viewer'] as const).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    data-testid={`save-role-${user.id}`}
                    className="btn btn-primary"
                    onClick={() => handleSave(user.id)}
                    style={{ fontSize: '0.8rem' }}
                  >
                    保存
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── SpacesTab ─────────────────────────────────────────────────────────────────
//
// space-permissions (ADR 2026-04-23-26)：原本读 BookStack shelf 的 getShelfVisibility
// 在 2026-04-22 BookStack 下线后就空表了；这里改读新 `space` 实体。
// 本 tab 只管「空间可见性 + 概览 + 跳转」；成员/权限细节在 /spaces 页。

function SpacesTab() {
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [visSelections, setVisSelections] = useState<Record<number, SpaceVisibility>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    listSpaces()
      .then((data) => {
        setSpaces(data)
        const init: Record<number, SpaceVisibility> = {}
        data.forEach((s) => { init[s.id] = s.visibility })
        setVisSelections(init)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(spaceId: number) {
    setSaving(spaceId); setErr(null)
    try {
      await updateSpace(spaceId, { visibility: visSelections[spaceId] })
      load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div data-testid="tab-content-spaces" className="surface-card" style={{ padding: '1rem' }}>
      <div className="panel-head">
        <span className="panel-title">空间权限</span>
        <span className="list-meta" style={{ marginLeft: 'auto' }}>
          成员/角色编辑请到「空间管理」页 →
        </span>
      </div>

      {err && (
        <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12, margin: '8px 0' }}>
          {err}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>加载中…</p>
      ) : spaces.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illus">📚</div>
          <div className="empty-text">暂无空间</div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => navigate('/spaces')}>
            去创建空间
          </button>
        </div>
      ) : (
        <table className="kc-table" style={{ marginTop: '0.75rem', width: '100%' }}>
          <thead>
            <tr>
              <th>空间名称</th>
              <th>所有者</th>
              <th>我的角色</th>
              <th>文档 / 源 / 成员</th>
              <th>可见性</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {spaces.map((sp) => {
              const isAdmin = sp.my_role === 'owner' || sp.my_role === 'admin'
              return (
                <tr key={sp.id}>
                  <td>
                    <button
                      onClick={() => navigate(`/spaces/${sp.id}`)}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        color: 'var(--p)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                      }}
                    >
                      {sp.visibility === 'private' ? '🔒 ' : '📁 '}{sp.name}
                    </button>
                  </td>
                  <td style={{ fontSize: 12 }}>{sp.owner_email}</td>
                  <td>
                    <span style={{
                      padding: '1px 8px', borderRadius: 10, fontSize: 11,
                      background: sp.my_role ? 'var(--p-light)' : '#f1f5f9',
                      color: sp.my_role ? 'var(--p)' : 'var(--muted)',
                    }}>
                      {sp.my_role ? (SPACE_ROLE_LABELS[sp.my_role] ?? sp.my_role) : '非成员'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {sp.doc_count} / {sp.source_count} / {sp.member_count}
                  </td>
                  <td>
                    <select
                      data-testid={`visibility-select-${sp.id}`}
                      value={visSelections[sp.id] ?? sp.visibility}
                      disabled={!isAdmin}
                      onChange={(e) => setVisSelections((prev) => ({
                        ...prev, [sp.id]: e.target.value as SpaceVisibility,
                      }))}
                      style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}
                    >
                      {(['org', 'private'] as const).map((v) => (
                        <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      data-testid={`save-visibility-${sp.id}`}
                      className="btn btn-primary"
                      disabled={!isAdmin || saving === sp.id || visSelections[sp.id] === sp.visibility}
                      onClick={() => void handleSave(sp.id)}
                      style={{ fontSize: '0.8rem', marginRight: 6 }}
                    >
                      {saving === sp.id ? '保存中…' : '保存'}
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: '0.8rem' }}
                      onClick={() => navigate(`/spaces/${sp.id}`)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── DataPermTab ───────────────────────────────────────────────────────────────

type BSRole = {
  id: number
  display_name: string
  description: string
  system_name: string
  users_count: number
  permissions_count: number
}

const ROLE_PERM_DESC: Record<string, { actions: string[]; level: string; pillClass: string }> = {
  admin:  { actions: ['创建', '编辑', '删除', '管理成员', '管理角色', 'API 访问'], level: '全部权限', pillClass: 'pill-red' },
  Editor: { actions: ['创建页面', '编辑页面', '删除页面', '上传附件'],            level: '内容编辑', pillClass: 'pill-amber' },
  Viewer: { actions: ['查看页面', '查看附件'],                                    level: '只读',    pillClass: 'pill-blue' },
  Public: { actions: ['公开页面查看'],                                            level: '匿名访客', pillClass: '' },
}

function roleDesc(role: BSRole) {
  return ROLE_PERM_DESC[role.system_name || role.display_name] ?? {
    actions: [`${role.permissions_count} 项权限`],
    level: role.display_name,
    pillClass: '',
  }
}

function DataPermTab() {
  const [roles, setRoles] = useState<BSRole[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    bsApi.getRoles()
      .then((res) => {
        const list = (res as { data?: BSRole[]; roles?: BSRole[] }).data
          ?? (res as { roles?: BSRole[] }).roles
          ?? (Array.isArray(res) ? res : []) as BSRole[]
        setRoles(list.sort((a, b) => b.permissions_count - a.permissions_count))
      })
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div data-testid="tab-content-dataperm">
      <div className="surface-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <span className="panel-title">角色权限矩阵</span>
          <span className="list-meta">基于 BookStack 内置角色体系</span>
        </div>

        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>加载中…</p>
        ) : err ? (
          <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {roles.map((role) => {
              const desc = roleDesc(role)
              return (
                <div
                  key={role.id}
                  className="surface-card"
                  style={{ padding: '12px 14px', border: '1px solid var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                      {role.display_name}
                    </span>
                    <span className={`pill ${desc.pillClass}`}>{desc.level}</span>
                    <span className="list-meta" style={{ marginLeft: 'auto' }}>
                      {role.users_count} 人
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
                    {role.description}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {desc.actions.map((a) => (
                      <span key={a} className="pill" style={{ fontSize: 11 }}>{a}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                    共 {role.permissions_count} 项系统权限
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="surface-card" style={{ padding: '1rem' }}>
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <span className="panel-title">权限说明</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2 }}>
          <div>• <strong>Admin</strong>：系统管理员，拥有所有权限，可管理用户、角色、API Token。</div>
          <div>• <strong>Editor</strong>：内容编辑，可创建/编辑/删除页面，不可管理成员。</div>
          <div>• <strong>Viewer</strong>：只读访客，登录后可查看所有内容，不可修改。</div>
          <div>• <strong>Public</strong>：匿名访客，仅可查看被设为公开的内容。</div>
          <div style={{ marginTop: 8 }}>如需调整用户角色，请前往 <strong>会员管理</strong> 子页；如需设置空间访问范围，请前往 <strong>空间权限</strong> 子页。</div>
        </div>
      </div>
    </div>
  )
}

// ── Governance (root) ─────────────────────────────────────────────────────────

const SUBTABS: { id: SubTab; label: string; testId: string }[] = [
  { id: 'knowledge', label: '知识治理', testId: 'subtab-knowledge' },
  { id: 'members', label: '成员管理', testId: 'subtab-members' },
  { id: 'spaces', label: '空间权限', testId: 'subtab-spaces' },
  { id: 'dataperm', label: '数据权限', testId: 'subtab-dataperm' },
  { id: 'actions', label: '操作与审批', testId: 'subtab-actions' },
]

export default function Governance() {
  const [activeTab, setActiveTab] = useState<SubTab>('knowledge')
  const navigate = useNavigate()

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">治理运营</div>
          <div className="page-sub">标签体系、重复检测、质量评分与审计日志</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回运行概览</button>
          <button className="btn primary" onClick={() => window.location.reload()}>刷新</button>
        </div>
      </div>

      <KnowledgeTabs />

      {/* 二级 Tab —— 用原型 .kc-subtabs / .kc-subtab */}
      <div className="kc-subtabs">
        {SUBTABS.map((tab) => (
          <button
            key={tab.id}
            data-testid={tab.testId}
            className={`kc-subtab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'knowledge' && <KnowledgeOps />}
      {activeTab === 'members' && <MembersTab />}
      {activeTab === 'spaces' && <SpacesTab />}
      {activeTab === 'dataperm' && (
        <RequirePermission
          name="permission:manage"
          fallback={
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--muted)',
            }}>
              🔒 需要 <code>permission:manage</code> 权限才能查看数据权限管理
            </div>
          }
        >
          <DataPermTab />
        </RequirePermission>
      )}
      {activeTab === 'actions' && <ActionsTab />}
    </div>
  )
}
