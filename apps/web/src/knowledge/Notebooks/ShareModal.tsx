/**
 * ShareModal —— Notebook 共享对话框
 *
 * 功能：
 *   - 列出当前 members（user / team），可改 role / 移除
 *   - 加新 member：选 user 邮箱 或 team（dropdown 拉所有 team）
 */
import { useEffect, useState, useCallback } from 'react'
import {
  listMembers, addMember, removeMember,
  type NotebookMember,
} from '@/api/notebooks'
import { listTeams, type TeamSummary } from '@/api/teams'

interface Props {
  open: boolean
  notebookId: number
  notebookName: string
  onClose: () => void
}

export default function ShareModal({ open, notebookId, notebookName, onClose }: Props) {
  const [members, setMembers] = useState<NotebookMember[] | null>(null)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // add form state
  const [subjectType, setSubjectType] = useState<'user' | 'team'>('user')
  const [subjectId, setSubjectId] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')

  const reload = useCallback(async () => {
    if (!open) return
    try {
      const [mb, tm] = await Promise.all([listMembers(notebookId), listTeams()])
      setMembers(mb); setTeams(tm); setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [notebookId, open])

  useEffect(() => {
    if (!open) return
    setSubjectType('user'); setSubjectId(''); setRole('reader'); setErr(null)
    void reload()
  }, [open, reload])

  if (!open) return null

  async function handleAdd() {
    const sid = subjectId.trim()
    if (!sid) { setErr('请填邮箱或选团队'); return }
    if (subjectType === 'user' && !/^[^@\s]+@[^@\s]+$/.test(sid)) {
      setErr('邮箱格式不正确'); return
    }
    setBusy(true); setErr(null)
    try {
      await addMember(notebookId, { subject_type: subjectType, subject_id: sid, role })
      setSubjectId('')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(m: NotebookMember) {
    if (!confirm(`移除 ${m.display}？`)) return
    await removeMember(notebookId, m.subject_type, m.subject_id)
    void reload()
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
           zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
         }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 540, maxWidth: '92vw',
        maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          🔗 共享 「{notebookName}」
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          被共享的用户/团队会在自己的「共享给我的」列表里看到这个 notebook。Reader 只读，Editor 可加资料 / 触发简报。
        </div>

        {/* 添加表单 */}
        <div style={{
          background: '#fafafa', border: '1px solid var(--border)', borderRadius: 8,
          padding: 12, marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>添加成员</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select value={subjectType}
                    onChange={(e) => { setSubjectType(e.target.value as 'user' | 'team'); setSubjectId('') }}
                    style={{ ...fieldStyle, width: 80 }}>
              <option value="user">用户</option>
              <option value="team">团队</option>
            </select>
            {subjectType === 'user' ? (
              <input type="email" value={subjectId}
                     onChange={(e) => setSubjectId(e.target.value)}
                     placeholder="user@example.com"
                     style={{ ...fieldStyle, flex: 1 }} />
            ) : (
              <select value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      style={{ ...fieldStyle, flex: 1 }}>
                <option value="">选择团队…</option>
                {teams.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}（{t.member_count} 人）</option>
                ))}
              </select>
            )}
            <select value={role}
                    onChange={(e) => setRole(e.target.value as 'reader' | 'editor')}
                    style={{ ...fieldStyle, width: 90 }}>
              <option value="reader">只读</option>
              <option value="editor">可编辑</option>
            </select>
            <button type="button" className="btn primary"
                    disabled={busy || !subjectId.trim()}
                    onClick={() => void handleAdd()}>
              {busy ? '...' : '添加'}
            </button>
          </div>
          {err && (
            <div style={{ color: '#b91c1c', fontSize: 11, marginTop: 6 }}>{err}</div>
          )}
        </div>

        {/* 现有成员 */}
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
          已共享{members ? `（${members.length}）` : '…'}
        </div>
        {members === null ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>加载中…</div>
        ) : members.length === 0 ? (
          <div style={{
            padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12,
            background: '#fafafa', borderRadius: 6,
          }}>未共享给任何人</div>
        ) : (
          <div>
            {members.map((m) => (
              <div key={`${m.subject_type}:${m.subject_id}`}
                   style={{
                     display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                     borderBottom: '1px solid var(--border)',
                   }}>
                <span style={{ fontSize: 14 }}>{m.subject_type === 'team' ? '👥' : '👤'}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{m.display}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11,
                  background: m.role === 'editor' ? 'rgba(108,71,255,0.1)' : '#f3f4f6',
                  color: m.role === 'editor' ? 'var(--p,#6C47FF)' : 'var(--muted)',
                }}>{m.role === 'editor' ? '可编辑' : '只读'}</span>
                <button type="button"
                        onClick={() => void handleRemove(m)}
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--muted)',
                          cursor: 'pointer', fontSize: 14, padding: '0 4px',
                        }} title="移除">×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13, background: '#fff', color: 'var(--text)', outline: 'none',
  boxSizing: 'border-box',
}
