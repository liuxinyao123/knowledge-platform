/**
 * services/answerIntent.ts —— 答案生成意图分类（档 B 核心）
 *
 * 背景（详见 ADR-46）：单一 monolithic system prompt 扛不住任意文档类型 ——
 * 工业制造文档要 verbatim 数值、古文要白话翻译、合同要逐条比对、问"库里有什么"
 * 时根本不该走 RAG 而该走 asset_catalog。塞 prompt 例外/示例 → 个例化偏置 +
 * 永远写不完。
 *
 * 本模块在 retrieval 之后、generateAnswer 选 prompt 之前，用 fast LLM 把"用户
 * 问题 × 召回文档形态"分到 5 类意图，下游按意图选不同 prompt 模板（见
 * services/answerPrompts.ts），每个模板短而专一。
 *
 * 设计原则：
 *   - 默认 on，env `B_HANDLER_ROUTING_ENABLED=false` 关闭（回落 factual_lookup
 *     行为，等价老 monolithic prompt 的"严格 RAG"路径）
 *   - 失败 / 未配置 LLM → 返回 factual_lookup（最安全的默认意图）
 *   - 不阻塞主流程，超时硬截 1s
 *   - 输入只用 question + 召回前 3 段的 chunk_content 截断，控成本
 */
import { chatComplete, getLlmFastModel, isLlmConfigured } from './llm.ts'
import type { OAITool } from './llm.ts'
import type { AssetChunk } from './knowledgeSearch.ts'

/**
 * 5 类答案意图。
 *
 *   factual_lookup    — 用户在文档里找事实（数值/规格/定义/位置/时间/人物）
 *                       例：「缓冲块设计间隙是多少」「道德经是谁写的」「合同生效日期」
 *
 *   language_op       — 对**召回的文档原文**做语言层转换（翻译/释义/总结/改写/列表化）
 *                       例：「把上面这段翻译成英文」「给道德经第一章做白话解释」
 *                           「总结一下这份合同的关键条款」「把流程改写成步骤列表」
 *                       关键：文档里有原文 → 必须做，不能拒答说"知识库中没有解释"
 *
 *   multi_doc_compare — 对比/罗列多个对象、概念、文档之间的差异或分别情况
 *                       例：「CORS 和 CSRF 的区别」「分别说明 A B C 三种方案」
 *                           「列出所有 ≥ 5mm 的件」
 *
 *   kb_meta           — 询问知识库里有什么资料 / 找某类文档（不是问内容，是问目录）
 *                       例：「库里有道德经吗」「找一下汽车制造相关的文档」
 *                           「列出所有 PDF 资产」
 *                       注：这类问题 RAG generation 不擅长，理想是路由到
 *                       asset_catalog API；MVP 阶段先用召回的 asset_name 列表回答
 *
 *   out_of_scope      — 问题问的是文档外的背景、历史、原因、评价、推断
 *                       例：「老子是哪个朝代的人」（如果文档没有此信息）
 *                           「为什么这个公差是 0.3mm」（文档只给数值，未给原因）
 */
export type AnswerIntent =
  | 'factual_lookup'
  | 'language_op'
  | 'multi_doc_compare'
  | 'kb_meta'
  | 'out_of_scope'

export const ANSWER_INTENTS: readonly AnswerIntent[] = [
  'factual_lookup',
  'language_op',
  'multi_doc_compare',
  'kb_meta',
  'out_of_scope',
] as const

const DEFAULT_INTENT: AnswerIntent = 'factual_lookup'
const CLASSIFY_TIMEOUT_MS = 1500
const DOC_PREVIEW_CHARS = 200
const DOC_PREVIEW_COUNT = 3

export function isHandlerRoutingEnabled(): boolean {
  const v = (process.env.B_HANDLER_ROUTING_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

export function isAnswerIntent(s: unknown): s is AnswerIntent {
  return typeof s === 'string' && (ANSWER_INTENTS as readonly string[]).includes(s)
}

/**
 * 规则前置（V3B 修复）：fast LLM (Qwen 7B) 在 prompt 强判规则下仍偶尔把 "把上面
 * 这段翻译成中文" 误判到 factual_lookup（看到 chunks 是 LFTGATE 内容就误以为
 * "在找事实"）。规则前置——含明显 meta 动词 + 祈使句/指代/短句 → 直接强制
 * language_op，跳过 LLM 概率执行，确定性 100%。
 *
 * 边缘 case 风险：用户问 "什么是翻译" 可能误触发；但即便误判到 language_op，
 * LLM 拿到"翻译"相关 chunks 做转换 → 答案仍合理；且这种 case 本身罕见。
 *
 * 导出供单测断言。
 */
export function isObviousLanguageOp(question: string): boolean {
  const q = question.trim().toLowerCase()
  if (q.length === 0) return false

  // 1. 排除查询型起手（仅检查**句首**，不再无差别 includes 整句）
  //    Why 句首：D-003 baseline 发现 "用白话解释一下知识中台是什么" 含句尾 "是什么"
  //    被旧 includes 模式无差别排除——但"用白话解释一下"是明确的语言层指令。
  //    句首匹配避免这种误排除，仅排除真正的查询型起手（"什么是 X" / "我想了解 X"）。
  const QUERY_STARTERS = [
    '我想', '我要', '我希望', '想了解', '想知道', '想问', '想搞清楚',
    '请问', '什么是', '什么叫', '何为', '怎么理解',
    'i want', 'i would', 'i\'d like', 'tell me what', 'what is',
    'what are', 'how do', 'how does', 'can you tell me',
  ]
  if (QUERY_STARTERS.some((s) => q.startsWith(s))) return false

  // 2. 必须含明显的 meta 动词（不分大小写，中英都覆盖）
  const META_VERBS = [
    '翻译', '解释', '总结', '释义', '改写', '提炼', '白话', '列表化',
    '逐字解读', '逐句', '分点重组',
    'translate', 'summariz', 'paraphras', 'rewrite', 'restate',
  ]
  if (!META_VERBS.some((m) => q.includes(m))) return false

  // 3. 短句兜底（含 meta 又短 → 大概率指令而非查询）
  //    阈值 30：覆盖中文 ≤30 字符 + 英文 ≤30 字符的祈使句
  if (q.length <= 30) return true

  // 4. 长句必须含祈使句动词或指代代词
  const IMPERATIVE_VERBS = [
    '给我', '帮我', '请帮', '请把', '请你', '请', '把', '帮', '做',
    '给', '让', '为我', '替我',
  ]
  const REFERENCES = [
    '上面', '上述', '前面', '这段', '这章', '这份', '这本', '这个',
    '那段', '那章', '那份', '那个', '它', '它们',
    'above', 'previous', 'this ', 'that ', 'these', 'those',
  ]
  if (IMPERATIVE_VERBS.some((v) => q.includes(v))) return true
  if (REFERENCES.some((r) => q.includes(r))) return true
  return false
}

/**
 * D-002.3 env 守卫：multi-tool function call 路径开关。
 *
 * 默认 on（true）。`false / 0 / off / no`（大小写不敏感）→ 走旧 single-tool 路径（回滚）。
 *
 * 改造背景：OAI 兼容服务（含硅基 Qwen2.5-7B）的 function calling 优化重点在"调哪个 tool"
 * （tool selection），对 enum 字段值的稳定性投入相对弱。multi-tool 路径下 5 个独立 tool
 * 对应 5 类意图，让 LLM 在 tool selection 阶段决断 → P(correct) 通常更高。
 *
 * 与 `B_HANDLER_ROUTING_ENABLED` 正交：后者控制是否走档 B 路由（不走则跳过 LLM 直接 factual_lookup）；
 * 本 env 控制档 B 内部用 single-tool 还是 multi-tool。
 */
export function isIntentMultiToolEnabled(): boolean {
  const v = (process.env.INTENT_MULTI_TOOL_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/**
 * D-002.3 multi-tool function call · 5 个独立 tool，对应 5 类意图。
 *
 * 设计要点：
 *   - 共享相同 `reason: string` 单字段（不暴露 intent-specific 字段；任何额外字段都会
 *     让模型注意力分散到字段填写、降低 tool selection 稳定性）
 *   - 动词前缀 `select_*` 在 tool name 里更明确表达"选择某分类"语义
 *   - description ≤ 120 字 + 至少 1 个示例 + 与最易混淆相邻 intent 的边界提示
 */
const INTENT_TOOL_PARAMS: Record<string, unknown> = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: '≤30 字简短原因' },
  },
  required: ['reason'],
}

export const INTENT_TOOLS: readonly OAITool[] = [
  {
    type: 'function',
    function: {
      name: 'select_factual_lookup',
      description: '问"X 是什么/在哪/谁/多少"——在召回文档里找具体事实（数值/规格/定义/位置/时间/人物）。例：「缓冲块设计间隙是多少」「道德经的作者是谁」。注：问"X 的核心模块有哪些"也是 factual_lookup（问对象属性，不是问目录）',
      parameters: INTENT_TOOL_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_language_op',
      description: '指令型，要求**对召回文档原文做语言层转换**（翻译/释义/总结/改写/列表化/白话/提炼）。例：「把上面这段翻译成英文」「给道德经第一章做白话解释」「总结一下这份合同」。区别于 factual_lookup：language_op 是动作动词起手 + meta 词、输出文本转换；factual_lookup 是查询起手、输出事实',
      parameters: INTENT_TOOL_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_multi_doc_compare',
      description: '对比/罗列**多个**对象、概念、文档之间的差异或分别情况。含「和/与/区别/分别/对比」等比较型信号，且语义上确实在比较多个东西。例：「CORS 和 CSRF 的区别」「分别说明 A B C 三种方案」「列出所有 ≥5mm 的件」',
      parameters: INTENT_TOOL_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_kb_meta',
      description: '问知识库**目录**——库里有什么资料 / 找某类文档（不是问内容；产出资产名清单）。例：「我这库里有道德经吗」「列出所有 PDF」「找一下汽车制造的文档」「有没有讲 X 的资料」。区别于 factual_lookup："X 的核心模块有哪些" 是 factual_lookup（问 X 这个对象的属性）；"库里有哪些 X 文档"才是 kb_meta',
      parameters: INTENT_TOOL_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_out_of_scope',
      description: '问文档**外**的背景/原因/朝代/作者意图/历史源流——文档里通常找不到的信息。例：「为什么 GM 要写这份文档」「老子是哪个朝代的人」「道德经诞生的历史背景」「为什么这个公差是 0.3mm」。判定窍门：问"为什么 X 这么 Y"=out_of_scope；问"X 的 Y 是什么"=factual_lookup',
      parameters: INTENT_TOOL_PARAMS,
    },
  },
]

export const TOOL_NAME_TO_INTENT: Readonly<Record<string, AnswerIntent>> = {
  select_factual_lookup: 'factual_lookup',
  select_language_op: 'language_op',
  select_multi_doc_compare: 'multi_doc_compare',
  select_kb_meta: 'kb_meta',
  select_out_of_scope: 'out_of_scope',
}

/**
 * 旧 single-tool 路径（D-002.3 改造前）。env `INTENT_MULTI_TOOL_ENABLED=false` 时使用。
 * 完整保留作回滚路径，待 D-003 baseline 8 + N 周生产观测稳定后另开 change 物理删除。
 */
const CLASSIFY_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'classify_answer_intent',
    description: 'Classify the user question into one of 5 answer intents based on the question and retrieved document previews',
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: [...ANSWER_INTENTS],
          description: 'One of: factual_lookup, language_op, multi_doc_compare, kb_meta, out_of_scope',
        },
        reason: {
          type: 'string',
          description: 'Brief reason (≤ 30 chars), e.g. "asks for translation of retrieved text"',
        },
      },
      required: ['intent', 'reason'],
    },
  },
}

function buildClassifyPrompt(question: string, docs: AssetChunk[]): string {
  const previews = docs.slice(0, DOC_PREVIEW_COUNT).map((d, i) => {
    const text = String(d.chunk_content ?? '').replace(/\s+/g, ' ').slice(0, DOC_PREVIEW_CHARS)
    return `[${i + 1}] ${d.asset_name}: ${text}`
  }).join('\n')

  return `把用户问题分类到 5 个答案生成意图之一。考虑用户问什么 + 召回文档里有什么。

【意图定义】
- factual_lookup: 用户在文档里**找事实**（数值/规格/定义/位置/时间/人物等具体信息）。语气是"是什么/在哪/谁"等查询型
- language_op: 用户要求**对召回的文档原文做语言层转换**（翻译/释义/白话/总结/改写/列表化/提炼）。语气是"给我X/帮我X/做X/把X翻译/总结一下"等指令型；产出是基于原文的转换结果，不是查找事实
- multi_doc_compare: 用户要求对比/罗列多个对象、概念、文档（含"和"/"与"/"区别"/"分别"/"对比"等信号词，且语义上确实在比较多个东西）
- kb_meta: 用户问知识库里**有什么资料、目录、列表**（不是问内容；是问目录）
- out_of_scope: 用户问的是文档外的背景、历史、原因、评价、作者意图、推断

【关键判定规则】
1. 看用户**语气是查询还是指令**：
   - "X 是什么 / X 在哪 / X 是谁" → factual_lookup
   - "给我X / 给X的Y / 帮我X / 做X / 把X翻译 / 把X总结 / 解释一下 / 翻译一下 / 总结一下" → language_op
2. 当看到"动作动词（给/做/帮/请/把）+ meta 词（解释/翻译/释义/总结/白话/提炼/列表化/改写）"组合时，**强烈优先 language_op**，即便表面像在"找解释/找翻译"
3. **指代代词（它/这/那/上面/这段/他的/这个）+ meta 词** = 几乎一定是 language_op（指代召回原文 + 要求做转换）
4. 当 question 跟召回文档主题相关，但 question 中没有明确事实查询词，看动作动词决定

【边界例子】
- "道德经第一章原文" → factual_lookup（"原文"作名词，找具体内容）
- "给上面这段做白话解释" → language_op（"给+做"指令 + meta 词"白话解释"）
- "给他的原文的解释" → language_op（指代"他的原文" + 指令"给...的解释"）
- "把这份合同翻译成英文" → language_op
- "翻译一下这段" / "解释一下" / "总结一下这章" / "白话解释下" → language_op
- "提炼一下这份文档的关键点" / "改写成步骤列表" → language_op
- "缓冲块设计间隙是多少" → factual_lookup（具体数值查询）
- "道德经的作者是谁" → factual_lookup（人物查询）
- "X 和 Y 的区别" / "分别说明" → multi_doc_compare

【kb_meta vs factual_lookup 关键区分】
**kb_meta**：问知识库**目录**，"我这库里有 X 吗"/"找一下 X 类文档"/"列出所有 PDF"。
   产出是**资产名清单**，不进文档内容。
**factual_lookup**：问"X **的** Y" / "X 是谁/什么/在哪"。即便含"有哪些"也是问对象的属性，
   不是问目录。产出是文档**内容**。
- "我这库里有道德经吗" → kb_meta（问目录）
- "库里有哪些汽车制造的文档" → kb_meta
- "知识中台**的核心模块有哪些**" → factual_lookup（问"中台"这个具体对象的模块清单，是内容）
- "道德经**的作者**是谁" → factual_lookup
- "**有没有**讲道德经的资料" → kb_meta（问目录）

【out_of_scope vs factual_lookup 关键区分】
**out_of_scope**：问文档**外**的背景/原因/朝代/作者意图/历史源流。
**factual_lookup**：问文档**里能找到**的事实。
- "为什么 GM 要写这份文档" → out_of_scope（问作者写作意图，文档不会有）
- "为什么作者这么主张" → out_of_scope（问作者意图）
- "老子是哪个朝代的人" → out_of_scope（问朝代背景；除非文档明确含序言写朝代）
- "道德经诞生的历史背景" → out_of_scope（问历史源流）
- "道德经的作者是谁" → factual_lookup（"作者"是文档元数据/原文常见信息）
- "缓冲块的设计参数" → factual_lookup（文档明确事实）

判定窍门：**问 "为什么 X 这么 Y"**（追问原因/意图）= out_of_scope；
        **问 "X 是 Y 吗 / X 的 Y 是什么"**（追问对象属性）= factual_lookup。

【用户问题】
${question}

【召回文档预览（前 ${DOC_PREVIEW_COUNT} 段，每段 ≤ ${DOC_PREVIEW_CHARS} 字）】
${previews || '(无召回)'}

调用 classify_answer_intent 工具返回结构化结果。reason 字段简短说明你为什么分到这个意图（≤ 30 字）。`
}

/**
 * D-002.3 multi-tool 路径下的瘦身 prompt。判定准则下沉到每个 tool 的 description，
 * 这里只保留"用户问题 + 召回 preview + 一句调用指引"，不重复 5 类 intent 规则。
 */
function buildClassifyPromptMultiTool(question: string, docs: AssetChunk[]): string {
  const previews = docs.slice(0, DOC_PREVIEW_COUNT).map((d, i) => {
    const text = String(d.chunk_content ?? '').replace(/\s+/g, ' ').slice(0, DOC_PREVIEW_CHARS)
    return `[${i + 1}] ${d.asset_name}: ${text}`
  }).join('\n')

  return `根据用户问题与召回文档预览，调用 5 个 select_* 工具中最匹配的一个。reason 字段填一句简短原因（≤30 字）。

【用户问题】
${question}

【召回文档预览（前 ${DOC_PREVIEW_COUNT} 段，每段 ≤ ${DOC_PREVIEW_CHARS} 字）】
${previews || '(无召回)'}`
}

export interface IntentClassification {
  intent: AnswerIntent
  reason: string
  /** 是否走了 fallback（LLM 异常 / 解析失败 / 未配置） */
  fallback: boolean
}

/**
 * 把用户问题 + 召回 docs 分类到 5 类意图之一。
 *
 * 控制流：
 *   1. env `B_HANDLER_ROUTING_ENABLED=false` → factual_lookup + fallback
 *   2. LLM 未配置 → factual_lookup + fallback
 *   3. 空问题 → factual_lookup + fallback
 *   4. isObviousLanguageOp 命中 → language_op + 不调 LLM
 *   5. env `INTENT_MULTI_TOOL_ENABLED=true`（默认）→ multi-tool 路径
 *   6. 否则 → 旧 single-tool 路径（回滚用）
 *
 * 共同保证：1.5s 硬超时；任何异常都返回 factual_lookup + fallback=true，不阻塞主流程。
 */
export async function classifyAnswerIntent(
  question: string,
  docs: AssetChunk[],
): Promise<IntentClassification> {
  if (!isHandlerRoutingEnabled()) {
    return { intent: DEFAULT_INTENT, reason: 'B_HANDLER_ROUTING_ENABLED=false', fallback: true }
  }
  if (!isLlmConfigured()) {
    return { intent: DEFAULT_INTENT, reason: 'llm not configured', fallback: true }
  }
  if (!question || question.trim().length === 0) {
    return { intent: DEFAULT_INTENT, reason: 'empty question', fallback: true }
  }

  // V3B 修复 · 规则前置：含 meta 动词 + 祈使/指代 → 直接 language_op，绕过 LLM 概率
  if (isObviousLanguageOp(question)) {
    return { intent: 'language_op', reason: 'rule:meta+imperative', fallback: false }
  }

  // D-002.3 路径分流
  if (isIntentMultiToolEnabled()) {
    return classifyAnswerIntentMultiTool(question, docs)
  }
  return classifyAnswerIntentLegacy(question, docs)
}

/**
 * D-002.3 multi-tool 路径：5 个独立 tool + tool_choice='required'，从 `toolCalls[0].function.name`
 * 反查 intent。args 仅作 reason 调试字段——name 决断成功的话即便 args 解析失败也接受 intent。
 *
 * 兜底链：
 *   - toolCalls 为空            → factual_lookup + fallback
 *   - tool name 不在 5 个里      → factual_lookup + fallback，reason 含 'unknown tool'
 *   - 多 tool calls              → 取首个，reason 追加 'multi-tool, took first'
 *   - args 解析失败但 name 合法   → 仍接受 intent（fallback=false），reason='args parse failed'
 */
async function classifyAnswerIntentMultiTool(
  question: string,
  docs: AssetChunk[],
): Promise<IntentClassification> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CLASSIFY_TIMEOUT_MS)
  try {
    const { toolCalls } = await chatComplete(
      [{ role: 'user', content: buildClassifyPromptMultiTool(question, docs) }],
      {
        model: getLlmFastModel(),
        maxTokens: 80,
        temperature: 0.1,
        tools: [...INTENT_TOOLS],
        toolChoice: 'required',
      },
    )
    clearTimeout(t)
    if (!toolCalls || toolCalls.length === 0) {
      return { intent: DEFAULT_INTENT, reason: 'no tool call returned', fallback: true }
    }
    const first = toolCalls[0]
    const toolName = first?.function?.name ?? ''
    const intent = TOOL_NAME_TO_INTENT[toolName]
    if (!intent) {
      return {
        intent: DEFAULT_INTENT,
        reason: `unknown tool: ${toolName.slice(0, 40)}`,
        fallback: true,
      }
    }
    // tool name 决断成功：args 仅为 reason 调试字段，解析失败不降级
    let reason = ''
    let parseFailed = false
    try {
      const parsed = JSON.parse(first.function?.arguments ?? '{}') as { reason?: string }
      if (typeof parsed.reason === 'string') reason = parsed.reason.slice(0, 60)
    } catch {
      parseFailed = true
    }
    if (parseFailed) reason = `${toolName} args parse failed`
    if (toolCalls.length > 1) {
      reason = reason ? `${reason}; multi-tool, took first` : 'multi-tool, took first'
    }
    return { intent, reason, fallback: false }
  } catch (err) {
    clearTimeout(t)
    return {
      intent: DEFAULT_INTENT,
      reason: err instanceof Error ? `classify failed: ${err.message.slice(0, 40)}` : 'classify failed',
      fallback: true,
    }
  }
}

/**
 * 旧 single-tool 路径（D-002.3 改造前）。env `INTENT_MULTI_TOOL_ENABLED=false` 时使用。
 * 行为完全等同 baseline 7。
 */
async function classifyAnswerIntentLegacy(
  question: string,
  docs: AssetChunk[],
): Promise<IntentClassification> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), CLASSIFY_TIMEOUT_MS)
  try {
    const { toolCalls } = await chatComplete(
      [{ role: 'user', content: buildClassifyPrompt(question, docs) }],
      {
        model: getLlmFastModel(),
        maxTokens: 80,
        temperature: 0.1,
        tools: [CLASSIFY_TOOL],
        toolChoice: { type: 'function', function: { name: 'classify_answer_intent' } },
      },
    )
    clearTimeout(t)
    const args = toolCalls[0]?.function?.arguments
    if (!args) {
      return { intent: DEFAULT_INTENT, reason: 'no tool call returned', fallback: true }
    }
    const parsed = JSON.parse(args) as { intent?: string; reason?: string }
    if (!isAnswerIntent(parsed.intent)) {
      return { intent: DEFAULT_INTENT, reason: `invalid intent "${parsed.intent}"`, fallback: true }
    }
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 60) : ''
    return { intent: parsed.intent, reason, fallback: false }
  } catch (err) {
    clearTimeout(t)
    return {
      intent: DEFAULT_INTENT,
      reason: err instanceof Error ? `classify failed: ${err.message.slice(0, 40)}` : 'classify failed',
      fallback: true,
    }
  }
}
