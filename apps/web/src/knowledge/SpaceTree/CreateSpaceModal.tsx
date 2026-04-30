/**
 * CreateSpaceModal —— 新建空间
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createSpace, type SpaceVisibility } from '@/api/spaces'

interface Props {
  onClose: () => void
  onCreated: (id: number) => void
}

export default function CreateSpaceModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('spaces')
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
      if (!name.trim()) throw new Error(t('create.errorRequired'))
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(t('create.errorSlug'))
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
          {t('create.title')}
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
          <label>
            <div style={lbl}>{t('create.fieldName')}</div>
            <input value={name} onChange={(e) => autoSlug(e.target.value)} style={inp} autoFocus />
          </label>
          <label>
            <div style={lbl}>{t('create.fieldSlug')}</div>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ ...inp, fontFamily: 'monospace' }} />
          </label>
          <label>
            <div style={lbl}>{t('create.fieldDescription')}</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inp} />
          </label>
          <label>
            <div style={lbl}>{t('create.fieldVisibility')}</div>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as SpaceVisibility)} style={inp}>
              <option value="org">{t('create.visibilityOrg')}</option>
              <option value="private">{t('create.visibilityPrivate')}</option>
            </select>
          </label>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {t('create.ownerNote')}
          </div>
          {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
        </div>
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button className="btn" onClick={onClose} style={{ marginRight: 6 }}>{t('common:actions.cancel')}</button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? t('create.submitting') : t('create.submit')}
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
