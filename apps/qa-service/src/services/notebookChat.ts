/**
 * services/notebookChat.ts —— Notebook 内 chat
 *
 * 跟 /api/qa/ask 同源（runRagPipeline），区别：
 *   1. 检索 scope 限定为 notebook 的 source asset_ids
 *   2. **N-001**：传 `citationStyle: 'footnote'` 让 ragPipeline 走档 B 5 类
 *      意图分流 + 输出 [^N] 引用样式（Notebook ChatPanel.tsx:304 regex 解析格式）
 *      不再用 NOTEBOOK_SYSTEM_PROMPT monolithic prompt（绕过档 B 是 rag-intent-routing
 *      的隐患，N-001 修复）
 *   3. 流式结束后把 user / assistant 两条消息持久化到 notebook_chat_message
 */
import type { Response, Request } from 'express'
import { getPgPool } from './pgDb.ts'
import { runRagPipeline } from './ragPipeline.ts'
import type { SseEvent, RagTrace, Citation, HistoryMessage } from '../ragTypes.ts'

const HISTORY_MAX_RECENT = 10  // 取最近 10 条历史

export interface NotebookChatInput {
  notebookId: number
  question: string
  ownerEmail: string
  res: Response
  req: Request
}

/**
 * 主入口：跑 RAG → 流式回吐 SSE → 收尾时入库
 */
export async function streamNotebookChat(input: NotebookChatInput): Promise<void> {
  const { notebookId, question, ownerEmail, res, req } = input
  const pool = getPgPool()

  // 1) 拉 notebook 的 sources
  const { rows: sourceRows } = await pool.query(
    `SELECT asset_id FROM notebook_source WHERE notebook_id = $1`,
    [notebookId],
  )
  const assetIds = sourceRows.map((r) => Number(r.asset_id)).filter(Number.isFinite)

  // 2) 拉最近 N 轮历史
  const { rows: histRows } = await pool.query(
    `SELECT role, content
     FROM notebook_chat_message
     WHERE notebook_id = $1 AND role IN ('user', 'assistant')
     ORDER BY id DESC
     LIMIT $2`,
    [notebookId, HISTORY_MAX_RECENT * 2],
  )
  const history: HistoryMessage[] = histRows
    .reverse()
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: String(r.content) }))

  // 3) SSE setup
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  const events: SseEvent[] = []
  const emit = (event: SseEvent) => {
    if (res.writableEnded) return
    events.push(event)
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // 提示用户当前 scope
  if (assetIds.length === 0) {
    emit({
      type: 'rag_step', icon: '⚠️',
      label: 'Notebook 无任何 source；将拒绝作答（请先从 + 添加资料 加入 asset）',
    })
    emit({ type: 'content', text: 'Notebook 还没有添加任何资料。请先点左侧「+ 添加资料」选择文档后再提问。' })
    emit({ type: 'done' })
    if (!res.writableEnded) res.end()
    // 不入库无 source 的对话，避免污染
    return
  }

  // 4) 跑 RAG（透传 assetIds + 自定义 system prompt）
  let assistantText = ''
  const collector = (event: SseEvent) => {
    if (event.type === 'content') assistantText += event.text
    emit(event)
  }
  try {
    // N-001：不再传 systemPromptOverride（绕过档 B 是隐患）；
    // 改传 citationStyle: 'footnote' 让 ragPipeline 走完整档 B 5 类意图分流
    // + 输出 [^N] 引用样式（兼容 ChatPanel.tsx:304 regex /\[\^(\d+)\]/g）
    await runRagPipeline(question, history, collector, ac.signal, {
      assetIds,
      citationStyle: 'footnote',
    })
  } catch (err) {
    if (!res.writableEnded) {
      emit({ type: 'error', message: err instanceof Error ? err.message : 'unknown' })
      emit({ type: 'done' })
    }
  }
  if (!res.writableEnded) res.end()

  // 5) 持久化（abort 也写，记录用户问题；assistant 内容如果空就不写）
  const traceEvent = events.find((e): e is Extract<SseEvent, { type: 'trace' }> => e.type === 'trace')
  const trace: RagTrace | null = (traceEvent?.data ?? null) as RagTrace | null
  const citations: Citation[] = trace?.citations ?? []

  try {
    await pool.query(
      `INSERT INTO notebook_chat_message (notebook_id, role, content)
       VALUES ($1, 'user', $2)`,
      [notebookId, question],
    )
    if (assistantText.trim()) {
      await pool.query(
        `INSERT INTO notebook_chat_message
           (notebook_id, role, content, citations, trace)
         VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb)`,
        [notebookId, assistantText, JSON.stringify(citations), JSON.stringify(trace ?? {})],
      )
    }
    await pool.query(`UPDATE notebook SET updated_at = NOW() WHERE id = $1`, [notebookId])
  } catch (e) {
    // 静默：UI 已经看到答案，落库失败下次重试即可
    // eslint-disable-next-line no-console
    console.warn('notebook chat persist failed:', e)
  }

  // ownerEmail / req 当前未直接消费但保留为后续审计 hook
  void ownerEmail; void req
}
