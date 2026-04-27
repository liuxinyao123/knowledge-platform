/**
 * /iam · Teams Tab —— Permissions V2
 *
 * 功能：
 *   - 列出团队（含成员数）
 *   - 创建团队
 *   - 展开团队 → 看 / 加 / 移除成员
 *   - 删除团队
 */
import { useEffect, useState, useCallback } from 'react'
import {
  listTeams, createTeam, deleteTeam, getTeam, addMember, removeMember,
  type TeamSummary, type TeamMember,
} from '@/api/teams'

export default function TeamsTab() {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await listTeams()
      setTeams(list); setErr(null)
    } catch (e) {
      setTeams((p) => p ?? [])
      const msg = e instanceof Error ? e.message : 'load failed'
      setErr(/404/.test(msg)
        ? `${msg} —— /api/iam/teams 不存在；qa-service 没拿到新路由，需要 pnpm dev:down && pnpm dev:up`
        : msg)
    }
  }, [])
  useEffect(() => { void reload() }, [reload])

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {teams ? `${teams.length} 个团队` : '加载中…'}
        </span>
        <button className="btn primary" onClick={() => setCreateOpen(true)}>+ 新建团队</button>
      </div>

      {err && (
        <div style={{
          padding: 10, marginBottom: 10, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13,
        }}>{err}</div>
      )}

      {teams && teams.length === 0 && (
        <div style={{
          padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13,
          background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          还没有任何团队 · 点上方「+ 新建团队」开始
        </div>
      )}

      {teams && teams.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
        }}>
          {teams.map((t) => (
            <TeamRow
              key={t.id} t={t}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
              onDelete={async () => {
                if (!confirm(`解散团队「${t.name}」？所有成员关系会被删除。`)) return
                await deleteTeam(t.id); void reload()
              }}
              onChanged={() => void reload()}
            />
          ))}
        </div>
      )}

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); void reload() }}
      />
    </div>
  )
}

function TeamRow({ t, expanded, onToggle, onDelete, onChanged }: {
  t: TeamSummary
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [loadingM, setLoadingM] = useState(false)

  useEffect(() => {
    if (!expanded) return
    setLoadingM(true)
    getTeam(t.id).then((d) => { setMembers(d.members); setLoadingM(false) })
                 .catch(() => setLoadingM(false))
  }, [expanded, t.id])

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          padding: '12px 14px', cursor: 'pointer',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: expanded ? '#fafafa' : 'transparent',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 14 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', flex: 1 }}>👥 {t.name}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.member_count} 人</span>
        {t.description && (
          <span style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.description}
          </span>
        )}
        <button type="button"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--muted)',
                  cursor: 'pointer', fontSize: 13, padding: '0 6px',
                }} title="解散">×</button>
      </div>
      {expanded && (
        <div style={{ padding: '10px 14px 16px', background: '#fafafa', borderBottom: '1px solid var(--border)' }}>
          <AddMemberInline teamId={t.id} onAdded={onChanged} />
          <div style={{ marginTop: 10 }}>
            {loadingM && <div style={{ color: 'var(--muted)', fontSize: 12 }}>加载中…</div>}
            {!loadingM && members && members.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>暂无成员</div>
            )}
            {!loadingM && members && members.map((m) => (
              <div key={m.user_email} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                fontSize: 13,
              }}>
                <span style={{ color: 'var(--text)', flex: 1 }}>{m.user_email}</span>
                <span style={{
                  padding: '1px 8px', borderRadius: 999, fontSize: 11,
                  background: m.role === 'owner' ? 'rgba(108,71,255,0.1)' : '#f3f4f6',
                  color: m.role === 'owner' ? 'var(--p,#6C47FF)' : 'var(--muted)',
                }}>{m.role}</span>
                <button type="button"
                        onClick={async () => {
                          if (!confirm(`从 ${t.name} 移除 ${m.user_email}？`)) return
                          await removeMember(t.id, m.user_email)
                          onChanged()
                          // 局部刷新
                          getTeam(t.id).then((d) => setMembers(d.members)).catch(() => {})
                        }}
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--muted)',
                          cursor: 'pointer', fontSize: 13, padding: '0 4px',
                        }} title="移除">×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function AddMemberInline({ teamId, onAdded }: { teamId: number; onAdded: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'owner'>('member')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="email" value={email} placeholder="user@example.com"
             onChange={(e) => setEmail(e.target.value)}
             style={{
               flex: 1, padding: '6px 10px', border: '1px solid var(--border)',
               borderRadius: 6, fontSize: 13, background: '#fff', color: 'var(--text)', outline: 'none',
             }} />
      <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'owner')}
              style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
        <option value="member">成员</option>
        <option value="owner">Owner</option>
      </select>
      <button type="button" className="btn"
              disabled={busy || !email.trim()}
              onClick={async () => {
                const e = email.trim().toLowerCase()
                if (!/^[^@\s]+@[^@\s]+$/.test(e)) { setErr('邮箱格式不正确'); return }
                setBusy(true); setErr(null)
                try {
                  await addMember(teamId, e, role)
                  setEmail('')
                  onAdded()
                } catch (err) {
                  setErr(err instanceof Error ? err.message : '失败')
                } finally { setBusy(false) }
              }}>+ 加成员</button>
      {err && <span style={{ color: '#b91c1c', fontSize: 11 }}>{err}</span>}
    </div>
  )
}

function CreateTeamModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (open) { setName(''); setDesc(''); setErr(null); setBusy(false) } }, [open])
  if (!open) return null

  async function submit() {
    if (!name.trim()) { setErr('请输入团队名'); return }
    setBusy(true); setErr(null)
    try {
      await createTeam({ name: name.trim(), description: desc.trim() || undefined })
      onCreated()
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
      setErr(msg.response?.data?.error ?? msg.message ?? '创建失败')
      setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
           zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
         }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建团队</div>
        <div style={{ marginBottom: 12 }}>
          <Label>团队名 <span style={{ color: '#dc2626' }}>*</span></Label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="如：研发组 / 营销组"
                 style={fieldStyle} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Label>描述（选填）</Label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
                    rows={2} placeholder="团队职责简述"
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{
          padding: 10, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn primary"
                  disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 13, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{
    fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 4,
  }}>{children}</div>
}
