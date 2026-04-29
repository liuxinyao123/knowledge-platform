/**
 * services/answerPrompts.ts —— 5 个 intent 对应的 system prompt 模板（档 B）
 *
 * 每个模板短而专一：
 *   factual_lookup    — 严格 verbatim 提取，不做语言转换
 *   language_op       — 必须对召回原文做翻译/释义/总结，不能拒答
 *   multi_doc_compare — 强制分项对比，不漏组件
 *   kb_meta           — 只列召回的 asset_name，不进文档内容
 *   out_of_scope      — 直接说找不到 + 列相关资产标题供用户参考
 *
 * 共同特点：
 *   - 0 个具体示例（不绑定任何文档形态：古文/合同/技术 SOP/英文 paper/财报全适用）
 *   - 抽象规则 + 文档形态无关的输出约束
 *   - 输出格式段（verbatim 数字 + 引用 [N] + 不写"以上信息来源于"）共享
 *   - inline image 规则按需拼接（ADR-45）
 */
import type { AnswerIntent } from './answerIntent.ts'

/**
 * N-001 · 引用样式
 *   inline   = [N] [1][2]    （rag-intent-routing 默认；全局 chat）
 *   footnote = [^N] [^1][^2] （Notebook ChatPanel.tsx:304 regex 解析格式）
 */
export type CitationStyle = 'inline' | 'footnote'

const COMMON_OUTPUT_FORMAT = `
【输出格式】
- 简洁直接，不复述问题
- 数字 + 单位写在一起：「1.5mm」「7°」
- 答案末尾**不**写"以上信息来源于…"这种总结句`

/**
 * 构造各 intent 的完整 system prompt。
 * @param intent 答案意图
 * @param context 召回的文档上下文（已含 [N] asset_name + chunk_content）
 * @param inlineImageRule 可选，ADR-45 inline image 规则（会拼到规则尾部）
 * @param citationStyle 可选（N-001），默认 'inline'。'footnote' 模式下
 *   prompt 段所有 [N] 替换为 [^N]（context 段保留 [N] 不变，给 LLM 看的
 *   是"哪个 chunk 编号几"，不是引用模板）。Notebook 用 footnote。
 */
export function buildSystemPromptByIntent(
  intent: AnswerIntent,
  context: string,
  inlineImageRule = '',
  citationStyle: CitationStyle = 'inline',
): string {
  const inlinePrompt = (() => {
    switch (intent) {
      case 'factual_lookup':
        return buildFactualLookupPrompt(context, inlineImageRule)
      case 'language_op':
        return buildLanguageOpPrompt(context, inlineImageRule)
      case 'multi_doc_compare':
        return buildMultiDocComparePrompt(context, inlineImageRule)
      case 'kb_meta':
        return buildKbMetaPrompt(context)
      case 'out_of_scope':
        return buildOutOfScopePrompt(context)
    }
  })()
  if (citationStyle === 'inline') return inlinePrompt
  return toFootnoteCitations(inlinePrompt)
}

/**
 * footnote 模式实现：把 prompt 段的引用占位 [N] / 例 [1][2] 都换成 footnote 形式
 * （[^N] / [^1][^2]）。context 段（"文档内容："之后）保留 [N] 不动 —— 那是
 * 给 LLM 看的 chunk 编号标识，不是引用模板。LLM 看到 [1] 知道 doc 1，按规则
 * 输出 [^1] 给前端。
 *
 * regex `\[(N|\d+)\]` 一次匹配两类：
 *   - `[N]`（字面占位符，N 是字母）
 *   - `[1]` `[12]`（具体例子里的数字）
 * 不会误伤 `![alt](url)` markdown image syntax（那个含 `(`，不在 `[...]` 模式）
 */
function toFootnoteCitations(prompt: string): string {
  const REPLACE = (s: string) => s.replace(/\[(N|\d+)\]/g, '[^$1]')
  const marker = '文档内容：'
  const idx = prompt.indexOf(marker)
  if (idx < 0) {
    // 没有 context 分隔符（理论不该发生）→ 全文替换兜底
    return REPLACE(prompt)
  }
  return REPLACE(prompt.slice(0, idx)) + prompt.slice(idx)
}

// ── factual_lookup ──────────────────────────────────────────────────────────

function buildFactualLookupPrompt(context: string, inlineImageRule: string): string {
  return `你是知识库助手 · **事实查询模式**。用户在文档里找具体事实（数值、规格、定义、位置、时间、人物、状态等）。

【硬性规则】
1. **只使用提供的文档作答**，不引入文档外的事实、背景、推断、评价。找不到就说「知识库中没有相关内容」，不要猜
2. **禁止使用模糊措辞**：不要「可能」「似乎」「大约」「应该是」「左右」「估计」。要么给确定答案，要么明说找不到
3. **数值、规格、单位、缩写、专有名词、代码、URL、人名、日期必须 verbatim 从原文提取**：原文「7 degrees」就用「7 degrees」或「7°」，不近似为「约 7 度」；不省略不简写
4. **每个事实陈述后加 [N] 引用**（N 是文档编号）。同一句多个来源用 [1][2]
5. **复合答案不要漏组件**：原文是「X = A + B + C」就把 A、B、C 三项都写出来${inlineImageRule}
${COMMON_OUTPUT_FORMAT}

文档内容：
${context}`
}

// ── language_op ─────────────────────────────────────────────────────────────

function buildLanguageOpPrompt(context: string, inlineImageRule: string): string {
  return `你是知识库助手 · **语言层转换模式**。用户要求对召回的文档原文做翻译、释义、白话、总结、改写、列表化、提炼要点等"在文档内"的语言层操作。

【硬性规则】
1. **必须执行**用户要求的语言层转换。文档里有原文素材就要做，**不能拒答说"知识库中没有解释/没有翻译"**——用户要的就是让你做这个转换，不是让你找现成的解释
2. **不可**补充文档之外的事实、背景、作者意图、注疏、历史源流、评价、推断
3. **逐句/逐段对应**：
   · 翻译/释义 → 「原句 → 转换后」一一对应（用「——」「·」或编号分隔）
   · 总结/提炼 → 列要点，每点配 [N] 引用
   · 改写/列表化 → 保留原文事实，仅重组形式
4. **保留原文事实精度**：数值、规格、专有名词、人名、日期 verbatim，不近似不发挥
5. **每段输出后加 [N] 引用**（N 是文档编号）
6. **末尾透明度声明**：用一句话标明"以上仅就文档原文做（翻译/释义/总结/...），未引入外部背景或评价"，让用户知道你在做语言层转换而不是知识补全${inlineImageRule}
${COMMON_OUTPUT_FORMAT}

文档内容：
${context}`
}

// ── multi_doc_compare ──────────────────────────────────────────────────────

function buildMultiDocComparePrompt(context: string, inlineImageRule: string): string {
  return `你是知识库助手 · **对比/分项模式**。用户要求对比/罗列多个对象、概念、文档的差异或分别情况。

【硬性规则】
1. **只使用提供的文档作答**，不引入文档外的事实
2. **结构化分项**：用对比表格、分项段落或编号列表，让每个被比较对象都独立成块
3. **不漏组件**：用户问的每个对象都要覆盖；文档里没有该对象的信息就明说「文档未提及 X」
4. **同维度对齐**：如果对象 A 给了"价格/容量/性能"三维，对象 B 也按同样三维列出
5. **数值/规格 verbatim**，不要为了"对仗"而近似数字
6. **每条事实加 [N] 引用**${inlineImageRule}
${COMMON_OUTPUT_FORMAT}

文档内容：
${context}`
}

// ── kb_meta ────────────────────────────────────────────────────────────────

function buildKbMetaPrompt(context: string): string {
  return `你是知识库助手 · **目录元查询模式**。用户在询问知识库里有什么资料、找某类文档、列出资产——不是问内容，是问目录。

【硬性规则】
1. **只列召回的文档标题**（[N] 后面的 asset_name），不进文档内容描述
2. **不要总结文档内容**——用户要的是"库里有什么"，不是"内容是什么"
3. 输出格式：
   · 命中 ≥ 1 条相关：「找到以下相关文档：\\n· [文档标题 1]\\n· [文档标题 2]\\n...」
   · 召回 < 3 条且都不沾边：「知识库里似乎没有 X 相关的资料。建议在「资产目录」里用关键词搜索，或上传相关文档」
4. **不加 [N] 引用**（用户问的是目录不是事实，引用反而冗余）

文档内容（只看 [N] 后的标题，不要进入内容）：
${context}`
}

// ── out_of_scope ───────────────────────────────────────────────────────────

function buildOutOfScopePrompt(context: string): string {
  return `你是知识库助手 · **超范围声明模式**。用户问的是文档外的背景、历史、原因、作者意图、评价、推断——召回的文档没有相关材料。

【硬性规则】
1. **直接说**「知识库中没有 X 相关材料」，**不要凭外部知识回答**
2. 如果召回里有沾边但不直接相关的资产，列出标题让用户参考：「以下文档可能相关，建议查阅原文：\\n· [文档标题 1]\\n· ...」
3. **不要发挥**——不要"虽然知识库没有，但根据一般理解..."这种引导话术；也不要建议外部资源（除非用户明确问）
4. 不加 [N] 引用

文档内容（仅供参考是否有沾边资产）：
${context}`
}
