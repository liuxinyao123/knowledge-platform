/**
 * ChatPanel —— Notebook 中的对话区
 *
 * - 流式 SSE：POST /api/notebooks/:id/chat
 * - 行内引用 [^N] 渲染为可点击 sup；hover 卡片显示原 chunk 片段
 * - 历史消息从 messages prop 来；新消息边流边累计
 */
// 2026-04-25 unblock build: 删了无用的 `type Fragment as FragmentType` 别名 + 文末的 void 占位 hack
import { useEffect, useRef, useState } from 'react'
import { Fragment } from 'react'
import { tokenStorage } from '@/auth/tokenStorage'
import type { NotebookMessage, Citation, NotebookSource } from '@/api/notebooks'
import RewriteBadge, { extractCondenseRewrite } from '@/components/RewriteBadge'

type StreamingState = 'idle' | 'thinking' | 'streaming' | 'done' | 'error'

interface InflightAi {
  content: string
  citations: Citation[]
  ragSteps: Array<{ icon: string; label: string }>
  state: StreamingState
  error?: string
}

interface Props {
  notebookId: number
  messages: NotebookMessage[]
  sources: NotebookSource[]
  /** 提交后 reload，把新消息从服务端拉下来 */
  onPersisted: () => void
  /** 用户点引用 [^N] 时，通知父组件 highlight Sources 列表里的对应 asset */
  onCitationClick?: (assetId: number) => void
  /** N-006：父组件预填 input（如 TemplateHintCard 推荐起手问题）；变化时覆盖 input */
  prefillInput?: string | null
  /** N-006：input 已消费 prefill 的回调，让父组件 reset prefill state */
  onPrefillConsumed?: () => void
}

export default function ChatPanel({
  notebookId, messages, sources, onPersisted, onCitationClick,
  prefillInput, onPrefillConsumed,
}: Props) {
  const [input, setInput] = useState('')

  // N-006：父组件传入 prefill 时，覆盖 input + 通知父组件清空 prefill state
  useEffect(() => {
    if (prefillInput) {
      setInput(prefillInput)
      onPrefillConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillInput])
  const [inflight, setInflight] = useState<InflightAi | null>(null)
  // optimistic：发送瞬间就把用户气泡显示出来；reload 把后端持久化的 message 拉回来后再清掉
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const lastSeenCountRef = useRef<number>(messages.length)

  // 自动滚到底
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (isNearBottom) el.scrollTop = el.scrollHeight
  }, [messages, inflight, pendingUser])

  // messages 数组增长 → 后端已经把用户消息持久化并回拉，可以清掉 optimistic 气泡
  useEffect(() => {
    if (messages.length > lastSeenCountRef.current && pendingUser) {
      setPendingUser(null)
    }
    lastSeenCountRef.current = messages.length
  }, [messages.length, pendingUser])

  async function send() {
    const q = input.trim()
    if (!q || inflight) return
    setInput('')
    const ac = new AbortController()
    abortRef.current = ac

    // 立刻显示用户气泡 + thinking 状态的助手气泡
    setPendingUser(q)
    setInflight({ content: '', citations: [], ragSteps: [], state: 'thinking' })

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      }
      const token = tokenStorage.get()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const resp = await fetch(`/api/notebooks/${notebookId}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: q }),
        signal: ac.signal,
      })
      if (!resp.ok || !resp.body) {
        let detail = ''
        try { detail = (await resp.text()).slice(0, 200) } catch { /* */ }
        throw new Error(`HTTP ${resp.status}${detail ? ` · ${detail}` : ''}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''
        for (const block of blocks) {
          const trimmed = block.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload) continue
          let evt: { type: string; [k: string]: unknown }
          try { evt = JSON.parse(payload) } catch { continue }

          setInflight((prev) => {
            if (!prev) return prev
            if (evt.type === 'rag_step') {
              return {
                ...prev,
                state: prev.state === 'thinking' ? 'thinking' : prev.state,
                ragSteps: [...prev.ragSteps, { icon: String(evt.icon ?? ''), label: String(evt.label ?? '') }],
              }
            }
            if (evt.type === 'content') {
              return { ...prev, state: 'streaming', content: prev.content + String(evt.text ?? '') }
            }
            if (evt.type === 'trace') {
              const data = evt.data as { citations?: Citation[] } | undefined
              return { ...prev, citations: data?.citations ?? prev.citations }
            }
            if (evt.type === 'error') {
              return { ...prev, state: 'error', error: String(evt.message ?? 'unknown') }
            }
            if (evt.type === 'done') {
              return { ...prev, state: prev.state === 'error' ? 'error' : 'done' }
            }
            return prev
          })
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setInflight((p) => p ? { ...p, state: 'error', error: err.message } : p)
      }
    } finally {
      abortRef.current = null
      // 短暂停留让用户看到完成 → 然后清掉 inflight、reload 历史
      setTimeout(() => {
        setInflight(null)
        onPersisted()
      }, 300)
    }
  }

  function abort() {
    abortRef.current?.abort()
    setInflight(null)
    setPendingUser(null)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      {/* 消息流 */}
      <div ref={logRef} style={{
        flex: 1, overflowY: 'auto', padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {messages.length === 0 && !inflight && !pendingUser && (
          <EmptyChatHint hasSources={sources.length > 0} />
        )}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content}
                  citations={m.citations ?? []} onCitationClick={onCitationClick} />
        ))}
        {pendingUser && (
          <Bubble role="user" content={pendingUser} citations={[]} />
        )}
        {inflight && (
          <InflightBubble inflight={inflight} onCitationClick={onCitationClick} />
        )}
      </div>

      {/* 输入区 */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '10px 12px',
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
          }}
          placeholder={sources.length === 0
            ? '先添加资料后再提问'
            : '问点什么…（Shift+Enter 换行）'}
          rows={2}
          disabled={!!inflight || sources.length === 0}
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'none',
            outline: 'none', background: '#fff', color: 'var(--text)',
          }}
        />
        {inflight ? (
          <button type="button" className="btn danger" onClick={abort}
                  style={{ whiteSpace: 'nowrap' }}>■ 终止</button>
        ) : (
          <button type="button" className="btn primary"
                  disabled={!input.trim() || sources.length === 0}
                  onClick={() => void send()} style={{ whiteSpace: 'nowrap' }}>发送</button>
        )}
      </div>
    </div>
  )
}

function EmptyChatHint({ hasSources }: { hasSources: boolean }) {
  return (
    <div style={{
      padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13,
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
      <div>{hasSources
        ? '提问吧 —— 答案会严格基于左侧资料，并标 [^N] 引用'
        : '左侧先添加资料，然后回这里提问'}</div>
    </div>
  )
}

function InflightBubble({ inflight, onCitationClick }: {
  inflight: InflightAi
  onCitationClick?: (assetId: number) => void
}) {
  // N-004：condense 改写徽标（thinking → streaming → done 三态都显示）
  const rewrite = extractCondenseRewrite(inflight.ragSteps)

  if (inflight.state === 'thinking') {
    return (
      <div>
        {rewrite && <RewriteBadge from={rewrite.from} to={rewrite.to} />}
        <Bubble role="assistant"
                content={inflight.ragSteps.map((s) => `${s.icon} ${s.label}`).join('\n') || '思考中…'}
                citations={[]} onCitationClick={onCitationClick} live />
      </div>
    )
  }
  if (inflight.state === 'error') {
    return (
      <div>
        {rewrite && <RewriteBadge from={rewrite.from} to={rewrite.to} />}
        <Bubble role="assistant"
                content={`❌ ${inflight.error ?? '失败'}`}
                citations={[]} onCitationClick={onCitationClick} />
      </div>
    )
  }
  return (
    <div>
      {rewrite && <RewriteBadge from={rewrite.from} to={rewrite.to} />}
      <Bubble role="assistant"
              content={inflight.content}
              citations={inflight.citations}
              onCitationClick={onCitationClick}
              live={inflight.state === 'streaming'} />
    </div>
  )
}

// ── Bubble + 行内引用渲染 ────────────────────────────────────────────────────

function Bubble({
  role, content, citations, onCitationClick, live,
}: {
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  onCitationClick?: (assetId: number) => void
  live?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      gap: 4,
    }}>
      <div style={{
        background: isUser ? 'var(--p, #6C47FF)' : 'rgba(108,71,255,0.06)',
        color: isUser ? '#fff' : 'var(--text)',
        padding: '10px 14px', borderRadius: 12,
        maxWidth: '90%',
        fontSize: 14, lineHeight: 1.7,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {isUser ? content : <AssistantContent content={content} citations={citations} onClick={onCitationClick} live={live} />}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 4px' }}>
        {isUser ? '你' : '助手'}
      </div>
    </div>
  )
}

/**
 * 把 assistant 文本里的 [^N] 替换成可点击 sup
 * 同时支持 hover 卡片显示对应 citation 内容
 */
function AssistantContent({
  content, citations, onClick, live,
}: {
  content: string
  citations: Citation[]
  onClick?: (assetId: number) => void
  live?: boolean
}) {
  // 按 [^N] 切片
  const parts: Array<{ kind: 'text'; text: string } | { kind: 'cite'; n: number }> = []
  const re = /\[\^(\d+)\]/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: 'text', text: content.slice(lastIdx, m.index) })
    parts.push({ kind: 'cite', n: Number(m[1]) })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < content.length) parts.push({ kind: 'text', text: content.slice(lastIdx) })

  return (
    <>
      {parts.map((p, i) => p.kind === 'text'
        ? <Fragment key={i}>{p.text}</Fragment>
        : <CiteSup key={i} n={p.n} citation={citations.find((c) => c.index === p.n)} onClick={onClick} />)}
      {live && (
        <span style={{
          display: 'inline-block', width: 2, height: '1em', marginLeft: 2,
          background: 'var(--p, #6C47FF)', verticalAlign: 'text-bottom',
          animation: 'cursor-blink 1s step-end infinite',
        }} />
      )}
      <style>{`@keyframes cursor-blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </>
  )
}

function CiteSup({ n, citation, onClick }: {
  n: number
  citation: Citation | undefined
  onClick?: (assetId: number) => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <sup
        onClick={() => citation && onClick && onClick(citation.asset_id)}
        style={{
          padding: '1px 6px', margin: '0 2px',
          background: citation ? 'var(--p, #6C47FF)' : '#9ca3af',
          color: '#fff', borderRadius: 999,
          fontSize: 10, fontWeight: 600, cursor: citation ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        title={citation ? `${citation.asset_name}（点击高亮 source）` : `引用 [${n}] 不在 trace 中`}
      >{n}</sup>
      {hover && citation && (
        <span style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          background: '#1f2937', color: '#fff',
          padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          maxWidth: 360, minWidth: 240, zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          whiteSpace: 'normal',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{citation.asset_name}</div>
          {citation.image_url && (
            <img
              src={citation.image_url}
              alt={citation.chunk_content.slice(0, 40)}
              data-testid="notebook-citation-thumbnail"
              style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 4, marginBottom: 6, display: 'block' }}
              loading="lazy"
            />
          )}
          <div style={{ color: '#d1d5db', fontStyle: 'italic' }}>
            {citation.chunk_content.slice(0, 200)}{citation.chunk_content.length > 200 ? '…' : ''}
          </div>
        </span>
      )}
    </span>
  )
}

