/**
 * ragTypes.ts
 *
 * - 新命名（asset_*）对外契约，供 knowledge-qa change 交付。
 * - 旧 PageDoc 保留给 vectorSearch.ts 等遗留路径；ragPipeline 已不再使用。
 */

// ── 新契约（asset_*）─────────────────────────────────────────────────────────

export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}

export interface RagTrace {
  initial_count: number
  kept_count: number
  rewrite_triggered: boolean
  rewrite_strategy?: 'step_back' | 'hyde'
  rewritten_query?: string
  citations: Citation[]
  /** vector：pgvector；bookstack：遗留 BookStack 搜索（当前 change 已下线调用） */
  retrieval_source?: 'vector' | 'bookstack'
  /** 是否启用了 cross-encoder reranker（仅 trace 信号，便于调试） */
  reranker_used?: boolean
  reranker_model?: string
  /** 检索策略：vector / hybrid（hybrid = vector + keyword via RRF） */
  retrieval_strategy?: 'vector' | 'hybrid'
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── 遗留契约（保留供 vectorSearch.ts / dataAdminAgent.ts 用）──────────────────

export interface PageDoc {
  id: number
  name: string
  url: string
  text: string
  excerpt: string
}

// ── 前端面板联动 ───────────────────────────────────────────────────────────

export type AssetPanelSsePayload = {
  open?: boolean
  sourceId?: number
  itemId?: number
  tab?: 'assets' | 'rag' | 'graph'
}

// ── SSE 事件 ──────────────────────────────────────────────────────────────

/** Agent 编排层分发后的元数据，仅由 dispatch 入口 emit 一次 */
export interface AgentSelectedPayload {
  intent: 'knowledge_qa' | 'data_admin' | 'structured_query' | 'metadata_ops'
  agent: string                // 类名
  confidence: number
  reason: string
  fallback: boolean
}

/** OpenViking sidecar (ADR-31 候选) — Agent 跨会话记忆步骤事件 */
export interface VikingStepPayload {
  /** recall: 召回历史记忆并注入 system；save: QA 对落库 */
  stage: 'recall' | 'save'
  /** recall: 命中数；save: 1 (写成功) / 0 (写失败) */
  count: number
  /** 仅 save 阶段：落库 viking:// uri */
  uri?: string
}

/** ADR-35：联网检索结果（前端引用 web 类型显示） */
export interface WebStepPayload {
  /** provider 名（tavily / bing / none） */
  provider: string
  /** 命中条数 */
  count: number
  /** 命中列表（供前端右栏渲染） */
  hits: Array<{ title: string; url: string; snippet: string }>
}

export type SseEvent =
  | { type: 'rag_step'; icon: string; label: string }
  | { type: 'content'; text: string }
  | { type: 'trace'; data: RagTrace | Record<string, unknown> }
  | { type: 'asset_panel'; data: AssetPanelSsePayload }
  | { type: 'agent_selected'; data: AgentSelectedPayload }
  | { type: 'ontology_context'; data: { entities_count: number; edges_count: number; hop_depth: number; fallback: boolean } }
  | { type: 'viking_step'; data: VikingStepPayload }
  | { type: 'web_step'; data: WebStepPayload }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type EmitFn = (event: SseEvent) => void
