/**
 * CreateSourceModal —— 新建数据源（PG metadata_source）
 *
 * 2026-04-23-26 space-permissions 改名：原本叫「新建空间」是因为旧模型把
 * metadata_source 当空间用；新模型下 "空间" = `space` 实体，这里只管建数据源。
 *
 * 字段：
 *   - 名称（必填）
 *   - 描述（选填）→ 存到 metadata_source.config.description
 *
 * type / connector 当前不开放给用户选；默认 type='document', connector='manual'。
 * 后续接 BookStack / 飞书 / 文件夹扫描等连接器时再扩。
 */
import { useState, useEffect, useRef } from 'react'
import { createPgSource, type PgSourceRow } from '@/api/assetDirectory'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (source: PgSourceRow) => void
}

export default function CreateSourceModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(''); setDesc(''); setErr(null); setBusy(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  if (!open) return null

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('请输入数据源名'); return }
    if (trimmed.length > 256) { setErr('名称过长（≤ 256）'); return }
    setBusy(true); setErr(null)
    try {
      const src = await createPgSource({ name: trimmed, description: desc.trim() || undefined })
      onCreated(src)
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
      const detail = msg.response?.data?.error
      if (detail === 'name already exists') {
        setErr('该数据源名已存在')
      } else {
        setErr(detail ?? msg.message ?? '创建失败')
      }
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      data-testid="create-source-modal"
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
          boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          新建数据源
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
          创建一个数据源（metadata_source）；之后可在 /ingest 选作入库目标，或在空间里关联它
        </div>

        <div style={{ marginBottom: 12 }}>
          <Label>数据源名称 <span style={{ color: '#dc2626' }}>*</span></Label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            placeholder="如：治理规范 / 入库 SOP / 指标体系"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void submit()
              if (e.key === 'Escape') onClose()
            }}
            data-testid="create-source-name"
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <Label>描述（选填）</Label>
          <textarea
            value={desc}
            placeholder="简短说明这个数据源放什么内容、谁来维护"
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            data-testid="create-source-desc"
            style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {err && (
          <div style={{
            padding: 10, marginBottom: 12,
            background: '#fee2e2', color: '#b91c1c',
            borderRadius: 8, fontSize: 12,
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy}
            data-testid="create-source-cancel"
          >取消</button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="create-source-submit"
          >{busy ? '创建中…' : '创建'}</button>
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
  return (
    <div style={{
      fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
      letterSpacing: 0.4, marginBottom: 4,
    }}>{children}</div>
  )
}
