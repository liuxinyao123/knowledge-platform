/**
 * /agent —— Agent 控制台
 *
 * 左：对话流（复用 QA 气泡）
 * 中：dispatch 轨迹（消费 agent_selected + rag_step 事件的时间轴）
 * 右：trace / tool 调用详情
 *
 * 路由器把请求打到 /api/agent/dispatch（agent-orchestrator change）。
 */
import { useState, useRef, useLayoutEffect, useCallback } from 'react'
import { tokenStorage } from '@/auth/tokenStorage'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import ConfidenceBadge from '@/components/ConfidenceBadge'

// ── 类型 ─────────────────────────────────────────────────────────────

type AgentIntent = 'knowledge_qa' | 'data_admin' | 'structured_query' | 'metadata_ops'
type HintIntent = '' | AgentIntent

interface RagStep { icon: string; label: string; atMs: number }
interface AgentSelected {
  intent: AgentIntent; agent: string; confidence: number; reason: string; fallback: boolean
}
interface Citation {
  index: number; asset_id: number; asset_name: string; chunk_content: string; score: number
}

type BubbleState = 'thinking' | 'active' | 'streaming' | 'done' | 'error'

interface AiMessage {
  id: string
  bubbleState: BubbleState
  ragSteps: RagStep[]
  content: string
  selected: AgentSelected | null
  trace: Record<string, unknown> | null
  citations: Citation[]
  startAt: number
  endAt?: number
  error?: string
}

interface UserMessage { role: 'user'; content: string }
type Message = UserMessage | ({ role: 'ai' } & AiMessage)

const SESSION_KEY = 'kc_agent_session_id'

function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

// ── 小组件 ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--p)', display: 'inline-block',
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </span>
  )
}

function IntentPill({ sel }: { sel: AgentSelected }) {
  const color = sel.fallback ? '#ef6c00' : '#2e7d32'
  return (
    <span style={{
      display: 'inline-flex', gap: 6, alignItems: 'center',
      padding: '2px 8px', borderRadius: 999, fontSize: 11,
      background: `${color}22`, color,
    }}>
      {sel.intent}
      <span style={{ opacity: 0.7 }}>
        {sel.fallback ? 'fallback' : `${Math.round(sel.confidence * 100)}%`}
      </span>
    </span>
  )
}

function AiBubble({ msg }: { msg: AiMessage }) {
  const duration = msg.endAt ? msg.endAt - msg.startAt : undefined
  return (
    <div
      data-testid={`bubble-${msg.bubbleState}`}
      style={{
        background: 'var(--p-light)',
        border: '1px solid var(--p-mid)',
        borderRadius: 12, padding: '12px 14px',
        fontSize: 14, lineHeight: 1.6,
        color: msg.bubbleState === 'error' ? 'var(--red)' : 'var(--text)',
        width: '100%', boxSizing: 'border-box',
      }}
    >
      {msg.selected && (
        <div style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
          <IntentPill sel={msg.selected} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {msg.selected.agent}
            {duration != null ? ` · ${duration}ms` : ''}
          </span>
        </div>
      )}

      {msg.bubbleState === 'thinking' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThinkingDots />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>派发中...</span>
        </div>
      )}

      {msg.bubbleState === 'active' && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {msg.ragSteps.map((s, i) => (
            <div key={i}>{s.icon} {s.label}</div>
          ))}
        </div>
      )}

      {(msg.bubbleState === 'streaming' || msg.bubbleState === 'done') && (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}>
          {msg.content}
          {msg.bubbleState === 'streaming' && (
            <span style={{
              display: 'inline-block', width: 2, height: '1em',
              background: 'var(--p)', verticalAlign: 'text-bottom',
              animation: 'cursor-blink 1s step-end infinite', marginLeft: 2,
            }} />
          )}
          <style>{`@keyframes cursor-blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        </div>
      )}

      {msg.bubbleState === 'error' && (
        <div>{msg.error ?? '请求失败'}</div>
      )}
    </div>
  )
}

function parseSseEvent(block: string): any | null {
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) {
      const json = trimmed.slice(5).trim()
      if (json) {
        try { return JSON.parse(json) } catch { /* ignore */ }
      }
    }
  }
  return null
}

// ── 主组件 ─────────────────────────────────────────────────────────────

export default function Agent() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [hintIntent, setHintIntent] = useState<HintIntent>('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string>(getOrCreateSessionId())

  useLayoutEffect(() => {
    const el = chatLogRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    if (near || loading) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  const updateAi = useCallback((id: string, f: (m: AiMessage) => AiMessage) => {
    setMessages((prev) => prev.map((m) =>
      m.role === 'ai' && m.id === id ? { ...m, ...f(m as AiMessage) } : m,
    ))
  }, [])

  const buildHistory = useCallback((msgs: Message[]) => {
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const m of msgs) {
      if (m.role === 'user') out.push({ role: 'user', content: m.content })
      else if (m.role === 'ai') {
        const am = m as AiMessage
        if (am.bubbleState === 'done' && am.content.trim()) {
          out.push({ role: 'assistant', content: am.content })
        }
      }
    }
    return out.slice(-20)
  }, [])

  const handleSend = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || loading) return

    const aiId = crypto.randomUUID()
    const history = buildHistory(messages)
    const startAt = Date.now()

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: q },
      {
        role: 'ai', id: aiId,
        bubbleState: 'thinking', ragSteps: [], content: '',
        selected: null, trace: null, citations: [],
        startAt,
      } satisfies { role: 'ai' } & AiMessage,
    ])
    setInput('')
    setLoading(true)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = tokenStorage.get()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: q,
          session_id: sessionIdRef.current,
          history,
          ...(hintIntent ? { hint_intent: hintIntent } : {}),
        }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        let detail = ''
        try { detail = (await res.text()).slice(0, 200) } catch { /* */ }
        throw new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const event = parseSseEvent(block)
          if (!event) continue
          if (event.type === 'agent_selected') {
            updateAi(aiId, (m) => ({ ...m, selected: event.data }))
          } else if (event.type === 'rag_step') {
            updateAi(aiId, (m) => ({
              ...m,
              bubbleState: 'active',
              ragSteps: [...m.ragSteps, {
                icon: event.icon, label: event.label, atMs: Date.now() - m.startAt,
              }],
            }))
          } else if (event.type === 'content') {
            updateAi(aiId, (m) => ({
              ...m,
              bubbleState: 'streaming',
              content: m.content + event.text,
            }))
          } else if (event.type === 'trace') {
            updateAi(aiId, (m) => ({
              ...m,
              trace: event.data,
              citations: Array.isArray(event.data?.citations) ? event.data.citations : [],
            }))
          } else if (event.type === 'done') {
            updateAi(aiId, (m) => ({ ...m, bubbleState: 'done', endAt: Date.now() }))
          } else if (event.type === 'error') {
            updateAi(aiId, (m) => ({ ...m, bubbleState: 'error', error: event.message, endAt: Date.now() }))
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        updateAi(aiId, (m) => ({ ...m, bubbleState: 'error', error: '网络错误', endAt: Date.now() }))
      } else {
        updateAi(aiId, (m) => ({ ...m, bubbleState: 'done', endAt: Date.now() }))
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleAbort = () => abortRef.current?.abort()

  const lastAi = [...messages].reverse().find((m) => m.role === 'ai') as AiMessage | undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px' }}>
      <KnowledgeTabs />
      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 520 }}>

        {/* 左 - 对话 */}
        <div className="surface-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head">
            <span className="panel-title">Agent 对话</span>
            <span className="pill pill-purple">multi-agent</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
              session {sessionIdRef.current.slice(0, 8)}
            </span>
          </div>

          <div ref={chatLogRef} style={{ flex: 1, overflow: 'auto', padding: 14 }}>
            {messages.length === 0 ? (
              <div className="empty-state" style={{ height: '100%', justifyContent: 'center' }}>
                <span className="empty-illus">🤖</span>
                <span className="empty-text">直接提问，或用右上角 hint 强制指定 Agent</span>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <span className="msg-who" style={{
                    display: 'block', marginBottom: 4,
                    textAlign: m.role === 'user' ? 'right' : 'left',
                  }}>
                    {m.role === 'user' ? '你' : 'Agent 编排'}
                  </span>
                  {m.role === 'user' ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div className="msg-bubble" style={{
                        maxWidth: '80%', background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: 12,
                        padding: '10px 14px', fontSize: 14, wordBreak: 'break-word',
                      }}>
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <AiBubble msg={m as AiMessage} />
                  )}
                </div>
              ))
            )}
          </div>

          <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>hint_intent:</label>
              <select
                data-testid="hint-intent-select"
                value={hintIntent}
                onChange={(e) => setHintIntent(e.target.value as HintIntent)}
                disabled={loading}
                style={{
                  fontSize: 12, padding: '4px 8px',
                  border: '1px solid var(--border)', borderRadius: 6,
                }}
              >
                <option value="">自动（走意图分类）</option>
                <option value="knowledge_qa">knowledge_qa · 知识问答</option>
                <option value="data_admin">data_admin · 数据管理</option>
                <option value="structured_query">structured_query · 结构化查询（占位）</option>
                <option value="metadata_ops">metadata_ops · 元数据（仅 ADMIN）</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="输入问题，Enter 发送..."
                disabled={loading}
                style={{
                  flex: 1, resize: 'none',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none',
                  background: loading ? 'var(--surface)' : '#fff',
                }}
              />
              {loading ? (
                <button
                  data-testid="btn-abort"
                  className="btn"
                  onClick={handleAbort}
                  style={{ background: 'var(--red)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  ■ 终止
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  style={{ padding: '8px 18px', borderRadius: 8, whiteSpace: 'nowrap' }}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 中 - 轨迹时间轴 */}
        <div className="surface-card" style={{ width: 260, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head">
            <span className="panel-title">Dispatch 轨迹</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12 }}>
            {!lastAi ? (
              <div style={{ color: 'var(--muted)' }}>发起一轮对话后显示</div>
            ) : (
              <>
                {lastAi.selected && (
                  <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div><strong>意图</strong>: <IntentPill sel={lastAi.selected} /></div>
                    <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                      {lastAi.selected.reason}
                    </div>
                    <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                      agent: {lastAi.selected.agent}
                    </div>
                  </div>
                )}
                <ol data-testid="dispatch-timeline" style={{ margin: 0, paddingLeft: 18 }}>
                  {lastAi.ragSteps.map((s, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <span>{s.icon} {s.label}</span>
                      <span style={{ marginLeft: 6, color: 'var(--muted)' }}>+{s.atMs}ms</span>
                    </li>
                  ))}
                </ol>
                {lastAi.bubbleState === 'done' && lastAi.endAt != null && (
                  <div style={{ marginTop: 10, color: 'var(--muted)' }}>
                    完成 · 总耗时 {lastAi.endAt - lastAi.startAt}ms
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右 - trace / citations */}
        <div className="surface-card" style={{ width: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head">
            <span className="panel-title">详情</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12 }}>
            {!lastAi ? (
              <div style={{ color: 'var(--muted)' }}>选中一轮对话后显示 trace / citations</div>
            ) : (
              <>
                {lastAi.citations.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>引用（{lastAi.citations.length}）</div>
                    {lastAi.citations.map((c) => (
                      <div
                        key={`${c.asset_id}-${c.index}`}
                        data-testid="agent-citation-item"
                        style={{ marginBottom: 6, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--p)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.index}</span>
                          <span style={{ fontWeight: 700 }}>{c.asset_name}</span>
                          <span style={{ marginLeft: 'auto' }}><ConfidenceBadge score={c.score} /></span>
                        </div>
                        <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                          {c.chunk_content.slice(0, 100)}{c.chunk_content.length > 100 ? '…' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {lastAi.trace && (
                  <details open>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>trace 原文</summary>
                    <pre style={{
                      marginTop: 6, padding: 8, background: '#fafafa',
                      border: '1px solid var(--border)', borderRadius: 6,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{JSON.stringify(lastAi.trace, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
