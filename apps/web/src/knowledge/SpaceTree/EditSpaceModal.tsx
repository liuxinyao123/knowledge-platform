/**
 * EditSpaceModal —— 空间信息编辑 + 删除入口
 * 只 admin+ 可用；删除按钮仅 owner 可见
 */
import { useState } from 'react'
import { type SpaceDetail, type SpaceVisibility, updateSpace, deleteSpace } from '@/api/spaces'

interface Props {
  space: SpaceDetail
  onClose: () => void
  onSaved: () => void
}

export default function EditSpaceModal({ space, onClose, onSaved }: Props) {
  const [name, setName] = useState(space.name)
  const [description, setDescription] = useState(space.description ?? '')
  const [visibility, setVisibility] = useState<SpaceVisibility>(space.visibility)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isOwner = space.my_role === 'owner'

  async function save() {
    setSaving(true); setErr(null)
    try {
      if (!name.trim()) throw new Error('名称不能为空')
      await updateSpace(space.id, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setErr(null)
    if (!confirm(`确认删除空间「${space.name}」？此操作不可撤销，空间内权限规则会级联删除（不影响 org 级规则）。`)) return
    try {
      await deleteSpace(space.id)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
          编辑空间
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
          <label>
            <div style={lbl}>名称</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inp} />
          </label>
          <label>
            <div style={lbl}>描述</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inp} />
          </label>
          <label>
            <div style={lbl}>可见范围</div>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as SpaceVisibility)} style={inp}>
              <option value="org">组织内（仅 org 成员可见）</option>
              <option value="private">私有（仅空间成员）</option>
            </select>
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Slug: <code>{space.slug}</code>（slug 不可更改）
          </div>
          {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
        </div>
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
        }}>
          {isOwner && (
            <button className="btn" style={{ color: '#B91C1C' }} onClick={() => void handleDelete()}>
              删除空间
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} style={{ marginRight: 6 }}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalBox: React.CSSProperties = { width: '90%', maxWidth: 520, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }
