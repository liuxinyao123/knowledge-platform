/**
 * SpaceMembersTable —— 成员与权限表
 *
 * 原型图对应："成员与权限" 区块
 *   - 列：成员 / 角色 / 权限
 *   - 权限 = 由 role 展开的 derived_permissions
 *   - admin+ 可加/改/删；owner 的行改/删禁用（要 transfer-owner）
 */
import { useState } from 'react'
import {
  type SpaceMember, type SpaceRole, type SpaceMemberSubjectType,
  addMember, updateMember, removeMember, transferOwner,
} from '@/api/spaces'

interface Props {
  spaceId: number
  members: SpaceMember[]
  myRole: SpaceRole | null
  currentOwner: string
  onChanged: () => void
}

const ROLE_LABEL: Record<SpaceRole, string> = {
  owner:  '所有者',
  admin:  '管理员',
  editor: '编辑者',
  viewer: '查看者',
}

const ROLE_DESC: Record<SpaceRole, string> = {
  owner:  '管理空间、成员、治理规则；唯一可删除空间',
  admin:  '入库、治理、发布；管理成员',
  editor: '编辑与入库',
  viewer: '查看',
}

function canEdit(myRole: SpaceRole | null): boolean {
  return myRole === 'owner' || myRole === 'admin'
}

export default function SpaceMembersTable({ spaceId, members, myRole, currentOwner, onChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [transferTo, setTransferTo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = canEdit(myRole)
  const isOwner = myRole === 'owner'

  async function handleRoleChange(m: SpaceMember, nextRole: SpaceRole) {
    setErr(null)
    try {
      if (nextRole === 'owner') {
        if (m.subject_type !== 'user') throw new Error('所有者只能转给用户')
        setTransferTo(m.subject_id)
        return
      }
      if (m.role === 'owner') {
        throw new Error('所有者不可直接改角色，请先「转让所有者」')
      }
      await updateMember(spaceId, m.subject_type, m.subject_id, nextRole as Exclude<SpaceRole,'owner'>)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function handleRemove(m: SpaceMember) {
    setErr(null)
    if (m.role === 'owner') { setErr('所有者不可被移除，请先转让'); return }
    if (!confirm(`确认移除成员 ${m.display_name}？`)) return
    try {
      await removeMember(spaceId, m.subject_type, m.subject_id)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function confirmTransfer(targetEmail: string) {
    setErr(null)
    try {
      await transferOwner(spaceId, targetEmail)
      setTransferTo(null)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div style={{
      padding: '14px 16px',
      border: '1px solid var(--border)', borderRadius: 10,
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>成员与权限</div>
        <span style={{ flex: 1 }} />
        {isAdmin && (
          <button className="btn" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setAdding(true)}>
            + 邀请成员
          </button>
        )}
      </div>
      {err && (
        <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
          {err}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>成员</th>
            <th style={th}>角色</th>
            <th style={th}>权限</th>
            {isAdmin && <th style={{ ...th, textAlign: 'right' }}>管理</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={`${m.subject_type}:${m.subject_id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={td}>
                <span style={{ fontSize: 13 }}>
                  {m.subject_type === 'team' ? '👥 ' : '👤 '}{m.display_name}
                </span>
                {m.subject_type === 'team' && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                    团队
                  </span>
                )}
              </td>
              <td style={td}>
                {isAdmin ? (
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m, e.target.value as SpaceRole)}
                    disabled={m.role === 'owner' && !isOwner}
                    style={{
                      padding: '2px 6px', fontSize: 12, borderRadius: 6,
                      border: '1px solid var(--border)', background: '#fff',
                    }}
                  >
                    {(['owner','admin','editor','viewer'] as SpaceRole[]).map((r) => (
                      <option key={r} value={r} disabled={r === 'owner' && m.subject_type !== 'user'}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span style={rolePill(m.role)}>{ROLE_LABEL[m.role]}</span>
                )}
              </td>
              <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>
                {ROLE_DESC[m.role]}
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {m.derived_permissions.map((p) => (
                    <code key={p} style={{
                      marginRight: 4, padding: '0 6px', borderRadius: 8,
                      background: 'var(--p-light)', color: 'var(--p)', fontSize: 10,
                    }}>{p}</code>
                  ))}
                </div>
              </td>
              {isAdmin && (
                <td style={{ ...td, textAlign: 'right' }}>
                  <button
                    className="btn" style={{ padding: '2px 8px', fontSize: 11, color: m.role === 'owner' ? 'var(--muted)' : '#B91C1C' }}
                    disabled={m.role === 'owner'}
                    onClick={() => handleRemove(m)}
                  >
                    移除
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {adding && (
        <AddMemberModal
          spaceId={spaceId}
          excludeIds={new Set(members.map((m) => `${m.subject_type}:${m.subject_id}`))}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); onChanged() }}
          onError={(e) => setErr(e)}
        />
      )}

      {transferTo && (
        <div style={overlay}>
          <div style={modalBox}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
              转让空间所有者
            </div>
            <div style={{ padding: 20, fontSize: 13 }}>
              <div>当前所有者：{currentOwner}</div>
              <div style={{ marginTop: 6 }}>新所有者：<strong>{transferTo}</strong></div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                原所有者会自动降级为管理员。此操作只能由当前所有者执行。
              </div>
            </div>
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
              <button className="btn" onClick={() => setTransferTo(null)} style={{ marginRight: 6 }}>取消</button>
              <button className="btn primary" onClick={() => confirmTransfer(transferTo)}>确认转让</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AddMemberModal({
  spaceId, excludeIds, onClose, onAdded, onError,
}: {
  spaceId: number
  excludeIds: Set<string>
  onClose: () => void
  onAdded: () => void
  onError: (e: string) => void
}) {
  const [subjectType, setSubjectType] = useState<SpaceMemberSubjectType>('user')
  const [subjectId, setSubjectId] = useState('')
  const [role, setRole] = useState<Exclude<SpaceRole, 'owner'>>('viewer')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const key = `${subjectType}:${subjectId.trim()}`
      if (excludeIds.has(key)) throw new Error('该成员已在空间内')
      if (!subjectId.trim()) throw new Error('请输入成员 ID')
      if (subjectType === 'user' && !/^[^@\s]+@[^@\s]+$/.test(subjectId.trim())) {
        throw new Error('用户必须是邮箱格式')
      }
      if (subjectType === 'team' && !/^\d+$/.test(subjectId.trim())) {
        throw new Error('团队 ID 必须是数字')
      }
      await addMember(spaceId, { subject_type: subjectType, subject_id: subjectId.trim(), role })
      onAdded()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
          邀请成员
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 10 }}>
          <label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>类型</div>
            <select value={subjectType} onChange={(e) => setSubjectType(e.target.value as SpaceMemberSubjectType)} style={inp}>
              <option value="user">用户</option>
              <option value="team">团队</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              {subjectType === 'user' ? '邮箱' : '团队 ID（数字）'}
            </div>
            <input
              value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
              placeholder={subjectType === 'user' ? 'user@example.com' : '3'}
              style={inp}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>角色</div>
            <select value={role} onChange={(e) => setRole(e.target.value as Exclude<SpaceRole,'owner'>)} style={inp}>
              <option value="viewer">查看者 — 仅查看</option>
              <option value="editor">编辑者 — 编辑与入库</option>
              <option value="admin">管理员 — 管理成员与治理</option>
            </select>
          </label>
        </div>
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button className="btn" onClick={onClose} style={{ marginRight: 6 }}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '邀请'}
          </button>
        </div>
      </div>
    </div>
  )
}

function rolePill(role: SpaceRole): React.CSSProperties {
  const base: React.CSSProperties = { padding: '1px 8px', borderRadius: 10, fontSize: 11 }
  if (role === 'owner')  return { ...base, background: '#fef3c7', color: '#92400e' }
  if (role === 'admin')  return { ...base, background: '#ddd6fe', color: '#5b21b6' }
  if (role === 'editor') return { ...base, background: '#bfdbfe', color: '#1e40af' }
  return { ...base, background: '#e5e7eb', color: '#374151' }
}

const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' }
const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalBox: React.CSSProperties = { width: '90%', maxWidth: 480, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }
