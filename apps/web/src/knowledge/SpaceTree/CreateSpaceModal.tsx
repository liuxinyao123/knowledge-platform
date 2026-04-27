/**
 * CreateSpaceModal —— 新建空间
 */
import { useState } from 'react'
import { createSpace, type SpaceVisibility } from '@/api/spaces'

interface Props {
  onClose: () => void
  onCreated: (id: number) => void
}

export default function CreateSpaceModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<SpaceVisibility>('org')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function autoSlug(v: string) {
    setName(v)
    if (!slug) {
      const s = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      if (s) setSlug(s)
    }
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      if (!name.trim()) throw new Error('名称不能为空')
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('slug 必须小写字母/数字/短横线')
      const { id } = await createSpace({
        slug,
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      })
      onCreated(id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
          新建空间
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
          <label>
            <div style={lbl}>名称</div>
            <input value={name} onChange={(e) => autoSlug(e.target.value)} style={inp} autoFocus />
          </label>
          <label>
            <div style={lbl}>slug（URL 友好，小写 + 数字 + 短横线）</div>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ ...inp, fontFamily: 'monospace' }} />
          </label>
          <label>
            <div style={lbl}>描述（可选）</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inp} />
          </label>
          <label>
            <div style={lbl}>可见范围</div>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as SpaceVisibility)} style={inp}>
              <option value="org">组织内</option>
              <option value="private">私有</option>
            </select>
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            创建后当前账号自动成为所有者；组织内空间默认对所有登录用户可见。
          </div>
          {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
        </div>
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button className="btn" onClick={onClose} style={{ marginRight: 6 }}>取消</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', marginBottom: 4 }
const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalBox: React.CSSProperties = { width: '90%', maxWidth: 500, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }
