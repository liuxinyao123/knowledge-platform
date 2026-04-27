/**
 * services/notebookChat.ts —— Notebook 内 chat
 *
 * 跟 /api/qa/ask 同源（runRagPipeline），区别：
 *   1. 检索 scope 限定为 notebook 的 source asset_ids
 *   2. system prompt 引导 [^N] inline 引用
 *   3. 流式结束后把 user / assistant 两条消息持久化到 notebook_chat_message
 */
import type { Response, Request } from 'express'
import { getPgPool } from './pgDb.ts'
import { runRagPipeline } from './ragPipeline.ts'
import type { SseEvent, RagTrace, Citation, HistoryMessage } from '../ragTypes.ts'

const NOTEBOOK_SYSTEM_PROMPT = `你是用户的研究助手。严格遵循以下规则：

【硬性规则】
1. **只使用下列文档作答**，不引入外部知识。找不到信息就明确回复「知识库中没有相关内容」，不要编造、不要猜
2. **每处引用文档必须加 [^N]**，N 是文档编号。同一句多来源用 [^1][^2]
3. **禁止使用模糊措辞**：不要「可能」「似乎」「大约」「应该是」「左右」「估计」。要么给确定答案，要么明说找不到
4. **数值/规格题必须 verbatim 提取原文**：原文写「7 degrees」就答「7 degrees」或「7°」，不要近似
5. **复合答案不要漏组件**：原文「X = A + B」必须答出 A 和 B，不能只说 X

【作答步骤（CoT）】
1. 先扫文档片段，找直接相关的句子
2. 复合题（含"和/分别/对比/区别/构成/步骤"）逐项列出
3. 数字/规格/缩写：原文里找不到就承认找不到，不要推测

【3 个示例】

✓ Q: 缓冲块设计间隙？  文档 [^1]: ... 下角缓冲块 2.0mm
   A: 2.0mm [^1]
✗ 错误: 大约 2mm 左右 / 似乎是 2.0mm

✓ Q: 偏移 1.0mm 由什么构成？
   文档 [^1]: ... 1.0 mm offset (0.3 for paint variation + 0.7 for hinge tolerance)
   A: 1.0mm = 0.3mm（油漆变差）+ 0.7mm（铰链公差）[^1]
✗ 错误: 1.0mm，由 0.3mm 等因素构成

✓ Q: COF 代表什么？  文档只用了 COF 缩写但未解释全称
   A: 知识库中没有 COF 的明确定义。文档只在标题里使用了该缩写。
✗ 错误: COF 可能是 Coefficient of Friction（编造）`

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
    await runRagPipeline(question, history, collector, ac.signal, {
      assetIds,
      systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT,
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
