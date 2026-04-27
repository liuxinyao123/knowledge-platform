import { runRagPipeline } from '../../services/ragPipeline.ts'
import {
  isEnabled as vikingEnabled,
  recallMemory,
  saveMemory,
  formatRecallAsContext,
} from '../../services/viking/index.ts'
import type { Agent, AgentContext } from '../types.ts'
import type { EmitFn, SseEvent, HistoryMessage } from '../../ragTypes.ts'

/**
 * KnowledgeQaAgent
 *
 * 默认行为：直接跑 ragPipeline，与历史完全一致。
 *
 * VIKING_ENABLED=1 时（ADR-31 候选 · OpenViking sidecar 实验）增加：
 *   1. 跑 RAG 前 recall 用户的历史记忆 → 拼成 context block 注入 history 头部
 *   2. 跑 RAG 时拦截 emit 把 'content' token 累积成 answerBuf
 *   3. RAG 结束（不论 done / error）后 fire-and-forget 把 QA 对写回 viking
 *
 * 全程软超时 + 错误吞掉，主链路对故障无感。
 */
export class KnowledgeQaAgent implements Agent {
  id = 'knowledge_qa' as const
  requiredAction = 'READ' as const

  async run(ctx: AgentContext): Promise<void> {
    // ── viking 关闭 / 没传 session_id：完全走旧路径，零开销 ─────
    if (!vikingEnabled() || !ctx.session_id) {
      await runRagPipeline(ctx.question, ctx.history, ctx.emit, ctx.signal, {
        spaceId: ctx.spaceId,
        principal: ctx.principal,
        webSearch: ctx.webSearch,
        image: ctx.image,
      })
      return
    }

    const principalId = (ctx.principal as { id?: string | number }).id
    if (principalId === undefined || principalId === null) {
      // principal 没 id（理论上不该发生）—— 安全退到旧路径
      await runRagPipeline(ctx.question, ctx.history, ctx.emit, ctx.signal, {
        spaceId: ctx.spaceId,
        principal: ctx.principal,
        webSearch: ctx.webSearch,
        image: ctx.image,
      })
      return
    }

    // ── 1. recall（软超时由 vikingClient 控制） ──────────────────
    const recall = await recallMemory({
      question: ctx.question,
      principalId,
      sessionId: ctx.session_id,
      topK: 5,
    })

    // emit recall 步骤（即便 0 hits 也 emit 一次，便于调试 viking 是否启用）
    ctx.emit({ type: 'viking_step', data: { stage: 'recall', count: recall.count } })

    // 把命中拼成 context block 加到 history 头部（不动 ctx.history 原对象）
    let augmentedHistory: HistoryMessage[] = ctx.history
    if (recall.hits.length > 0) {
      const contextBlock = formatRecallAsContext(recall.hits)
      augmentedHistory = [
        { role: 'user', content: contextBlock },
        ...ctx.history,
      ]
    }

    // ── 2. 拦截 emit 累积 answer 文本 ─────────────────────────────
    const answerBuf: string[] = []
    const wrappedEmit: EmitFn = (event: SseEvent) => {
      if (event.type === 'content' && typeof event.text === 'string') {
        answerBuf.push(event.text)
      }
      ctx.emit(event)
    }

    // ── 3. 跑 RAG（不动） ───────────────────────────────────────
    try {
      await runRagPipeline(ctx.question, augmentedHistory, wrappedEmit, ctx.signal, {
        spaceId: ctx.spaceId,
        principal: ctx.principal,
        webSearch: ctx.webSearch,
        image: ctx.image,
      })
    } finally {
      // ── 4. fire-and-forget save（即便 RAG 抛了也尽量保留 partial answer）
      const answer = answerBuf.join('').trim()
      if (answer) {
        // 不 await，软超时由 vikingClient 控制
        void saveMemory({
          principalId,
          sessionId: ctx.session_id!,
          question: ctx.question,
          answer,
        })
          .then((r) => {
            if (r.ok && r.uri) {
              try {
                ctx.emit({ type: 'viking_step', data: { stage: 'save', count: 1, uri: r.uri } })
              } catch {
                // SSE 已关闭，忽略
              }
            }
          })
          .catch(() => {
            // client 已 warn，这里再保险吞一次
          })
      }
    }
  }
}
