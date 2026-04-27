/**
 * agent/dispatchHandler.ts —— Agent 编排入口
 *
 * 职责：
 *   1. 校验 body（question / session_id / history / hint_intent）
 *   2. 设置 SSE 头
 *   3. classify → 选 Agent → emit agent_selected → agent.run
 *   4. 异常兜底 → emit error + done
 *   5. 结构化日志
 *
 * 鉴权由调用方（routes/agent.ts, routes/qa.ts）用 requireAuth + enforceAcl 挂好。
 */
import type { Request, RequestHandler } from 'express'
import type { EmitFn } from '../ragTypes.ts'
import type { HistoryMessage } from '../ragTypes.ts'
import type { AgentContext, AgentIntent } from './types.ts'
import { isAgentIntent } from './types.ts'
import { classify } from './classify.ts'
import { plan } from './plan.ts'
import { getAgent } from './registry.ts'
import { shapeResultByAcl } from '../auth/shapeResult.ts'

const MAX_HISTORY_CHAR = 8000
const MAX_HISTORY_LEN = 40

function validateHistory(input: unknown): { ok: true; value: HistoryMessage[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: [] }
  if (!Array.isArray(input)) return { ok: false, error: 'history must be an array' }
  const out: HistoryMessage[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'history item must be object' }
    const { role, content } = raw as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return { ok: false, error: 'invalid history role' }
    if (typeof content !== 'string') return { ok: false, error: 'history content must be string' }
    if (content.length > MAX_HISTORY_CHAR) return { ok: false, error: `history content too long (>${MAX_HISTORY_CHAR})` }
    out.push({ role, content })
  }
  return { ok: true, value: out.slice(-MAX_HISTORY_LEN) }
}

export const dispatchHandler: RequestHandler = async (req: Request, res) => {
  const body = (req.body ?? {}) as {
    question?: unknown
    session_id?: unknown
    history?: unknown
    hint_intent?: unknown
    space_id?: unknown
  }

  const question = typeof body.question === 'string' ? body.question : ''
  if (!question.trim()) {
    return res.status(400).json({ error: 'question is required' })
  }

  if (body.session_id !== undefined && typeof body.session_id !== 'string') {
    return res.status(400).json({ error: 'session_id must be string' })
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id : undefined

  const historyCheck = validateHistory(body.history)
  if (!historyCheck.ok) {
    return res.status(400).json({ error: historyCheck.error })
  }

  if (body.hint_intent !== undefined && !isAgentIntent(body.hint_intent)) {
    return res.status(400).json({ error: 'invalid hint_intent' })
  }
  const hintIntent = isAgentIntent(body.hint_intent) ? body.hint_intent : undefined

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  const ac = new AbortController()
  res.on('close', () => ac.abort())

  // emit：trace 内 citations 经 mask 整形（若 unified-auth 有 mask）
  const emit: EmitFn = (event) => {
    if (res.writableEnded) return
    if (event.type === 'trace' && req.aclDecision?.mask?.length) {
      const data = event.data as { citations?: Array<Record<string, unknown>> }
      if (Array.isArray(data.citations)) {
        const masked = shapeResultByAcl(req.aclDecision, data.citations)
        event = { ...event, data: { ...data, citations: masked } }
      }
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const startAt = Date.now()
  let chosenIntent: AgentIntent = 'knowledge_qa'
  let fallback = false

  try {
    // 1) 意图
    let verdict
    if (hintIntent) {
      verdict = {
        intent: hintIntent,
        confidence: 1,
        reason: 'hint_intent provided',
        fallback: false,
      }
    } else {
      verdict = await classify(question, ac.signal)
    }

    // 2) 规划（本轮单步）
    const { steps } = plan(verdict, question)
    const step = steps[0]
    chosenIntent = step.intent
    fallback = verdict.fallback

    const agent = getAgent(chosenIntent)

    // 3) 发 agent_selected
    emit({
      type: 'agent_selected',
      data: {
        intent: chosenIntent,
        agent: agent.constructor.name,
        confidence: verdict.confidence,
        reason: verdict.reason,
        fallback: verdict.fallback,
      },
    })

    // 4) 运行
    if (!req.principal) {
      emit({ type: 'error', message: 'principal missing' })
      emit({ type: 'done' })
      return
    }

    const ctx: AgentContext = {
      principal: req.principal,
      question: step.question ?? question,
      session_id: sessionId,
      history: historyCheck.value,
      signal: ac.signal,
      emit,
      spaceId: typeof body.space_id === 'number' && Number.isFinite(body.space_id)
        ? body.space_id
        : undefined,
    }

    await agent.run(ctx)
  } catch (err) {
    if (!ac.signal.aborted && !res.writableEnded) {
      emit({ type: 'error', message: err instanceof Error ? err.message : 'Internal error' })
      emit({ type: 'done' })
    }
  } finally {
    // 结构化日志（info）
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({
      event: 'agent_dispatch',
      user_id: req.principal?.user_id,
      intent: chosenIntent,
      fallback,
      session_id: sessionId,
      duration_ms: Date.now() - startAt,
    }))
  }

  if (!res.writableEnded) res.end()
}
