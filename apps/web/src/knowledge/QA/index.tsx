import { useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react'
import ConfidenceBadge from '@/components/ConfidenceBadge'
import AssetDirectoryPanel from '@/knowledge/QA/AssetDirectoryPanel'
import AnswerContent from '@/knowledge/QA/AnswerContent'
import { tokenStorage } from '@/auth/tokenStorage'
import { listSpaces, type SpaceSummary } from '@/api/spaces'

interface RagStep { icon: string; label: string }
interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /** asset-vector-coloc：来源 chunk 是 image_caption 时回填 */
  image_id?: number
  image_url?: string
}
interface RagTrace {
  initial_count: number
  kept_count: number
  rewrite_triggered: boolean
  rewrite_strategy?: 'step_back' | 'hyde'
  rewritten_query?: string
  citations: Citation[]
}

interface HistoryMessage { role: 'user' | 'assistant'; content: string }

const HISTORY_MAX_ROUNDS = 10                            // 最多保留 10 轮（20 条）
const SESSIONS_KEY = 'kc_qa_sessions_v2'                 // 会话元数据列表
const ACTIVE_SESSION_KEY = 'kc_qa_active_session_v2'     // 当前活跃会话 id
const SESSION_MSGS_PREFIX = 'kc_qa_msgs_'                // 各会话消息存储前缀
const LEGACY_SESSION_KEY = 'kc_qa_session_id'            // 兼容旧版单会话 id

type BubbleState = 'thinking' | 'active' | 'streaming' | 'done' | 'error'

interface AiMessage {
  id: string
  bubbleState: BubbleState
  ragSteps: RagStep[]
  content: string
  trace: RagTrace | null
  traceOpen: boolean
  error?: string
}

interface UserMessage { role: 'user'; content: string }
type Message = UserMessage | ({ role: 'ai' } & AiMessage)

interface SessionMeta {
  id: string
  title: string
  createdAt: number      // ms
  updatedAt: number      // ms
}

const SAMPLE_QUESTIONS = [
  '文档「这是一个测试文档.docx」的具体内容是什么？',
  '如何编辑首页文档中的愿景和目标部分？',
  '我们现在的知识治理应该从哪些指标开始？',
  '如何向知识库中上传文档？',
]

/* ───────────── localStorage helpers ───────────── */

function safeLs<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}

function loadSessions(): SessionMeta[] {
  return safeLs(() => {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  }, [])
}

function saveSessions(list: SessionMeta[]) {
  safeLs(() => { localStorage.setItem(SESSIONS_KEY, JSON.stringify(list)); return null }, null)
}

function loadActiveSessionId(): string | null {
  return safeLs(() => localStorage.getItem(ACTIVE_SESSION_KEY), null)
}

function saveActiveSessionId(id: string) {
  safeLs(() => {
    localStorage.setItem(ACTIVE_SESSION_KEY, id)
    // 旧 key 兼容：保持单会话 id 可读（供历史脚本 / 测试 / 埋点使用）
    localStorage.setItem(LEGACY_SESSION_KEY, id)
    return null
  }, null)
}

function loadMessages(sessionId: string): Message[] {
  return safeLs(() => {
    const raw = localStorage.getItem(SESSION_MSGS_PREFIX + sessionId)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Message[]) : []
  }, [])
}

function saveMessages(sessionId: string, msgs: Message[]) {
  safeLs(() => {
    // 只持久化已完成的消息（避免把 streaming/thinking 中间态写盘）
    const cleaned = msgs.map((m) => {
      if (m.role === 'ai') {
        const ai = m as { role: 'ai' } & AiMessage
        if (ai.bubbleState === 'streaming' || ai.bubbleState === 'thinking' || ai.bubbleState === 'active') {
          return { ...ai, bubbleState: 'done' as BubbleState }
        }
      }
      return m
    })
    localStorage.setItem(SESSION_MSGS_PREFIX + sessionId, JSON.stringify(cleaned))
    return null
  }, null)
}

function deleteSessionStorage(sessionId: string) {
  safeLs(() => { localStorage.removeItem(SESSION_MSGS_PREFIX + sessionId); return null }, null)
}

function newSessionMeta(): SessionMeta {
  const now = Date.now()
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(now),
    title: '新会话',
    createdAt: now,
    updatedAt: now,
  }
}

/** 确保有一条可用会话；首次进入时创建一条，并复用旧版 session id（如有）。 */
function bootstrapSessions(): { sessions: SessionMeta[]; activeId: string } {
  let sessions = loadSessions()
  let activeId = loadActiveSessionId()

  if (sessions.length === 0) {
    const legacy = safeLs(() => localStorage.getItem(LEGACY_SESSION_KEY), null)
    const seed: SessionMeta = legacy
      ? { id: legacy, title: '我的会话', createdAt: Date.now(), updatedAt: Date.now() }
      : newSessionMeta()
    sessions = [seed]
    saveSessions(sessions)
  }
  if (!activeId || !sessions.some((s) => s.id === activeId)) {
    activeId = sessions[0].id
    saveActiveSessionId(activeId)
  }
  return { sessions, activeId }
}

/** 把 ms 时间戳分组到「今天 / 近7天 / 更早」 */
function groupSessions(sessions: SessionMeta[]): { label: string; items: SessionMeta[] }[] {
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const today: SessionMeta[] = []
  const week: SessionMeta[] = []
  const earlier: SessionMeta[] = []
  // 最新在前
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const s of sorted) {
    if (s.updatedAt >= startOfToday.getTime()) today.push(s)
    else if (now - s.updatedAt < 7 * oneDay) week.push(s)
    else earlier.push(s)
  }
  return [
    { label: '今天', items: today },
    { label: '近 7 天', items: week },
    { label: '更早', items: earlier },
  ].filter((g) => g.items.length > 0)
}

/* ───────────── UI primitives ───────────── */

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--p)',
            display: 'inline-block',
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </span>
  )
}

function AiBubble({ msg }: { msg: AiMessage }) {
  const [traceOpen, setTraceOpen] = useState(false)

  return (
    <div
      data-testid={`bubble-${msg.bubbleState}`}
      style={{
        background: 'var(--p-light)',
        border: '1px solid var(--p-mid)',
        borderRadius: 12,
        padding: '12px 14px',
        fontSize: 14,
        lineHeight: 1.6,
        color: msg.bubbleState === 'error' ? 'var(--red)' : 'var(--text)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {msg.bubbleState === 'thinking' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThinkingDots />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>思考中...</span>
        </div>
      )}

      {msg.bubbleState === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {msg.ragSteps.map((step, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{step.icon}</span>
              <span>{step.label}</span>
            </div>
          ))}
          {msg.ragSteps.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <ThinkingDots />
            </div>
          )}
        </div>
      )}

      {(msg.bubbleState === 'streaming' || msg.bubbleState === 'done') && (
        <div>
          <style>{`@keyframes cursor-blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
          {/* ADR-45：AnswerContent 解析 ![alt](/api/assets/images/N) 内嵌图；
                     非图字段一路走纯文本；流式半截 markdown 不会误伤 */}
          <div style={{ position: 'relative' }}>
            <AnswerContent content={msg.content} />
            {msg.bubbleState === 'streaming' && (
              <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--p)', verticalAlign: 'text-bottom', animation: 'cursor-blink 1s step-end infinite', marginLeft: 2 }} />
            )}
          </div>

          {msg.bubbleState === 'done' && msg.trace && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--p-mid)', paddingTop: 8 }}>
              <button
                onClick={() => setTraceOpen(!traceOpen)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {traceOpen ? '▼' : '▶'} 展开检索过程
              </button>
              {traceOpen && (
                <div data-testid="rag-trace" style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                  <div>检索 {msg.trace.initial_count} 篇 → 保留 {msg.trace.kept_count} 篇</div>
                  {msg.trace.rewrite_triggered && (
                    <div>
                      触发查询重写：{msg.trace.rewrite_strategy === 'hyde' ? 'HyDE（假设答案）' : 'Step-Back（泛化）'}
                      {msg.trace.rewritten_query && (
                        <div style={{ fontStyle: 'italic', marginTop: 2 }}>「{msg.trace.rewritten_query}」</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {msg.bubbleState === 'error' && (
        <div>{msg.error ?? '请求失败，请稍后重试。'}</div>
      )}
    </div>
  )
}

/** ADR-35：File → base64（不带 data: 前缀，仅原始 base64） */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r !== 'string') return reject(new Error('FileReader returned non-string'))
      // r 形如 "data:image/png;base64,xxxxx"，截掉前缀
      const idx = r.indexOf(',')
      resolve(idx > 0 ? r.slice(idx + 1) : r)
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
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

type RightPanelTab = 'citations' | 'assets'

type AssetPanelSseNavigate = {
  seq: number
  sourceId?: number
  itemId?: number
  tab?: 'assets' | 'rag' | 'graph'
}

/* ───────────── Main page ───────────── */

export default function QA() {
  // sessions（侧栏列表 + 活跃 id）—— 用 useState 的惰性初始化，保证 bootstrap 只跑一次
  const [initialBootstrap] = useState(() => bootstrapSessions())
  const [sessions, setSessions] = useState<SessionMeta[]>(initialBootstrap.sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(initialBootstrap.activeId)

  // 消息（按当前活跃会话加载）
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(initialBootstrap.activeId))
  const [citations, setCitations] = useState<Citation[]>([])
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('citations')
  const [assetPanelNav, setAssetPanelNav] = useState<AssetPanelSseNavigate>({ seq: 0 })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [spaceId, setSpaceId] = useState<number | null>(null)
  // ADR-35：联网检索 toggle + 多模态附件
  const [webSearch, setWebSearch] = useState<boolean>(false)
  const [image, setImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string>(initialBootstrap.activeId)

  // 同步活跃 id 到 ref（SSE 请求体里要用）
  useEffect(() => { sessionIdRef.current = activeSessionId }, [activeSessionId])

  // 拉取空间列表
  useEffect(() => {
    listSpaces().then(setSpaces).catch(() => setSpaces([]))
  }, [])

  // 消息变化时持久化（避开正在生成的过程态由 saveMessages 内部处理）
  useEffect(() => {
    if (!activeSessionId) return
    saveMessages(activeSessionId, messages)
  }, [activeSessionId, messages])

  // 从 messages 中提取历史（跳过正在生成的空 AI 消息，保留最近 N 轮）
  const buildHistory = useCallback((msgs: Message[]): HistoryMessage[] => {
    const pairs: HistoryMessage[] = []
    for (const m of msgs) {
      if (m.role === 'user') {
        pairs.push({ role: 'user', content: m.content })
      } else if (m.role === 'ai') {
        const aiMsg = m as AiMessage
        if (aiMsg.bubbleState === 'done' && aiMsg.content.trim()) {
          pairs.push({ role: 'assistant', content: aiMsg.content })
        }
      }
    }
    return pairs.slice(-HISTORY_MAX_ROUNDS * 2)
  }, [])

  // 自动滚到底（在中央滚动容器上）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    if (isNearBottom || loading) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, loading])

  const updateAiMsg = useCallback((id: string, updater: (msg: AiMessage) => AiMessage) => {
    setMessages((prev) => prev.map((m) =>
      m.role === 'ai' && m.id === id ? { ...m, ...updater(m as AiMessage) } : m
    ))
  }, [])

  /* ── 会话操作 ── */

  const persistSessions = useCallback((next: SessionMeta[]) => {
    setSessions(next)
    saveSessions(next)
  }, [])

  const handleNewSession = useCallback(() => {
    if (loading) abortRef.current?.abort()
    const meta = newSessionMeta()
    const next = [meta, ...sessions]
    persistSessions(next)
    setActiveSessionId(meta.id)
    saveActiveSessionId(meta.id)
    setMessages([])
    setCitations([])
    setInput('')
  }, [loading, sessions, persistSessions])

  const handleSwitchSession = useCallback((id: string) => {
    if (id === activeSessionId) return
    if (loading) abortRef.current?.abort()
    setActiveSessionId(id)
    saveActiveSessionId(id)
    setMessages(loadMessages(id))
    setCitations([])
    setInput('')
  }, [activeSessionId, loading])

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('删除该会话及其历史？此操作不可撤销。')) return
    deleteSessionStorage(id)
    const remaining = sessions.filter((s) => s.id !== id)
    if (remaining.length === 0) {
      // 至少保留一条
      const meta = newSessionMeta()
      persistSessions([meta])
      setActiveSessionId(meta.id)
      saveActiveSessionId(meta.id)
      setMessages([])
    } else {
      persistSessions(remaining)
      if (id === activeSessionId) {
        const next = remaining[0].id
        setActiveSessionId(next)
        saveActiveSessionId(next)
        setMessages(loadMessages(next))
      }
    }
    setCitations([])
  }, [sessions, activeSessionId, persistSessions])

  /* ── 提问 / SSE 流 ── */

  const handleSend = async (question?: string) => {
    const q = (question ?? input).trim()
    if (!q || loading) return

    const aiId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: q },
      {
        role: 'ai', id: aiId,
        bubbleState: 'thinking', ragSteps: [], content: '',
        trace: null, traceOpen: false,
      } satisfies { role: 'ai' } & AiMessage,
    ])
    setInput('')
    // ADR-35：发送后清掉本轮的 image 附件（webSearch toggle 保留状态）
    setImage(null)
    setCitations([])
    setLoading(true)

    // 首次提问把当前会话标题改成问题前 24 字
    const currentSession = sessions.find((s) => s.id === activeSessionId)
    if (currentSession && (currentSession.title === '新会话' || currentSession.title === '我的会话')) {
      const trimmed = q.length > 24 ? q.slice(0, 24) + '…' : q
      const next = sessions.map((s) =>
        s.id === activeSessionId ? { ...s, title: trimmed, updatedAt: Date.now() } : s
      )
      persistSessions(next)
    } else {
      // 仅刷新 updatedAt 让排序生效
      const next = sessions.map((s) =>
        s.id === activeSessionId ? { ...s, updatedAt: Date.now() } : s
      )
      persistSessions(next)
    }

    const ac = new AbortController()
    abortRef.current = ac
    const history = buildHistory(messages)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = tokenStorage.get()
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/qa/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: q,
          session_id: sessionIdRef.current,
          history,
          space_id: spaceId ?? undefined,
          // ADR-35：联网检索 toggle + 多模态图片附件
          web_search: webSearch || undefined,
          image: image ? { base64: image.base64, mimeType: image.mimeType } : undefined,
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
          if (event.type === 'rag_step') {
            updateAiMsg(aiId, (m) => ({
              ...m,
              bubbleState: 'active',
              ragSteps: [...m.ragSteps, { icon: event.icon, label: event.label }],
            }))
          } else if (event.type === 'content') {
            updateAiMsg(aiId, (m) => ({
              ...m,
              bubbleState: 'streaming',
              content: m.content + event.text,
            }))
          } else if (event.type === 'trace') {
            setCitations(event.data.citations ?? [])
            updateAiMsg(aiId, (m) => ({ ...m, trace: event.data }))
          } else if (event.type === 'asset_panel') {
            const d = event.data ?? {}
            if (d.open !== false) {
              setRightPanelTab('assets')
              setAssetPanelNav((prev) => ({
                seq: prev.seq + 1,
                sourceId: typeof d.sourceId === 'number' ? d.sourceId : undefined,
                itemId: typeof d.itemId === 'number' ? d.itemId : undefined,
                tab: d.tab === 'graph' || d.tab === 'rag' || d.tab === 'assets' ? d.tab : undefined,
              }))
            }
          } else if (event.type === 'done') {
            updateAiMsg(aiId, (m) => ({ ...m, bubbleState: 'done' }))
          } else if (event.type === 'error') {
            updateAiMsg(aiId, (m) => ({ ...m, bubbleState: 'error', error: event.message }))
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        const msg = err.message || ''
        let text = '网络错误，请稍后重试。'
        if (/HTTP 401/.test(msg)) text = '未登录或登录已过期，请重新登录。'
        else if (/HTTP 403/.test(msg)) text = '无权访问问答接口，联系管理员。'
        else if (msg.startsWith('HTTP ')) text = msg
        updateAiMsg(aiId, (m) => ({ ...m, bubbleState: 'error', error: text }))
      } else if (!(err instanceof Error && err.name === 'AbortError')) {
        updateAiMsg(aiId, (m) => ({ ...m, bubbleState: 'error', error: '请求失败。' }))
      } else {
        updateAiMsg(aiId, (m) => ({ ...m, bubbleState: 'done' }))
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleAbort = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const grouped = groupSessions(sessions)
  const currentSpaceLabel = spaceId == null
    ? '检索范围：所有空间'
    : `仅限：${spaces.find((s) => s.id === spaceId)?.name ?? '—'}`

  return (
    <div className="page-body kc-qa-page-body">
      {/* 顶部 header（白底，描述 + 当前空间 chip） */}
      <div className="kc-qa-header">
        <div>
          <div className="page-title" style={{ marginBottom: 2 }}>问一问</div>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            用一句话描述你的场景；有引用才放心采纳，点右侧可核对原文。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill" style={{ cursor: 'default' }}>{currentSpaceLabel}</span>
        </div>
      </div>

      {/* 三栏：会话 / 聊天 / 引用 */}
      <div className="kc-qa-layout">
        {/* ── 左：会话列表 ── */}
        <aside className="kc-qa-sessions" aria-label="问一问：会话与历史">
          <div className="kc-qa-sessions-railhead">
            <div className="kc-qa-sessions-railhead-title">历史会话</div>
            <p className="kc-qa-sessions-railhead-hint">
              找空间、搜资料请用左侧主菜单；这里只切换本会话的线程列表。
            </p>
          </div>
          <div className="kc-qa-sessions-head">
            <button
              type="button"
              className="btn primary"
              style={{ flex: 1 }}
              onClick={handleNewSession}
              data-testid="btn-new-session"
            >
              + 新建会话
            </button>
          </div>
          <div className="kc-qa-sessions-list" data-testid="qa-sessions-list">
            {grouped.length === 0 ? (
              <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--muted)' }}>
                暂无历史会话。点击上方「+ 新建会话」开始。
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.label}>
                  <div className="kc-sess-timeline">{group.label}</div>
                  {group.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`qa-session-${s.id}`}
                      className={`kc-sess-item${s.id === activeSessionId ? ' active' : ''}`}
                      onClick={() => handleSwitchSession(s.id)}
                      title={s.title}
                    >
                      {s.title}
                      <span
                        role="button"
                        aria-label="删除会话"
                        className="kc-sess-del"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                      >×</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── 中：聊天区（Hero + 推荐问 + 消息 + 输入框） ── */}
        <div className="kc-qa-chat">
          <div className="kc-qa-center-wrap">
            <div ref={scrollRef} className="kc-qa-center-scroll">
              {messages.length === 0 ? (
                <div className="kc-qa-hero">
                  <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>
                    <span>🧠</span>
                  </div>
                  <h1>
                    基于知识库内容问答{' '}
                    <span style={{ color: 'var(--muted)', fontWeight: 700 }}>— AI 问答</span>
                  </h1>
                  <p className="kc-qa-hero-sub">向知识助手提问，获取精准引用答案</p>
                  <p className="kc-qa-hero-sub" style={{ marginTop: 4 }}>
                    基于当前空间内文档与向量化内容作答；可配置联网、推理强度与模型。
                  </p>
                  <p className="kc-qa-hero-hint">你可以这样问我</p>
                  <div className="kc-qa-suggest">
                    {SAMPLE_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="pill"
                        onClick={() => setInput(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kc-qa-messages" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
                  <div className="chat-log">
                    {messages.map((msg, i) => (
                      <div key={i} className={`msg${msg.role === 'user' ? ' user' : ''}`}>
                        <div>
                          {msg.role === 'user' ? (
                            <>
                              <div className="bubble" style={{ wordBreak: 'break-word' }}>
                                {msg.content}
                              </div>
                              <div className="who" style={{ textAlign: 'right' }}>你</div>
                            </>
                          ) : (
                            <>
                              <AiBubble msg={msg as AiMessage} />
                              <div className="who">知识助手</div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="kc-qa-hint" aria-live="polite">
              {messages.length === 0
                ? '点击上方「示例问题」可快速填入；发送后，对话在上方区域滚动显示。'
                : 'Shift + 回车换行；回车直接发送。'}
            </p>

            {/* 复合输入器 */}
            <div className="kc-qa-composer">
              <div className="kc-qa-composer-in">
                <div className="kc-qa-ctx-row">
                  <span className="kc-qa-ctx-pill" title="必须引用：回答必须基于检索结果">
                    必须引用
                  </span>
                  {spaceId != null && (
                    <span className="kc-qa-ctx-pill" title="当前限定的检索空间">
                      {spaces.find((s) => s.id === spaceId)?.name ?? '空间'}
                      <button
                        type="button"
                        className="x"
                        aria-label="移除空间限定"
                        onClick={() => setSpaceId(null)}
                      >×</button>
                    </span>
                  )}
                </div>
                <label className="visually-hidden" htmlFor="kc-qa-input" style={{
                  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
                  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
                }}>输入问题</label>
                <textarea
                  id="kc-qa-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入你的问题，例如：「如何降低知识重复率？」"
                  disabled={loading}
                />
                {/* ADR-35：图片附件预览（缩略图 + 文件名 + 移除） */}
                {image && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', margin: '4px 8px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid #6ee7b7', borderRadius: 8,
                    fontSize: 12,
                  }}>
                    <img
                      src={`data:${image.mimeType};base64,${image.base64}`}
                      alt={image.name}
                      style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }}
                    />
                    <span style={{ color: '#065f46', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      🖼 已附图：<strong>{image.name}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setImage(null)}
                      style={{
                        padding: '2px 8px', fontSize: 11,
                        background: 'transparent', border: '1px solid #6ee7b7',
                        borderRadius: 4, color: '#065f46', cursor: 'pointer',
                      }}>移除</button>
                  </div>
                )}
                <div className="kc-qa-composer-bar">
                  <select
                    className="mini-select"
                    title="检索范围"
                    aria-label="检索范围"
                    value={spaceId == null ? '' : String(spaceId)}
                    onChange={(e) => {
                      const v = e.target.value
                      setSpaceId(v === '' ? null : Number(v))
                    }}
                  >
                    <option value="">所有空间</option>
                    {spaces.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.visibility === 'private' ? '🔒 ' : '📁 '}{sp.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="kc-qa-cbar-ico"
                    title={webSearch ? '联网检索：开（再点关闭）' : '联网检索：关（点开）'}
                    aria-pressed={webSearch}
                    onClick={() => setWebSearch((v) => !v)}
                    style={{
                      background: webSearch ? 'rgba(124, 58, 237, 0.12)' : undefined,
                      color: webSearch ? '#7c3aed' : undefined,
                      borderColor: webSearch ? '#a78bfa' : undefined,
                    }}
                  >🌐</button>
                  <button
                    type="button"
                    className="kc-qa-cbar-ico"
                    title={image ? `已附图：${image.name}（点击重新选择）` : '附图（多模态 QA · Qwen2.5-VL）'}
                    aria-pressed={!!image}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: image ? 'rgba(16, 185, 129, 0.12)' : undefined,
                      color: image ? '#10b981' : undefined,
                      borderColor: image ? '#6ee7b7' : undefined,
                    }}
                  >🖼</button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''  // 让用户能再次选同一文件
                      if (!file) return
                      // 6MB 上限，避免 8MB base64 上限超出
                      if (file.size > 6 * 1024 * 1024) {
                        alert(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 6MB`)
                        return
                      }
                      const base64 = await fileToBase64(file)
                      setImage({ base64, mimeType: file.type || 'image/png', name: file.name })
                    }}
                  />
                  <div className="kc-qa-cbar-right">
                    {loading ? (
                      <button
                        type="button"
                        data-testid="btn-abort"
                        className="stop-ico"
                        onClick={handleAbort}
                        title="终止生成"
                        aria-label="终止"
                      >■</button>
                    ) : (
                      <button
                        type="button"
                        className="send-ico"
                        onClick={() => handleSend()}
                        disabled={!input.trim()}
                        title="发送"
                        aria-label="发送"
                      >➤</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 右：引用来源 / 资产目录 ── */}
        <aside className="kc-qa-refs panel">
          <div className="panel-head" style={{ gap: 8 }}>
            <div className="title">右侧面板</div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              data-testid="right-tab-citations"
              className={`pill${rightPanelTab === 'citations' ? ' active' : ''}`}
              onClick={() => setRightPanelTab('citations')}
            >
              引用{citations.length > 0 ? ` ${citations.length}` : ''}
            </button>
            <button
              type="button"
              data-testid="right-tab-assets"
              className={`pill${rightPanelTab === 'assets' ? ' active' : ''}`}
              onClick={() => setRightPanelTab('assets')}
            >
              资产目录
            </button>
          </div>
          <div className="panel-body">
            {rightPanelTab === 'citations' ? (
              citations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-illus">📎</div>
                  <div className="empty-text">提问后将在此处显示引用来源</div>
                </div>
              ) : (
                citations.map((c) => (
                  <div
                    key={`${c.asset_id}-${c.index}`}
                    data-testid="citation-item"
                    className="result-item"
                  >
                    <div className="result-title">
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--p)',
                        borderRadius: '50%', width: 18, height: 18,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        marginRight: 6,
                      }}>{c.index}</span>
                      {c.asset_name}
                    </div>
                    {c.image_url && (
                      <div style={{ margin: '6px 0' }}>
                        <img
                          src={c.image_url}
                          alt={c.chunk_content.slice(0, 40)}
                          data-testid="citation-thumbnail"
                          style={{
                            width: 64, height: 64, objectFit: 'cover',
                            borderRadius: 4, border: '1px solid var(--border)',
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="result-snippet">
                      {c.chunk_content.slice(0, 100)}{c.chunk_content.length > 100 ? '…' : ''}
                    </div>
                    <div className="tag-row">
                      <ConfidenceBadge score={c.score} />
                    </div>
                  </div>
                ))
              )
            ) : (
              <AssetDirectoryPanel sseNavigate={assetPanelNav} />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
