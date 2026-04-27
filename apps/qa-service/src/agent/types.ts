/**
 * agent/types.ts —— Agent 编排层核心类型
 * 契约：openspec/changes/agent-orchestrator/
 */
import type { Principal } from '../auth/types.ts'
import type { HistoryMessage, EmitFn } from '../ragTypes.ts'

export type AgentIntent =
  | 'knowledge_qa'
  | 'data_admin'
  | 'structured_query'
  | 'metadata_ops'

export const AGENT_INTENTS: readonly AgentIntent[] = [
  'knowledge_qa', 'data_admin', 'structured_query', 'metadata_ops',
] as const

export function isAgentIntent(x: unknown): x is AgentIntent {
  return typeof x === 'string' && (AGENT_INTENTS as readonly string[]).includes(x)
}

export interface IntentVerdict {
  intent: AgentIntent
  confidence: number            // 0..1
  reason: string
  fallback: boolean             // true = 走了关键字兜底
}

export interface AgentContext {
  principal: Principal
  question: string
  session_id?: string
  history: HistoryMessage[]
  signal: AbortSignal
  emit: EmitFn
  /** space-permissions (ADR 2026-04-23-26)：限定检索到该空间 */
  spaceId?: number
}

export interface Agent {
  id: AgentIntent
  /** 主动作：入口中间件用来决定 enforceAcl 需要的 action */
  requiredAction: 'READ' | 'WRITE' | 'ADMIN'
  run(ctx: AgentContext): Promise<void>
}

export interface DispatchPlan {
  steps: Array<{ intent: AgentIntent; question?: string }>
}
