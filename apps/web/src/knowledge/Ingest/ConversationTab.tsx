/**
 * ConversationTab —— 对话沉淀 Tab
 * 用户填 title + 一段 JSON 或 plain text，转成 markdown 入库
 *
 * 接受两种输入：
 *   1. JSON：[{role:"user", text:"..."}, {role:"assistant", text:"..."}]
 *   2. Plain text：每行 "user: ..." 或 "assistant: ..." 自动解析
 */
import { useState } from 'react'
import { ingestConversation } from '@/api/ingest'
import { configToOptions, type IngestConfig } from './IngestConfigPanel'

interface Props {
  config: IngestConfig
  onSubmitted: () => void
}

const SAMPLE = `user: 我们 Q1 的指标治理目标是什么？
assistant: 主要三块：1) 指标口径文档化覆盖率 ≥ 80%；2) 异常告警 24h 闭环；3) 重复指标合并 30+
user: 那闭环率现在多少？
assistant: 上周拉的数是 76%，离目标还差 4 个点，主要卡在数仓侧的 owner 不响应。`

function parseInput(raw: string): Array<{ role: string; text: string }> {
  const trimmed = raw.trim()
  if (!trimmed) return []
  // try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      return arr
        .map((m: unknown) => {
          const mm = (m ?? {}) as { role?: unknown; text?: unknown; content?: unknown }
          return {
            role: typeof mm.role === 'string' ? mm.role : 'user',
            text: typeof mm.text === 'string' ? mm.text : typeof mm.content === 'string' ? mm.content : '',
          }
        })
        .filter((m) => m.text.trim())
    } catch {
      // fall through to text parse
    }
  }
  // text parse: split by lines, role: text
  const lines = trimmed.split(/\r?\n/)
  const out: Array<{ role: string; text: string }> = []
  let current: { role: string; text: string } | null = null
  for (const line of lines) {
    const m = line.match(/^(user|assistant|system|用户|助手|系统)\s*[:：]\s*(.*)$/i)
    if (m) {
      if (current) out.push(current)
      const role = m[1].toLowerCase()
      const norm =
        role === '用户' ? 'user' :
        role === '助手' ? 'assistant' :
        role === '系统' ? 'system' : role
      current = { role: norm, text: m[2] }
    } else if (current) {
      current.text += '\n' + line
    } else {
      // line without role prefix → treat as user
      current = { role: 'user', text: line }
    }
  }
  if (current) out.push(current)
  return out.filter((m) => m.text.trim())
}

export default function ConversationTab({ config, onSubmitted }: Props) {
  const [title, setTitle] = useState('')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseInput(raw)

  async function submit() {
    if (parsed.length === 0) { setError('内容为空，无法解析出消息'); return }
    setBusy(true); setError(null)
    try {
      await ingestConversation(title.trim() || '对话沉淀', parsed, configToOptions(config))
      setRaw(''); setTitle('')
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'submit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="conversation-tab" style={{
      border: '2px dashed var(--border)', borderRadius: 12,
      padding: '24px 20px', background: '#fafafa',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        粘贴对话内容
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        支持 JSON（[{`{role,text}`}]）或 「user: ... / assistant: ...」纯文本格式
      </div>

      <input
        type="text"
        value={title}
        placeholder="对话标题（可选）"
        onChange={(e) => setTitle(e.target.value)}
        style={{
          width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: 'border-box',
          background: '#fff', color: 'var(--text)', outline: 'none',
        }}
        data-testid="conv-title"
      />

      <textarea
        value={raw}
        placeholder={SAMPLE}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box',
          background: '#fff', color: 'var(--text)', outline: 'none', resize: 'vertical',
        }}
        data-testid="conv-text"
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 10,
      }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
          已解析 {parsed.length} 条消息
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => setRaw(SAMPLE)}
          disabled={busy}
          data-testid="conv-sample"
        >
          填入示例
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || parsed.length === 0}
          onClick={() => void submit()}
          data-testid="conv-submit"
        >
          {busy ? '提交中…' : '沉淀入库'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 10, padding: 10, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{error}</div>
      )}
    </div>
  )
}
