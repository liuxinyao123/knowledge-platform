/**
 * ChangePasswordModal —— 自助改密
 */
import { useState } from 'react'
import { userAdmin } from '@/api/iam'

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function handleSave() {
    if (!oldPw) { setErr('请输入旧密码'); return }
    if (!newPw) { setErr('请输入新密码'); return }
    if (newPw.length < 8) { setErr('新密码至少 8 字符'); return }
    if (newPw !== newPw2) { setErr('两次新密码不一致'); return }
    setBusy(true); setErr(null)
    try {
      await userAdmin.changeOwnPassword(oldPw, newPw)
      setOk(true)
    } catch (e) {
      const m = (e as { response?: { status?: number; data?: { error?: string } } })
      if (m?.response?.status === 401) setErr('旧密码不正确')
      else setErr(m?.response?.data?.error || '修改失败')
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '90%', maxWidth: 420, background: '#fff', borderRadius: 12 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex' }}>
          <div style={{ fontWeight: 700 }}>修改密码</div>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>{ok ? '关闭' : '取消'}</button>
        </div>
        <div style={{ padding: 20 }}>
          {ok ? (
            <div style={{ padding: 14, background: '#f0fdf4', color: '#166534', borderRadius: 6, fontSize: 13 }}>
              ✓ 密码已更新。下次登录请使用新密码。
            </div>
          ) : (
            <>
              <Field label="旧密码">
                <input value={oldPw} onChange={(e) => setOldPw(e.target.value)} type="password" style={inp} />
              </Field>
              <Field label="新密码（≥8 字符）">
                <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" style={inp} />
              </Field>
              <Field label="再次输入新密码">
                <input value={newPw2} onChange={(e) => setNewPw2(e.target.value)} type="password" style={inp} />
              </Field>
              {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
              <div style={{ textAlign: 'right', marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleSave()}
                >
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
}
