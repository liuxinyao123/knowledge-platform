/**
 * ragPipeline.ts —— 知识问答 Agentic RAG（基于 pgvector）
 *
 * 契约：openspec/changes/knowledge-qa/
 *   - Step 1 retrieveInitial → knowledgeSearch，score > 0.5，top_k=10
 *   - Step 2 gradeDocs (function-call，保底 Top2)
 *   - Step 3 rewriteQuestion (gradedDocs.length < 3 触发)
 *   - Step 4 generateAnswer (流式 + history)
 *   - Step 5 trace 新字段：initial_count/kept_count/citations[asset_*]
 */
import { chatComplete, chatStream, getLlmFastModel, getLlmModel, isLlmConfigured } from './llm.ts'
import type { OAITool, ChatMessage } from './llm.ts'
import { searchKnowledgeChunks, EmbeddingNotConfiguredError, type AssetChunk } from './knowledgeSearch.ts'
import type { Citation, RagTrace, SseEvent, EmitFn, HistoryMessage } from '../ragTypes.ts'
import { isDataAdminQuestion, runDataAdminPipeline } from './dataAdminAgent.ts'
import { rerank, isRerankerConfigured, rerankerModel } from './reranker.ts'
import { formatRelevanceScore } from './relevanceFormat.ts'
import { searchHybrid } from './hybridSearch.ts'
import { recordCitations } from './knowledgeGraph.ts'
import { expandOntologyContext } from './ontologyContext.ts'
import { condenseQuestion } from './condenseQuestion.ts'
import { classifyAnswerIntent, isHandlerRoutingEnabled } from './answerIntent.ts'
import { buildSystemPromptByIntent, type CitationStyle } from './answerPrompts.ts'
import { isObviousKbMeta, isKbMetaHandlerEnabled, runKbMetaHandler } from './kbMetaHandler.ts'

export type { Citation, RagTrace, SseEvent, EmitFn, HistoryMessage } from '../ragTypes.ts'
export type { AssetChunk } from './knowledgeSearch.ts'

// ── 常量 ─────────────────────────────────────────────────────────────────────

const MIN_SCORE = 0.5
const TOP_K = 10
// 启用 reranker 时，向量召回先拉宽到 RECALL_TOP_N，再 cross-encoder 精排回 TOP_K
const RECALL_TOP_N = Number(process.env.RAG_RECALL_TOP_N ?? 20)
const REWRITE_NEED_THRESHOLD = 3
const GRADE_FALLBACK_TOP = 2
const HISTORY_MAX_MESSAGES = 40

/** B · rerank top-1 低于此阈值时 emit 显式 WARN；env 非法回落 0.1 */
function getRelevanceWarnThreshold(): number {
  const raw = process.env.RAG_RELEVANCE_WARN_THRESHOLD
  if (!raw) return 0.1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.1
}

/**
 * H3 根治 · short-circuit：top-1 低于此阈值时不再调 LLM，直接兜底回答。
 * 防止 LLM 被全 OCR / 全 error_json 的 context 污染后只吐一两个字。
 * 默认 0.05（比 WARN 阈值 0.1 更严）；env `RAG_NO_LLM_THRESHOLD` 可覆盖。
 */
function getNoLlmThreshold(): number {
  const raw = process.env.RAG_NO_LLM_THRESHOLD
  if (!raw) return 0.05
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.05
}

/** Hybrid 检索 env 开关（默认关；HYBRID_SEARCH_ENABLED=true|1|on 启用） */
function isHybridSearchEnabled(): boolean {
  const v = (process.env.HYBRID_SEARCH_ENABLED ?? '').toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'on' || v === 'yes'
}

/**
 * 根据问题特征自适应选 top-K：
 *   - 英文缩写题（"API" / "COF" / "B2B" 等大写缩写）→ 5（噪声大，少召回更准）
 *   - 中文短查询（≤ 6 字符）→ 8（之前 5 太窄，把"什么是道？" / "缓冲块"
 *     这种已经包含 3-4 个语义单元的短中文问题召回降太狠，反而扑空）
 *   - 复合查询（含「和」「与」「分别」「对比」「区别」「步骤」「构成」「分类」） → 15
 *   - 默认 → 10
 *
 * 理由：固定 10 chunks 对短题噪声大、对长题素材不够；但中文/英文短题语义
 * 密度差异大，不能用同一个 K。
 *
 * 注意：adaptiveTopK 看到的是 `retrievalQuestion`（A condense 改写后），
 * 所以 history 非空 + 短指代型问题会先被改写成长问句，绕过本函数的"短"
 * 分支。本函数只在 condense 不触发时（history 空 / 不命中触发条件）生效。
 *
 * 导出供单测断言；运行时仍是模块内部调用。
 */
export function adaptiveTopK(question: string): number {
  const q = question.trim()
  // 1. 英文大写缩写题（≤6 字符，且形如 "API" / "COF" / "B2B"）：噪声大，K=5
  if (/^[A-Z][A-Z0-9\-_]{1,5}\??$/.test(q)) {
    return 5
  }
  // 2. 中文短查询（≤6 字符）：K=8
  if (q.length <= 6) {
    return 8
  }
  // 3. 复合查询：含明显的"多个对象/步骤/对比"信号词 → K=15
  const compositeMarkers = [
    '和', '与', '及', '分别', '对比', '区别', '差异', '比较',
    '步骤', '流程', '哪些', '构成', '组成', '分类', '所有',
    'compare', 'difference', 'between', 'list', 'all', 'steps',
  ]
  if (compositeMarkers.some((m) => q.includes(m))) {
    return 15
  }
  // 4. 默认 → K=10
  return 10
}

/**
 * gradeDocs 行为：
 *   - 'auto'   reranker 开 → 跳过；reranker 关 → 跑（默认）
 *   - 'always' 总是跑（旧行为）
 *   - 'never'  总是跳过
 *
 * 跳过的好处：reranker 已经做过相关性精排（cross-encoder 比 LLM judge 更准），
 *           gradeDocs 再用 LLM 二次过滤会双重过滤、把"分数不够高但其实对"的 chunk 误杀。
 */
function gradeDocsMode(): 'auto' | 'always' | 'never' {
  const v = (process.env.GRADE_DOCS_MODE ?? 'auto').toLowerCase().trim()
  if (v === 'always' || v === 'never') return v
  return 'auto'
}

// ── Tool 定义（function-calling 结构化输出） ──────────────────────────────────

const GRADE_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'grade_document',
    description: 'Grade document relevance to the user question',
    parameters: {
      type: 'object',
      properties: {
        relevant: { type: 'boolean', description: 'Is the document relevant?' },
        reason: { type: 'string', description: 'Brief reason' },
      },
      required: ['relevant', 'reason'],
    },
  },
}

const REWRITE_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'rewrite_query',
    description: 'Choose a query rewrite strategy',
    parameters: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          enum: ['step_back', 'hyde'],
          description: 'step_back: generalize; hyde: hypothetical answer as query',
        },
        rewritten_query: { type: 'string', description: 'The rewritten query' },
      },
      required: ['strategy', 'rewritten_query'],
    },
  },
}

// ── Step 1：retrieveInitial ──────────────────────────────────────────────────

export async function retrieveInitial(
  question: string,
  emit: EmitFn,
  opts: { assetIds?: number[]; topK?: number; spaceId?: number } = {},
): Promise<AssetChunk[]> {
  const useRerank = isRerankerConfigured()
  const useHybrid = isHybridSearchEnabled()
  // 自适应 top-K（来自调用方）；未传则用全局 TOP_K
  const targetTopK = opts.topK ?? TOP_K
  // 启用 rerank 时召回宽到 max(targetTopK, RECALL_TOP_N)，再精排到 targetTopK
  const recallK = useRerank ? Math.max(targetTopK, RECALL_TOP_N) : targetTopK

  // space-permissions (ADR 2026-04-23-26)：把 spaceId 解析成 source_ids 集合，
  // 用 source_ids 下推到检索层比 asset_ids 成本低（一空间几个源 vs 几千资产）。
  let scopedSourceIds: number[] | undefined
  if (opts.spaceId != null) {
    const { getPgPool } = await import('./pgDb.ts')
    const { rows } = await getPgPool().query(
      `SELECT source_id FROM space_source WHERE space_id = $1`,
      [opts.spaceId],
    )
    scopedSourceIds = rows.map((r) => Number(r.source_id))
    if (scopedSourceIds.length === 0) {
      // 空间下无源 → 直接返回空结果，不打 embedding
      emit({ type: 'rag_step', icon: '🧭', label: `仅本空间 #${opts.spaceId}（未关联数据源，跳过检索）` })
      return []
    }
    emit({ type: 'rag_step', icon: '🧭', label: `仅本空间 #${opts.spaceId}（限定 ${scopedSourceIds.length} 个数据源）` })
  }

  emit({ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' })
  let raw: AssetChunk[]
  if (useHybrid) {
    const hr = await searchHybrid({
      query: question,
      top_k: recallK,
      asset_ids: opts.assetIds,
      source_ids: scopedSourceIds,
    })
    const breakdown = {
      v: hr.filter((x) => x.source_set === 'v').length,
      k: hr.filter((x) => x.source_set === 'k').length,
      b: hr.filter((x) => x.source_set === 'b').length,
    }
    emit({
      type: 'rag_step', icon: '🧬',
      label: `Hybrid 检索（向量 ${breakdown.v} / 关键词 ${breakdown.k} / 双路 ${breakdown.b}）`,
    })
    // 保留 score（这里是 rrf_score），但脱掉额外字段，下游统一按 AssetChunk 处理
    raw = hr.map((x) => ({
      asset_id: x.asset_id,
      asset_name: x.asset_name,
      chunk_content: x.chunk_content,
      score: x.rrf_score,
      metadata: x.metadata,
    }))
  } else {
    raw = await searchKnowledgeChunks({
      query: question,
      top_k: recallK,
      asset_ids: opts.assetIds,
      source_ids: scopedSourceIds,
    })
  }
  // hybrid 模式下 score 是 RRF 不是相似度，不能用 MIN_SCORE 过滤
  const filtered = useHybrid ? raw : raw.filter((r) => r.score > MIN_SCORE)
  const scopeHint = opts.assetIds?.length ? `（限定 ${opts.assetIds.length} 个资产）` : ''
  if (!useHybrid) {
    emit({
      type: 'rag_step', icon: '🧲',
      label: `向量检索${scopeHint}（命中 ${raw.length} / 阈值过滤后 ${filtered.length}）`,
    })
  }

  if (!useRerank || filtered.length <= 1) return filtered.slice(0, targetTopK)

  // ── Cross-encoder rerank ──
  emit({ type: 'rag_step', icon: '🎯', label: `Reranker 精排中（${rerankerModel()}）→ top ${targetTopK}` })
  try {
    const docs = filtered.map((c) => c.chunk_content)
    const ranked = await rerank(question, docs, targetTopK)
    if (ranked.length === 0) return filtered.slice(0, targetTopK)

    // 按 rerank 顺序重排；保留 chunk 原元信息，但把 score 替换成 rerank 分（方便 trace 看到差异）
    const reordered = ranked.map((r) => ({
      ...filtered[r.index],
      score: r.score,
    }))
    emit({
      type: 'rag_step', icon: '✨',
      label: `Reranker 精排完成（前 5 分数：${ranked.slice(0, 5).map((r) => formatRelevanceScore(r.score)).join(' / ')}）`,
    })

    // B · 相关性阈值 WARN：top-1 过低时显式提示，避免用户以为系统坏了
    const top1 = ranked[0]?.score ?? 0
    if (top1 < getRelevanceWarnThreshold()) {
      emit({
        type: 'rag_step', icon: '⚠️',
        label: `检索结果相关性极低（top-1 = ${formatRelevanceScore(top1)}）。可能原因：`
          + `① 该问题库里没有相关文档 ② 文档质量差（OCR 碎片 / 入库异常）`
          + `③ 问法需要调整。`,
      })
    }
    return reordered
  } catch (err) {
    // 降级：rerank 失败不影响主流程，沿用向量检索顺序
    emit({
      type: 'rag_step', icon: '⚠️',
      label: `Reranker 调用失败，降级用向量序：${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`,
    })
    return filtered.slice(0, targetTopK)
  }
}

// ── Step 2：gradeDocs ────────────────────────────────────────────────────────

export async function gradeDocs(
  question: string,
  docs: AssetChunk[],
  emit: EmitFn,
  options?: { ontology?: any },
): Promise<{ gradedDocs: AssetChunk[]; rewriteNeeded: boolean }> {
  emit({ type: 'rag_step', icon: '📊', label: '正在评估文档相关性...' })

  if (docs.length === 0) {
    return { gradedDocs: [], rewriteNeeded: true }
  }

  const results = await Promise.all(
    docs.map(async (doc) => {
      try {
        // 构建提示，包含可选的 ontology_context 段
        let content = `Question: ${question}\n\nDocument: ${String(doc.chunk_content).slice(0, 500)}`

        // 仅当 ontology 非空时追加上下文
        if (options?.ontology && options.ontology.entities && options.ontology.entities.length > 0) {
          const ontology = options.ontology
          const yaml = formatOntologyYaml(ontology)
          if (yaml) {
            content += `\n\n<ontology_context>\n${yaml}\n</ontology_context>`
          }
        }

        const { toolCalls } = await chatComplete(
          [{
            role: 'user',
            content,
          }],
          {
            model: getLlmFastModel(),
            maxTokens: 150,
            tools: [GRADE_TOOL],
            toolChoice: { type: 'function', function: { name: 'grade_document' } },
          },
        )
        const args = toolCalls[0]?.function?.arguments
        if (!args) return { doc, relevant: true } // 解析失败保守保留
        try {
          const parsed = JSON.parse(args) as { relevant?: boolean }
          return { doc, relevant: Boolean(parsed.relevant) }
        } catch {
          return { doc, relevant: true }
        }
      } catch {
        return { doc, relevant: true } // LLM 调用失败也保守保留
      }
    }),
  )

  const relevant = results.filter((r) => r.relevant).map((r) => r.doc)
  const gradedDocs =
    relevant.length >= GRADE_FALLBACK_TOP
      ? relevant
      : [...docs].sort((a, b) => b.score - a.score).slice(0, GRADE_FALLBACK_TOP)

  return { gradedDocs, rewriteNeeded: gradedDocs.length < REWRITE_NEED_THRESHOLD }
}

/**
 * 格式化 OntologyContext 为 YAML（≤ 2KB）
 */
function formatOntologyYaml(ontology: any): string {
  if (!ontology || !ontology.entities) return ''

  const lines: string[] = []
  lines.push('entities:')
  const entities = (ontology.entities || []).slice(0, 30) // 上限 30 个实体
  for (const e of entities) {
    lines.push(`  - kind: ${e.kind}`)
    lines.push(`    id: ${e.id}`)
    lines.push(`    label: ${String(e.label || e.id).replace(/\n/g, ' ')}`)
    lines.push(`    distance: ${e.distance}`)
  }

  lines.push('edges:')
  const edges = (ontology.edges || []).slice(0, 40) // 上限 40 条边
  for (const edge of edges) {
    lines.push(`  - kind: ${edge.kind}`)
    lines.push(`    from: ${edge.from}`)
    lines.push(`    to: ${edge.to}`)
    if (edge.weight != null) {
      lines.push(`    weight: ${edge.weight}`)
    }
  }

  let yaml = lines.join('\n')
  // 限制 2KB
  if (yaml.length > 2000) {
    yaml = yaml.slice(0, 1997) + '...'
  }
  return yaml
}

// ── Step 3：rewriteQuestion ──────────────────────────────────────────────────

export async function rewriteQuestion(
  question: string,
  emit: EmitFn,
): Promise<{ strategy: 'step_back' | 'hyde'; rewrittenQuery: string }> {
  emit({ type: 'rag_step', icon: '✏️', label: '正在重写查询...' })

  const { toolCalls } = await chatComplete(
    [{
      role: 'user',
      content: `选择最合适的查询扩展策略并重写查询：
step_back: 泛化具体问题为更宽泛的概念
hyde: 生成一个假设答案作为新查询

原始问题: ${question}`,
    }],
    {
      maxTokens: 400,
      tools: [REWRITE_TOOL],
      toolChoice: { type: 'function', function: { name: 'rewrite_query' } },
    },
  )

  const args = toolCalls[0]?.function?.arguments
  let input: { strategy?: string; rewritten_query?: string } = {}
  try {
    input = JSON.parse(args ?? '{}')
  } catch {
    /* fallthrough */
  }

  return {
    strategy: input.strategy === 'hyde' ? 'hyde' : 'step_back',
    rewrittenQuery: input.rewritten_query ?? question,
  }
}

// ── Step 3.5：扩展检索（重写后合并 + 去重） ──────────────────────────────────

export async function retrieveExpanded(
  rewrittenQuery: string,
  initialDocs: AssetChunk[],
  emit: EmitFn,
): Promise<AssetChunk[]> {
  emit({ type: 'rag_step', icon: '🔄', label: '使用扩展查询重新检索...' })
  const newRaw = await searchKnowledgeChunks({ query: rewrittenQuery, top_k: TOP_K })
  const newDocs = newRaw.filter((r) => r.score > MIN_SCORE)
  const seen = new Set(initialDocs.map((d) => d.asset_id))
  return [...initialDocs, ...newDocs.filter((d) => !seen.has(d.asset_id))]
}

// ── Step 4：generateAnswer（流式 + 历史） ────────────────────────────────────

export async function generateAnswer(
  question: string,
  docs: AssetChunk[],
  history: HistoryMessage[],
  emit: EmitFn,
  signal: AbortSignal,
  systemPromptOverride?: string,
  extras?: {
    webHits?: Array<{ title: string; url: string; snippet: string }>
    image?: { base64: string; mimeType?: string }
  },
  citationStyle: CitationStyle = 'inline',
): Promise<void> {
  emit({ type: 'rag_step', icon: '💡', label: '正在生成回答...' })

  // ADR-45：是否在答案正文里嵌入图片（默认 on；与 CITATION_IMAGE_URL_ENABLED 独立）
  const inlineImageEnabled = isInlineImageInAnswerEnabled()

  const docContext = docs
    .map((d, i) => {
      const head = `[${i + 1}] ${d.asset_name}`
      // ADR-45：image_caption chunk 多吐一行 IMAGE: 给 LLM 抄进 markdown
      const imageLine =
        inlineImageEnabled &&
        d.kind === 'image_caption' &&
        typeof d.image_id === 'number' &&
        d.image_id > 0
          ? `\nIMAGE: /api/assets/images/${d.image_id}`
          : ''
      return `${head}${imageLine}\n${d.chunk_content}`
    })
    .join('\n\n---\n\n')

  // ADR-35：把联网检索结果也拼进 context（编号 [w1] [w2]，与文档 [N] 区分）
  const webContext = extras?.webHits?.length
    ? '\n\n【联网检索结果】\n' + extras.webHits.map((h, i) =>
        `[w${i + 1}] ${h.title}\nURL: ${h.url}\n${h.snippet}`,
      ).join('\n---\n')
    : ''
  const context = docContext + webContext

  const trimmedHistory = history.slice(-HISTORY_MAX_MESSAGES)

  // ADR-35：图片附件 → 用户消息走 ContentBlock[] 格式（OpenAI 兼容协议）
  const userContent = extras?.image
    ? [
        { type: 'text' as const, text: question },
        { type: 'image_url' as const, image_url: {
            url: `data:${extras.image.mimeType ?? 'image/png'};base64,${extras.image.base64}`,
            detail: 'auto' as const,
        }},
      ]
    : question
  const messages: ChatMessage[] = [
    ...trimmedHistory.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userContent },
  ]

  // ADR-45：当 inline image 开启且本批召回里至少有一张图时，给 prompt 加规则 6
  const hasImageDocs = inlineImageEnabled && docs.some(
    (d) => d.kind === 'image_caption' && typeof d.image_id === 'number' && d.image_id > 0,
  )
  const inlineImageRule = hasImageDocs
    ? `\n6. **图片内嵌（可选）**：如果某个 [N] 文档片段紧跟有 \`IMAGE: /api/assets/images/<id>\` 行，且该图能直接说明你的答案，可以在引用 [N] 后**立刻**换行写一行 markdown \`![简短描述](/api/assets/images/<id>)\`。**严格规则**：(a) URL 必须照抄 IMAGE: 行的字面值，**禁止编造任何 image_id**；(b) 文档片段没有 IMAGE: 行就**不要**插图；(c) 图与文字相辅相成，不要为了插图而插图。`
    : ''

  // ADR-46 D-002 · 意图分类 + Handler 分流
  //
  // 旧实现是 monolithic system prompt：一份 prompt 同时扛事实查询/翻译解释/对比/
  // 元查询/超范围声明 5 类场景，对每种"任意上传的文档"都用同一套规则——结果是
  // 工业 SOP 案例污染古文翻译、加了"语言层例外"又污染严格事实查询、永远写不完。
  //
  // 现在拆成 5 个专用 prompt 模板（services/answerPrompts.ts），用 fast LLM 先
  // 判断意图（services/answerIntent.ts），按意图选模板：
  //
  //   factual_lookup    → 严格 verbatim，不做语言转换
  //   language_op       → 必须对召回原文做翻译/释义/总结，不能拒答
  //   multi_doc_compare → 强制分项，不漏组件
  //   kb_meta           → 只列 asset_name，不进文档内容
  //   out_of_scope      → 直接说找不到 + 列沾边资产
  //
  // 任何分类失败 → factual_lookup（最安全默认）。env B_HANDLER_ROUTING_ENABLED
  // 关闭时同样回落到 factual_lookup（=老 monolithic 严格 RAG 行为）。
  //
  // **web 模式（hasWeb）走另一条 prompt**：当用户开了 🌐，需要明确"两类来源
  // 优先级"，跟意图分类正交，保留原有 prompt 结构不动。
  const hasWeb = (extras?.webHits?.length ?? 0) > 0

  let intent: 'factual_lookup' | 'language_op' | 'multi_doc_compare' | 'kb_meta' | 'out_of_scope' = 'factual_lookup'
  let intentReason = ''
  let intentFallback = false
  if (!hasWeb) {
    const cls = await classifyAnswerIntent(question, docs)
    intent = cls.intent
    intentReason = cls.reason
    intentFallback = cls.fallback
    if (!intentFallback) {
      emit({
        type: 'rag_step', icon: '🎭',
        label: `答案意图分类 → ${intent}（${intentReason || '已分类'}）`,
      })
    }
  }

  // D-002.2 · 档 B kb_meta fallback —— 顶层 isObviousKbMeta 漏判时（语义型查询，
  // 例如"我这库里有道德经吗"档 B 才意识到是 kb_meta）也走目录直查 handler，
  // 不走 buildKbMetaPrompt + LLM 流（LLM 容易把 retrieval 命中的内容当成"问内容"
  // 来吐 chunk content；kbMetaHandler 直查 metadata_asset 输出 asset 列表更准）。
  // env KB_META_HANDLER_ENABLED=false 时回退到老 buildKbMetaPrompt + LLM 流。
  if (!hasWeb && intent === 'kb_meta' && isKbMetaHandlerEnabled()) {
    // 档 B fallback：caller (runRagPipeline) 自己 emit trace + done；
    // 🎭 已在前面 emit 过 → 都跳过
    await runKbMetaHandler(question, emit, signal, {
      assetIds: docs.map((d) => d.asset_id),  // 复用 retrieval 命中的 asset_id 子集
      omitDoneAndTrace: true,
      omitIntentEmit: true,
    })
    return
  }

  const defaultSystem = hasWeb
    ? // ADR-35：web 模式 prompt 不变（联网检索特有的"两类来源优先级"语义跟意图正交）
      `你是知识库 + 联网检索助手。可用两类来源：

  · [N] 知识库内部文档（权威，优先采用）
  · [wN] 联网检索结果（公开网络信息，知识库无答案时使用）

【硬性规则】
1. **优先用 [N] 文档作答**，文档无相关内容时才用 [wN] 网络结果
2. **每个事实陈述都要加引用**：内部用 [N]，网络用 [wN]，混合用 [1][w2]
3. **明确标注来源类型**：用网络信息时在答案里说明"根据公开网络信息..."
4. **数值/规格 verbatim**：原文「7 degrees」就写「7°」，禁止近似
5. **两类都没相关**才说「知识库 + 公开网络都没找到该信息」${inlineImageRule}

【输出格式】
- 简洁直接，不复述问题
- 数字 + 单位写在一起：「1.5mm」「7°」
- 答案末尾**不**写"以上信息来源于…"这种总结句

文档内容：
${context}`
    : // 默认 RAG · 按意图选 prompt 模板（N-001：透传 citationStyle，notebook 用 footnote）
      buildSystemPromptByIntent(intent, context, inlineImageRule, citationStyle)

  // 有图时优先 VLM；没图沿用默认 LLM
  const visionModel = process.env.INGEST_VLM_MODEL?.trim()
    || 'Qwen/Qwen2.5-VL-72B-Instruct'
  const model = extras?.image ? visionModel : getLlmModel()

  const stream = chatStream(messages, {
    model,
    maxTokens: 2000,
    system: systemPromptOverride
      ? `${systemPromptOverride}\n\n文档内容：\n${context}`
      : defaultSystem,
  })

  for await (const text of stream) {
    if (signal.aborted) break
    emit({ type: 'content', text })
  }
}

// ── 辅助：AssetChunk → Citation ──────────────────────────────────────────────

/**
 * asset-vector-coloc · 是否在 Citation 中回填 image_id / image_url。
 * 默认 on；env CITATION_IMAGE_URL_ENABLED=false 时关闭，前端自动退回纯文本。
 */
function isCitationImageEnabled(): boolean {
  const v = (process.env.CITATION_IMAGE_URL_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/**
 * ADR-45 · 是否在答案正文里内嵌图片（导出 IMAGE: 行给 LLM + system prompt 加规则 6）。
 * 默认 on；env INLINE_IMAGE_IN_ANSWER_ENABLED=false 时关闭。与 CITATION_IMAGE_URL_ENABLED 独立。
 *
 * 关闭时：docContext 不出 IMAGE: 行，system prompt 也不加规则 6——LLM 不知道有图存在；
 * 前端 AnswerContent 仍会 best-effort 解析 markdown ![alt](url)，但严格只放过
 * `/api/assets/images/\\d+` 路径，且需要 LLM 自己生成那段 markdown（关闭后基本生成不出来）。
 */
export function isInlineImageInAnswerEnabled(): boolean {
  const v = (process.env.INLINE_IMAGE_IN_ANSWER_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/** asset-vector-coloc：导出供单测断言；其它内部调用方仍走同一份。 */
export function toCitation(doc: AssetChunk, index: number): Citation {
  const cite: Citation = {
    index,
    asset_id: doc.asset_id,
    asset_name: doc.asset_name,
    chunk_content: String(doc.chunk_content).slice(0, 500),
    score: doc.score,
  }
  // asset-vector-coloc：来源 chunk 是 image_caption 行 → 透出图字节回查链接
  if (
    isCitationImageEnabled() &&
    doc.kind === 'image_caption' &&
    typeof doc.image_id === 'number' &&
    doc.image_id > 0
  ) {
    cite.image_id = doc.image_id
    cite.image_url = `/api/assets/images/${doc.image_id}`
  }
  return cite
}

// ── 入口 ────────────────────────────────────────────────────────────────────

export interface RunRagOptions {
  /** Notebook 等场景：限定检索只在指定 metadata_asset.id 集合内 */
  assetIds?: number[]
  /** space-permissions (ADR 2026-04-23-26)：限定检索只在该 space 关联的 source 内 */
  spaceId?: number
  /** 替换默认系统提示（如要求 [^N] inline 引用） */
  systemPromptOverride?: string
  /** OAG (Ontology-Augmented Generation)：当前用户的 principal，用于 ACL 过滤 */
  principal?: any
  /** ADR-35：联网检索 toggle，true 时调 webSearch 把结果合进 LLM 上下文 */
  webSearch?: boolean
  /** ADR-35：多模态附件（base64 图片），存在时走 Qwen2.5-VL 视觉模型 */
  image?: { base64: string; mimeType?: string }
  /**
   * N-001 · 引用样式。inline = [N]（默认，全局 chat）；footnote = [^N]（notebook）
   * 仅在不传 systemPromptOverride 时生效（override 优先级最高，保持 freeze 契约）
   */
  citationStyle?: CitationStyle
}

export async function runRagPipeline(
  question: string,
  history: HistoryMessage[] = [],
  emit: EmitFn,
  signal: AbortSignal,
  opts: RunRagOptions = {},
): Promise<void> {
  if (!isLlmConfigured()) {
    emit({
      type: 'error',
      message:
        '未配置 LLM API Key，无法生成回答。\n请在 apps/qa-service/.env 中添加：\nSILICONFLOW_API_KEY=sk-...\n（或 LLM_API_KEY / EMBEDDING_API_KEY）',
    })
    emit({ type: 'done' })
    return
  }

  if (isDataAdminQuestion(question)) {
    await runDataAdminPipeline(question, emit, signal)
    return
  }

  // D-002.2 · kb_meta 顶层规则前置 ——
  // "我这库里有 X 吗"/"列出 X 文档" 这类目录元查询不应走 retrieval（rerank 必凉，
  // 走 short-circuit 兜底就把用户问的目录给吞了）。直查 metadata_asset 表。
  // 漏判会落到下面 retrieval → 档 B answerIntent='kb_meta' fallback 兜底。
  if (isKbMetaHandlerEnabled() && isObviousKbMeta(question)) {
    await runKbMetaHandler(question, emit, signal, { assetIds: opts.assetIds })
    return
  }

  const rerankerOn = isRerankerConfigured()
  const hybridOn = isHybridSearchEnabled()
  const trace: RagTrace = {
    initial_count: 0,
    kept_count: 0,
    rewrite_triggered: false,
    citations: [],
    retrieval_source: 'vector',
    retrieval_strategy: hybridOn ? 'hybrid' : 'vector',
    reranker_used: rerankerOn,
    reranker_model: rerankerOn ? rerankerModel() : undefined,
  }

  if (signal.aborted) return

  // Step 0 —— follow-up condensation（指代/短问题用历史改写成自洽问句）
  // 改写后的 query 只用于 retrieval / grade / step_back-hyde rewrite；
  // generateAnswer 仍喂原 question + 完整 history，让 LLM 看到用户原话。
  // 失败 / 触发条件不满足时返回原 question，不阻塞主流程。
  const retrievalQuestion = await condenseQuestion(question, history, emit)

  if (signal.aborted) return

  // Step 1 —— adaptive top-K（按改写后的 query 决定 K，更贴近真实检索意图）
  const dynK = adaptiveTopK(retrievalQuestion)
  if (dynK !== TOP_K) {
    const dynKReason =
      dynK === 5 ? '英文缩写题'
      : dynK === 8 ? '中文短查询'
      : dynK === 15 ? '复合查询'
      : `K=${dynK}`
    emit({
      type: 'rag_step', icon: '⚙️',
      label: `自适应 top-K = ${dynK}（${dynKReason}）`,
    })
  }
  // ingest-l0-abstract（ADR-32 候选 · 2026-04-26）
  //   L0_FILTER_ENABLED=on 时先用 L0 ANN 粗筛 candidate asset_ids，注入 retrieveInitial
  //   返回 undefined → 走原路径；返回 [] → coarseFilterByL0 已 emit warn 也走原路径
  //   只在调用方未显式传 assetIds 时才启用（Notebook 等已限定 scope 场景跳过）
  let l0FilteredAssetIds: number[] | undefined
  if (!opts.assetIds?.length) {
    try {
      const { coarseFilterByL0 } = await import('./l0Filter.ts')
      const cf = await coarseFilterByL0(retrievalQuestion, emit, {})
      if (Array.isArray(cf) && cf.length > 0) l0FilteredAssetIds = cf
    } catch {
      // coarseFilterByL0 自身永不抛；这里再保险一道
    }
  }
  const effectiveAssetIds = opts.assetIds ?? l0FilteredAssetIds
  // trace 字段（可选，老前端忽略）
  if (l0FilteredAssetIds !== undefined) {
    ;(trace as unknown as Record<string, unknown>).l0_filter_used = true
    ;(trace as unknown as Record<string, unknown>).l0_candidate_count = l0FilteredAssetIds.length
  }

  let initialDocs: AssetChunk[]
  try {
    initialDocs = await retrieveInitial(retrievalQuestion, emit, {
      assetIds: effectiveAssetIds,
      spaceId: opts.spaceId,
      topK: dynK,
    })
  } catch (err) {
    if (err instanceof EmbeddingNotConfiguredError) {
      emit({
        type: 'error',
        message:
          '未配置向量检索（EMBEDDING_API_KEY / SILICONFLOW_API_KEY）。\n请在 apps/qa-service/.env 中配置后重启。',
      })
      emit({ type: 'done' })
      return
    }
    throw err
  }
  trace.initial_count = initialDocs.length

  // ingest-l0-abstract（ADR-32 候选）：lazy 回填
  //   L0_LAZY_BACKFILL_ENABLED=on 时把候选里缺 L0 的 chunk_id 异步 enqueue
  //   fire-and-forget；失败仅 WARN，不阻断
  void (async () => {
    try {
      const ids = initialDocs.map((d) => d.chunk_id).filter((x): x is number => typeof x === 'number')
      if (!ids.length) return
      const { enqueueAbstractBackfill } = await import('./ingestPipeline/abstractBackfill.ts')
      await enqueueAbstractBackfill(ids)
    } catch {
      // 已 warn，不再噪音
    }
  })()

  if (signal.aborted) return

  // OAG —— 扩展 ontology 上下文（rerank 后、gradeDocs 前）
  const ontology = await expandOntologyContext({
    chunks: initialDocs.map((doc) => ({
      asset_id: String(doc.asset_id),
      score: doc.score,
    })),
    principal: opts.principal,
    maxHop: 2,
    timeoutMs: 200,
  })
  emit({
    type: 'ontology_context',
    data: {
      entities_count: ontology.entities.length,
      edges_count: ontology.edges.length,
      hop_depth: ontology.meta.hop_depth,
      fallback: ontology.meta.fallback,
    },
  })

  if (signal.aborted) return

  // Step 2 —— gradeDocs：reranker 开时默认跳过，避免双重过滤
  const gMode = gradeDocsMode()
  const skipGrade =
    gMode === 'never' || (gMode === 'auto' && rerankerOn)

  let gradedDocs: AssetChunk[]
  let rewriteNeeded = false
  if (skipGrade) {
    gradedDocs = initialDocs
    emit({
      type: 'rag_step', icon: '⏭',
      label: `跳过 LLM 文档相关性判断（${gMode === 'never' ? 'never' : 'reranker 已经精排'}）`,
    })
    // rewrite 触发条件改为：rerank 后还是不到 REWRITE_NEED_THRESHOLD 个候选
    rewriteNeeded = initialDocs.length < REWRITE_NEED_THRESHOLD
  } else {
    const r = await gradeDocs(retrievalQuestion, initialDocs, emit, { ontology })
    gradedDocs = r.gradedDocs
    rewriteNeeded = r.rewriteNeeded
  }
  trace.kept_count = gradedDocs.length

  let finalDocs = gradedDocs

  // Step 3
  if (rewriteNeeded && !signal.aborted) {
    const { strategy, rewrittenQuery } = await rewriteQuestion(retrievalQuestion, emit)
    trace.rewrite_triggered = true
    trace.rewrite_strategy = strategy
    trace.rewritten_query = rewrittenQuery

    if (!signal.aborted) {
      finalDocs = await retrieveExpanded(rewrittenQuery, gradedDocs, emit)
    }
  }

  trace.citations = finalDocs.map((d, i) => toCitation(d, i + 1))

  if (!signal.aborted) {
    // H3 short-circuit · rerank 开且 top-1 分数极低 → 直接兜底，不送 LLM
    const rerankerOn = isRerankerConfigured()
    const top1Score = finalDocs[0]?.score ?? 0
    const noLlm = getNoLlmThreshold()
    // D-008 · 用户显式 scope 场景（notebook 绑 sources 等）不应用 short-circuit。
    // 理由：user 把 docs 放进来 = 显式授权"用这些"，"产出测试要求" /
    // "总结一下" 等合成类 meta 查询天然 rerank 打低分；此时跳 LLM 等于
    // 把 notebook 变成摆设。WARN（0.1）仍然 emit，让用户知道相关性低。
    const userScoped = (opts.assetIds?.length ?? 0) > 0
    if (rerankerOn && userScoped && top1Score < noLlm) {
      emit({
        type: 'rag_step', icon: 'ℹ️',
        label: `用户显式 scope（${opts.assetIds?.length} 个资产），跳过阈值短路，正常调 LLM。`,
      })
    }
    if (rerankerOn && !userScoped && top1Score < noLlm) {
      emit({
        type: 'rag_step', icon: '⛔',
        label: `检索相关性过低（top-1 = ${formatRelevanceScore(top1Score)}），跳过 LLM 生成，改走兜底回复。`,
      })
      // 分多段 emit，让前端看起来像"流式"
      emit({ type: 'content', text: '抱歉，知识库里**暂时没有**与该问题直接相关的内容。\n\n' })
      emit({ type: 'content', text: `（检索相关性最高仅 ${formatRelevanceScore(top1Score)}，低于可用阈值 ${noLlm}）\n\n` })
      emit({ type: 'content', text: '可能原因：\n' })
      emit({ type: 'content', text: '  1. 该主题尚未入库；\n' })
      emit({ type: 'content', text: '  2. 已入库但文档质量偏低（扫描件 OCR 碎片 / 入库失败残留等）；\n' })
      emit({ type: 'content', text: '  3. 换种问法试试，比如更具体或更宽泛的表述。\n\n' })
      emit({ type: 'content', text: '你也可以去「资产目录」查看是否有相关文档，或在「检索」页用关键词直查。' })
      emit({ type: 'trace', data: trace })
      emit({ type: 'done' })
      return
    }
    // ADR-35：联网检索（toggled）—— 在 answer 生成之前异步并发跑，结果作为 [w1..wN] 拼进 LLM context
    let webHits: Array<{ title: string; url: string; snippet: string }> = []
    if (opts.webSearch) {
      try {
        const { webSearch, getProvider, isWebSearchConfigured } =
          await import('./webSearch.ts')
        if (isWebSearchConfigured()) {
          emit({ type: 'rag_step', icon: '🌐', label: `联网检索（${getProvider()}）...` })
          // 用 condensed query 走联网检索；原 question（如"把原文发我"）web 上等同噪声
          const hits = await webSearch(retrievalQuestion, { topK: 5 })
          webHits = hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
          emit({
            type: 'web_step',
            data: { provider: getProvider(), count: webHits.length, hits: webHits },
          })
        } else {
          emit({ type: 'rag_step', icon: '⚠️', label: '联网检索未配置（缺 TAVILY/BING_API_KEY），跳过' })
        }
      } catch {
        // 已在 webSearch 内部 warn
      }
    }

    // Step 4
    await generateAnswer(
      question,
      finalDocs,
      history,
      emit,
      signal,
      opts.systemPromptOverride,
      { webHits, image: opts.image },
      opts.citationStyle,  // N-001：notebook 用 'footnote'，全局 chat 默认 'inline'
    )
    // Step 5
    emit({ type: 'trace', data: trace })
    // 知识图谱：写 Question → CITED → Asset + CO_CITED（ADR 2026-04-23-27 · fire-and-forget）
    void recordCitations(question, trace.citations.map((c) => ({
      asset_id: c.asset_id, score: c.score ?? 0, rank: c.index,
    })))
    emit({ type: 'done' })
  }
}
