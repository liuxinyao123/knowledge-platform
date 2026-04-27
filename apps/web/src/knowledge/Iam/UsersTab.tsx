/**
 * UsersTab —— PRD §15 IAM 用户面板 · G10 加 CRUD
 */
import { useCallback, useEffect, useState } from 'react'
import { type IamUser, listUsers, userAdmin } from '@/api/iam'
import { useAuth } from '@/auth/AuthContext'

const ALL_ROLES = ['admin', 'editor', 'viewer', 'user']

type ModalState =
  | null
  | { kind: 'create' }
  | { kind: 'editRoles'; user: IamUser }
  | { kind: 'resetPw'; user: IamUser }

export default function UsersTab() {
  const { user: current } = useAuth()
  const [users, setUsers] = useState<IamUser[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    listUsers()
      .then((r) => { setUsers(r); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
  }, [])
  useEffect(() => { load() }, [load])

  async function handleDelete(u: IamUser) {
    const id = Number(u.user_id)
    if (!Number.isFinite(id)) return
    if (!confirm(`确认删除 ${u.email}？此操作不可撤销。`)) return
    try {
      await userAdmin.remove(id)
      setMsg(`✓ 已删除 ${u.email}`)
      load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMsg('✗ ' + (err?.response?.data?.error || '删除失败'))
    }
  }

  if (err) return <div style={{ padding: 10, color: '#B91C1C' }}>{err}</div>
  if (!users) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          共 {users.length} 行（session + 真表记录）
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setModal({ kind: 'create' })}>+ 新建用户</button>
      </div>

      {msg && (
        <div style={{
          marginBottom: 10, padding: 8, fontSize: 12,
          background: msg.startsWith('✓') ? '#f0fdf4' : '#FEF2F2',
          color: msg.startsWith('✓') ? '#166534' : '#B91C1C',
          borderRadius: 6,
        }}>{msg}</div>
      )}

      <div style={{
        marginBottom: 12, padding: 10, borderRadius: 8,
        background: '#fff7e6', border: '1px solid #ffd591',
        fontSize: 12, color: '#874d00',
      }}>
        📌 session 行是当前登录身份（不可编辑）。seed/db 行才有操作按钮。自己无法删除自己。
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: '#f9fafb' }}>
          <tr>
            <th style={th}>user_id</th>
            <th style={th}>email</th>
            <th style={th}>角色</th>
            <th style={th}>权限数</th>
            <th style={th}>来源</th>
            <th style={th}>标记</th>
            <th style={{ ...th, textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const idNum = Number(u.user_id)
            const isDb = u.source === 'seed' && Number.isFinite(idNum) && idNum > 0
            const isSelf = !!current && Number(current.user_id) === idNum
            return (
              <tr key={`${u.source}-${u.user_id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={td}><code>{u.user_id}</code></td>
                <td style={td}>{u.email}</td>
                <td style={td}>
                  {u.roles.map((r) => (
                    <span key={r} style={{
                      padding: '1px 8px', borderRadius: 10, fontSize: 11, marginRight: 4,
                      background: 'var(--p-light)', color: 'var(--p)',
                    }}>{r}</span>
                  ))}
                  {u.roles.length === 0 && <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={td}>{u.permissions.length}</td>
                <td style={td}>
                  {u.source === 'session'
                    ? <span style={{ padding: '1px 8px', fontSize: 11, background: '#e0f2fe', color: '#0369a1', borderRadius: 10 }}>current session</span>
                    : <span style={{ padding: '1px 8px', fontSize: 11, background: '#f3f4f6', color: '#374151', borderRadius: 10 }}>{isDb ? 'db' : 'seed'}</span>}
                </td>
                <td style={td}>
                  {u.dev_bypass && <span style={{ padding: '1px 8px', fontSize: 11, background: '#fff7e6', color: '#874d00', borderRadius: 10 }}>DEV</span>}
                  {isSelf && <span style={{ padding: '1px 8px', fontSize: 11, background: '#fce7f3', color: '#9d174d', borderRadius: 10, marginLeft: 4 }}>self</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {isDb ? (
                    <>
                      <button
                        className="btn" style={btnSm}
                        disabled={isSelf}
                        title={isSelf ? '不能改自己的角色' : '修改角色'}
                        onClick={() => setModal({ kind: 'editRoles', user: u })}
                      >改角色</button>
                      <button
                        className="btn" style={btnSm}
                        onClick={() => setModal({ kind: 'resetPw', user: u })}
                      >重置密码</button>
                      <button
                        className="btn" style={{ ...btnSm, color: '#B91C1C' }}
                        disabled={isSelf}
                        title={isSelf ? '不能删除自己' : '删除用户'}
                        onClick={() => void handleDelete(u)}
                      >删除</button>
                    </>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>不可编辑</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {modal?.kind === 'create' && (
        <CreateUserModal
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load() }}
          onErr={(m) => setMsg('✗ ' + m)}
        />
      )}
      {modal?.kind === 'editRoles' && (
        <EditRolesModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load() }}
          onErr={(m) => setMsg('✗ ' + m)}
        />
      )}
      {modal?.kind === 'resetPw' && (
        <ResetPwModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setMsg(`✓ 已重置 ${modal.user.email} 密码`) }}
          onErr={(m) => setMsg('✗ ' + m)}
        />
      )}
    </div>
  )
}

// ─────────────── Create Modal ───────────────
function CreateUserModal({
  onClose, onDone, onErr,
}: { onClose: () => void; onDone: () => void; onErr: (m: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<string[]>(['viewer'])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    // BUG-11：先做前端校验并显示错误；再置 busy
    const em = email.trim()
    if (!em) { setErr('请输入邮箱'); return }
    if (!/^[^@\s]+@[^@\s]+$/.test(em)) { setErr('邮箱格式不正确'); return }
    if (!password) { setErr('请输入密码'); return }
    if (password.length < 8) { setErr('密码至少 8 字符'); return }
    if (roles.length === 0) { setErr('请至少选择一个角色'); return }
    setBusy(true); setErr(null)
    try {
      await userAdmin.create(em.toLowerCase(), password, roles)
      onDone()
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败'
      setErr(m); onErr(m)
    } finally { setBusy(false) }
  }

  return (
    <Overlay title="新建用户" onClose={onClose}>
      <Field label="邮箱">
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={inp} type="email" />
      </Field>
      <Field label="初始密码（≥8 字符）">
        <input value={password} onChange={(e) => setPassword(e.target.value)} style={inp} type="password" />
      </Field>
      <Field label="角色">
        <RoleMulti value={roles} onChange={setRoles} />
      </Field>
      {err && <div style={errBox}>{err}</div>}
      <Footer>
        <button className="btn btn-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? '保存中…' : '创建'}
        </button>
      </Footer>
    </Overlay>
  )
}

// ─────────────── EditRoles Modal ───────────────
function EditRolesModal({
  user, onClose, onDone, onErr,
}: { user: IamUser; onClose: () => void; onDone: () => void; onErr: (m: string) => void }) {
  const [roles, setRoles] = useState<string[]>(user.roles)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    setBusy(true); setErr(null)
    try {
      await userAdmin.update(Number(user.user_id), { roles })
      onDone()
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '更新失败'
      setErr(m); onErr(m)
    } finally { setBusy(false) }
  }

  return (
    <Overlay title={`改角色 · ${user.email}`} onClose={onClose}>
      <Field label="角色">
        <RoleMulti value={roles} onChange={setRoles} />
      </Field>
      {err && <div style={errBox}>{err}</div>}
      <Footer>
        <button className="btn btn-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? '保存中…' : '保存'}
        </button>
      </Footer>
    </Overlay>
  )
}

// ─────────────── ResetPw Modal ───────────────
function ResetPwModal({
  user, onClose, onDone, onErr,
}: { user: IamUser; onClose: () => void; onDone: () => void; onErr: (m: string) => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    setBusy(true); setErr(null)
    try {
      await userAdmin.resetPassword(Number(user.user_id), pw)
      onDone()
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '失败'
      setErr(m); onErr(m)
    } finally { setBusy(false) }
  }

  return (
    <Overlay title={`重置密码 · ${user.email}`} onClose={onClose}>
      <div style={{ padding: 10, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, fontSize: 12, color: '#874d00', marginBottom: 10 }}>
        这将强制设置 {user.email} 的登录密码为你下面填写的值。告知用户并要求其首次登录后自助改密。
      </div>
      <Field label="新密码（≥8 字符）">
        <input value={pw} onChange={(e) => setPw(e.target.value)} style={inp} type="password" />
      </Field>
      {err && <div style={errBox}>{err}</div>}
      <Footer>
        <button className="btn btn-primary" disabled={busy || pw.length < 8} onClick={() => void handleSave()}>
          {busy ? '保存中…' : '重置'}
        </button>
      </Footer>
    </Overlay>
  )
}

// ─────────────── helpers ───────────────
function RoleMulti({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {ALL_ROLES.map((r) => {
        const active = value.includes(r)
        return (
          <label key={r} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 16, cursor: 'pointer',
            background: active ? 'var(--p-light)' : '#fff',
            border: `1px solid ${active ? 'var(--p)' : 'var(--border)'}`,
            color: active ? 'var(--p)' : 'var(--text)', fontSize: 12,
          }}>
            <input
              type="checkbox" checked={active}
              onChange={(e) => {
                if (e.target.checked) onChange([...value, r])
                else onChange(value.filter((v) => v !== r))
              }}
              style={{ margin: 0 }}
            />
            {r}
          </label>
        )
      })}
    </div>
  )
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '90%', maxWidth: 480, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>取消</button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div style={{ paddingTop: 4, textAlign: 'right' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)',
  fontSize: 12, color: 'var(--muted)', fontWeight: 600,
}
const td: React.CSSProperties = { padding: '8px 10px' }
const btnSm: React.CSSProperties = { padding: '4px 10px', fontSize: 12, marginLeft: 6 }
const inp: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
}
const errBox: React.CSSProperties = { padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }
