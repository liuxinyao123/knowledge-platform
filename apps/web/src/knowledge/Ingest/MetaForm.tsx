import { useEffect, useState } from 'react'
import type { Row } from './Wizard'

interface Props {
  row: Row | null
  categories: string[]
  onApply: (patch: Partial<Row>) => void
}

export default function MetaForm({ row, categories, onApply }: Props) {
  const [tagsInput, setTagsInput] = useState('')
  const [category, setCategory]   = useState('其它')
  const [summary, setSummary]     = useState('')

  useEffect(() => {
    // 故意只在 row.id 或 phase 变化时重置表单——用户编辑后不想被同源同步覆盖。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTagsInput(row?.tags.join(', ') ?? '')
    setCategory(row?.category ?? '其它')
    setSummary(row?.overrideSummary ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.phase])

  const disabled = !row

  const handleApply = () => {
    if (!row) return
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean)
    onApply({
      tags,
      category,
      overrideSummary: summary.trim() || undefined,
    })
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column', maxHeight: 520, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>
        元数据
      </div>

      <div style={{ flex: 1, padding: 14, overflowY: 'auto', opacity: disabled ? 0.5 : 1 }}>
        <Field label="Tags（逗号分隔）">
          <input
            disabled={disabled}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="如：财务,2026,合同"
            style={inp}
          />
        </Field>

        <Field label="分类">
          <select disabled={disabled} value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>

        <Field label={`覆盖摘要${row?.extract?.kind === 'text' && row.extract.summary ? '（默认已有自动摘要）' : ''}`}>
          <textarea
            disabled={disabled || row?.extract?.kind === 'attachment'}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            placeholder="留空则使用解析出的默认摘要（若有）"
            style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        {row && (
          <div style={{
            marginTop: 10, padding: 10, background: '#f9fafb', borderRadius: 6,
            fontSize: 11, color: 'var(--muted)',
          }}>
            当前应用：
            {row.tags.length === 0 && <span style={{ display: 'block' }}>· 无 tags</span>}
            {row.tags.length > 0 && (
              <span style={{ display: 'block' }}>
                · tags: {row.tags.map((t) => <code key={t} style={{ background: '#fff', padding: '0 6px', marginRight: 4, borderRadius: 4 }}>{t}</code>)}
              </span>
            )}
            <span style={{ display: 'block' }}>· 分类: {row.category}</span>
            {row.overrideSummary && (
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · 覆盖摘要已设 ({row.overrideSummary.length} 字)
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-primary" disabled={disabled} onClick={handleApply} style={{ width: '100%' }}>
          应用到当前文件
        </button>
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
