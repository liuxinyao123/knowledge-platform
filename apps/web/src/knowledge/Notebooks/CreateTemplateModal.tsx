/**
 * CreateTemplateModal —— N-008 用户自定义模板创建/编辑 Modal
 *
 * 同时支持 create 与 edit：
 *   - mode='create': 全字段必填，提交调 createUserTemplate
 *   - mode='edit'  : 字段可选，提交调 updateUserTemplate(key, patch)
 *
 * 字段约束（与后端 validateUserTemplateInput 一致）：
 *   label                     1..10 chars
 *   icon                      1..2 chars (emoji)
 *   description               1..60 chars
 *   recommendedSourceHint     1..40 chars
 *   recommendedArtifactKinds  0..3 个，∈ ALL_ARTIFACT_KINDS
 *   starterQuestions          1..3 条，每条 1..50 chars
 *
 * 视觉 token 跟其他 Modal 一致：白底 / var(--border) / 主紫 var(--p, #6C47FF) 强调
 */
import { useState, useEffect, useMemo } from 'react'
import {
  ALL_ARTIFACT_KINDS,
  createUserTemplate,
  updateUserTemplate,
  type ArtifactKind,
  type CreateUserTemplateInput,
  type NotebookTemplateSpec,
} from '@/api/notebooks'

interface Props {
  open: boolean
  /** 'create' = 新建；'edit' = 改既有模板（需传 initial） */
  mode: 'create' | 'edit'
  /** edit 模式下传入要编辑的模板 */
  initial?: NotebookTemplateSpec
  onClose: () => void
  /** 创建/编辑成功回调，参数是后端返回的 spec */
  onSaved: (spec: NotebookTemplateSpec) => void
}

export default function CreateTemplateModal({
  open, mode, initial, onClose, onSaved,
}: Props) {
  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState('🧪')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [kinds, setKinds] = useState<ArtifactKind[]>([])
  const [questions, setQuestions] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initial) {
      setLabel(initial.label)
      setIcon(initial.icon)
      setDescription(initial.desc)
      setHint(initial.recommendedSourceHint)
      setKinds([...initial.recommendedArtifactKinds])
      setQuestions(initial.starterQuestions.length > 0 ? [...initial.starterQuestions] : [''])
    } else {
      setLabel(''); setIcon('🧪'); setDescription(''); setHint('')
      setKinds([]); setQuestions([''])
    }
    setServerErr(null); setBusy(false)
  }, [open, mode, initial])

  // 内联校验 errors
  const errors = useMemo(() => validateForm({ label, icon, description, hint, kinds, questions }), [
    label, icon, description, hint, kinds, questions,
  ])
  const canSubmit = !busy && Object.keys(errors).length === 0

  if (!open) return null

  async function submit() {
    if (!canSubmit) return
    setBusy(true); setServerErr(null)
    try {
      const cleaned: CreateUserTemplateInput = {
        label: label.trim(),
        icon: icon.trim(),
        description: description.trim(),
        recommendedSourceHint: hint.trim(),
        recommendedArtifactKinds: kinds,
        starterQuestions: questions.map((q) => q.trim()).filter((q) => q.length > 0),
      }
      let spec: NotebookTemplateSpec
      if (mode === 'create') {
        spec = await createUserTemplate(cleaned)
      } else {
        if (!initial) throw new Error('edit 模式缺 initial')
        spec = await updateUserTemplate(initial.id, cleaned)
      }
      onSaved(spec)
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string; errors?: Record<string, string> } } })
        ?.response?.data
      if (msg?.errors) {
        setServerErr(Object.values(msg.errors).join(' / '))
      } else {
        setServerErr(msg?.error ?? (e instanceof Error ? e.message : '保存失败'))
      }
      setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={overlay}>
      <div style={modal}>
        <div style={titleStyle}>
          {mode === 'create' ? '+ 创建我的模板' : `✎ 编辑模板`}
        </div>

        <Field label="名称" errMsg={errors.label} hint="≤ 10 字">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 maxLength={12}  /* 多给 2 字给 UI 提示，后端仍按 10 校验 */
                 placeholder="如：周报草稿" autoFocus style={fieldInput} />
        </Field>

        <Field label="图标" errMsg={errors.icon} hint="emoji，1-2 字符">
          <input value={icon} onChange={(e) => setIcon(e.target.value)}
                 maxLength={4} placeholder="🧪" style={{ ...fieldInput, width: 80 }} />
        </Field>

        <Field label="描述" errMsg={errors.description} hint="≤ 60 字">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                    maxLength={70} rows={2} placeholder="一句话说这个模板用来干嘛"
                    style={{ ...fieldInput, resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>

        <Field label="资料提示" errMsg={errors.hint} hint="≤ 40 字">
          <input value={hint} onChange={(e) => setHint(e.target.value)}
                 maxLength={50} placeholder="如：上传周会议纪要 / 项目状态文档"
                 style={fieldInput} />
        </Field>

        <Field label="推荐生成" errMsg={errors.kinds} hint="0-3 个">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ALL_ARTIFACT_KINDS.map((k) => {
              const picked = kinds.includes(k)
              const disabled = !picked && kinds.length >= 3
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setKinds(picked ? kinds.filter((x) => x !== k) : [...kinds, k])
                  }}
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    border: `1px solid ${picked ? 'var(--p, #6C47FF)' : 'var(--border)'}`,
                    background: picked ? 'var(--p, #6C47FF)' : '#fff',
                    color: picked ? '#fff' : 'var(--text)',
                    borderRadius: 999,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                  }}
                >{k}</button>
              )
            })}
          </div>
        </Field>

        <Field label="起手提问" errMsg={errors.questions} hint="1-3 条，每条 ≤ 50 字">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {questions.map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input
                  value={q}
                  onChange={(e) => {
                    const next = [...questions]
                    next[i] = e.target.value
                    setQuestions(next)
                  }}
                  maxLength={60}
                  placeholder={`第 ${i + 1} 条...`}
                  style={fieldInput}
                />
                {questions.length > 1 && (
                  <button type="button"
                          aria-label={`删除第 ${i + 1} 条`}
                          onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                          style={smallIconBtn}>×</button>
                )}
              </div>
            ))}
            {questions.length < 3 && (
              <button type="button"
                      onClick={() => setQuestions([...questions, ''])}
                      style={addRowBtn}>+ 加一条</button>
            )}
          </div>
        </Field>

        {serverErr && (
          <div style={errBox}>{serverErr}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn primary"
                  disabled={!canSubmit}
                  onClick={() => void submit()}>
            {busy ? '保存中…' : (mode === 'create' ? '创建' : '保存')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 校验 ────────────────────────────────────────────────────────────────────

interface FormState {
  label: string; icon: string; description: string; hint: string
  kinds: ArtifactKind[]; questions: string[]
}

function validateForm(s: FormState): Record<string, string> {
  const e: Record<string, string> = {}
  const label = s.label.trim()
  if (label.length === 0) e.label = '必填'
  else if (label.length > 10) e.label = '最多 10 字'
  const icon = s.icon.trim()
  if (icon.length === 0) e.icon = '必填'
  else if (icon.length > 2) e.icon = '最多 2 字符'
  const desc = s.description.trim()
  if (desc.length === 0) e.description = '必填'
  else if (desc.length > 60) e.description = '最多 60 字'
  const hint = s.hint.trim()
  if (hint.length === 0) e.hint = '必填'
  else if (hint.length > 40) e.hint = '最多 40 字'
  if (s.kinds.length > 3) e.kinds = '最多 3 个'
  const qs = s.questions.map((q) => q.trim()).filter((q) => q.length > 0)
  if (qs.length < 1) e.questions = '至少 1 条'
  else if (qs.length > 3) e.questions = '最多 3 条'
  else if (qs.some((q) => q.length > 50)) e.questions = '每条最多 50 字'
  return e
}

// ── 视觉 ────────────────────────────────────────────────────────────────────

function Field({ label, hint, errMsg, children }: {
  label: string; hint?: string; errMsg?: string; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {hint}</span>}
        {errMsg && <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 'auto' }}>{errMsg}</span>}
      </div>
      {children}
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const modal: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '92vw',
  maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
}
const titleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 16,
}
const fieldInput: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 13, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
}
const smallIconBtn: React.CSSProperties = {
  width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6,
  background: '#fff', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  flexShrink: 0,
}
const addRowBtn: React.CSSProperties = {
  alignSelf: 'flex-start', padding: '4px 12px', background: 'transparent',
  border: '1px dashed var(--border)', borderRadius: 999, color: 'var(--p, #6C47FF)',
  fontSize: 12, cursor: 'pointer',
}
const errBox: React.CSSProperties = {
  padding: 10, marginTop: 4, background: '#fee2e2', color: '#b91c1c',
  borderRadius: 8, fontSize: 12,
}
