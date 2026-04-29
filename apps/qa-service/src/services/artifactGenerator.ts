/**
 * services/artifactGenerator.ts —— Notebook Studio 衍生品生成（N-002 重构版）
 *
 * V1 仅支持 briefing + faq；N-002 扩到 8 类（注册表机制）：
 *   - briefing  结构化简报（4 段式）
 *   - faq       8-12 条 Q&A
 *   - mindmap   思维导图（markdown 嵌套列表）
 *   - outline   一二三级标题大纲
 *   - timeline  时间序列（表格或列表）
 *   - comparison_matrix  多对象 × 多维度对比表
 *   - glossary  术语 + 定义列表
 *   - slides    演示稿大纲（含 speaker notes）
 *
 * 调用 LLM 一次生成（非流式）；status: pending → running → done/failed。
 * 引用样式统一 [^N]（兼容 Notebook ChatPanel + StudioPanel 渲染）。
 *
 * N-005 候选预留：ArtifactSpec.intent 字段，未来切换到档 B 5 类意图模板时使用。
 */
import { getPgPool } from './pgDb.ts'
import { chatComplete } from './llm.ts'
import { searchKnowledgeChunks } from './knowledgeSearch.ts'
import type { AnswerIntent } from './answerIntent.ts'
import { buildSystemPromptByIntent } from './answerPrompts.ts'

/**
 * N-005 · env 开关：是否让 artifact 走档 B 意图分流（buildSystemPromptByIntent）。
 * 默认 on；off 时 spec.intent 视为缺省，回退 N-002 老路径（用 spec.promptTemplate）。
 */
export function isArtifactIntentRoutingEnabled(): boolean {
  const v = (process.env.B_ARTIFACT_INTENT_ROUTING_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

// ── 类型 ─────────────────────────────────────────────────────────────────────

export type ArtifactKind =
  | 'briefing' | 'faq'                                          // V1
  | 'mindmap' | 'outline' | 'timeline'                          // N-002 新增
  | 'comparison_matrix' | 'glossary' | 'slides'                 // N-002 新增

export interface ArtifactSpec {
  id: ArtifactKind
  label: string                                  // 中文展示名（前后端共用）
  icon: string                                   // emoji
  desc: string                                   // 用户看的简介
  promptTemplate: string                         // system prompt（可含 {标题} 占位）
  maxTokens: number                              // chatComplete maxTokens
  temperature?: number                           // chatComplete temperature；缺省默认
  intent?: AnswerIntent                          // N-005 候选；本 change 不消费
  contextStrategy?: 'default' | 'extended'       // 默认 'default'；extended 多 chunks
}

interface SourceContent {
  asset_id: number
  asset_name: string
  text: string
}

// ── prompt 模板 ──────────────────────────────────────────────────────────────
// 共同约束：[^N] 引用样式 / 不引入外部知识 / 不绑定具体文档形态

const PROMPT_BRIEFING = `基于以下文档生成一份结构化简报。

格式（markdown）：
# {标题}
## 一、核心论点
（每个文档 1-2 句话提炼）
## 二、共识与分歧
（不同文档间的对比）
## 三、关键数据 / 指标
（具体数字、阈值、参数）
## 四、行动建议
（基于内容能给出的下一步）

要求：
- 严格基于文档内容，不引入外部知识
- 每个论点末尾标 [^N] 引用文档编号
- 篇幅 800-1500 字
- 中文输出（除非文档全是英文）`

const PROMPT_FAQ = `基于以下文档生成 8-12 条最有价值的 FAQ。

格式（markdown）：
## Q1：{问题}
**A**：{答案}。[^N]

## Q2：...

要求：
- 问题要是真实业务方可能问的（避免"该文档讲了什么"这种空洞题）
- 答案 < 100 字，必须带 [^N] 引用
- 覆盖文档的不同方面，不要全集中在一处
- 中文输出（除非文档全是英文）`

const PROMPT_MINDMAP = `基于以下文档生成思维导图（markdown 嵌套列表形式）。

格式：
- **{中心主题}**
  - 子主题 1 [^N]
    - 叶节点 1.1 [^N]
    - 叶节点 1.2 [^N]
  - 子主题 2 [^N]
    - ...

要求：
- 3-4 层嵌套，不超过 5 层
- 中心主题加粗（**...**），子主题简洁（≤ 15 字）
- 每个非中心节点末尾标 [^N] 引用
- 严格基于文档内容，不引入外部知识
- 节点之间保持平行性（同级粒度相近）
- 中文输出（除非文档全是英文）`

const PROMPT_OUTLINE = `基于以下文档生成一份一二三级标题的结构化大纲。

格式（markdown）：
# {标题}

## 1. 第一节标题
（1-2 行说明本节内容 [^N]）

### 1.1 子标题
（1-2 行说明 [^N]）

### 1.2 子标题
...

## 2. 第二节标题
...

要求：
- 仅 markdown 标题（# / ## / ###），最多 3 级
- 每个标题下 1-2 行简介（带 [^N] 引用），不要长段
- 整体结构反映文档的逻辑层次
- 严格基于文档内容
- 中文输出（除非文档全是英文）`

const PROMPT_TIMELINE = `基于以下文档生成时间序列摘要（按时间顺序排列）。

格式（markdown 表格）：
| 时间 | 事件 / 节点 | 说明 | 来源 |
|------|------------|------|------|
| 2020-01 | ... | ... | [^1] |
| 2021 Q3 | ... | ... | [^2] |

要求：
- 严格按时间升序排列
- 时间精度按文档原文（年 / 季度 / 月 / 日，不要补全）
- 事件简洁（≤ 30 字）
- 每行"来源"列必须填 [^N] 引用文档编号
- **如果文档没有明确时间数据**：输出 "文档未提供可识别的时间序列信息" 并停止
- 严格基于文档内容
- 中文输出（除非文档全是英文）`

const PROMPT_COMPARISON_MATRIX = `基于以下文档生成多对象对比矩阵（markdown 表格）。

格式：
|  | 维度 A | 维度 B | 维度 C | ... |
|---|--------|--------|--------|-----|
| **对象 1** | 数据 [^N] | 数据 [^N] | 数据 [^N] | |
| **对象 2** | 数据 [^N] | 数据 [^N] | 数据 [^N] | |

要求：
- 第一列加粗的是被比较对象（≥ 2 个）
- 维度（列）来自文档内容（如规格 / 性能 / 价格 / 适用场景等）
- 数据 verbatim 提取，每格 ≤ 20 字
- 文档没有的格填 "—"，**不要**编造
- 末尾给一段 1-2 行总结："**结论**：..." [^N]
- 如果只能找到 1 个对象，输出 "文档只涉及单一对象，无法生成对比矩阵"
- 中文输出（除非文档全是英文）`

const PROMPT_GLOSSARY = `基于以下文档生成术语表。

格式（markdown 列表）：
- **术语 1**：定义（≤ 50 字）。[^N]
- **术语 2**：定义。[^N]
- **术语 3**：定义。[^N]

要求：
- 术语按字母序 / 拼音序排列
- 每条定义 verbatim 引自文档（不要凭外部知识发挥）
- 文档只用了缩写但没解释的词，定义写 "文档未给出明确定义" + [^N]
- 涵盖文档涉及的核心概念、专有名词、缩写、术语（10-30 条）
- 中文输出（除非文档全是英文）`

const PROMPT_SLIDES = `基于以下文档生成演示稿大纲（8-15 张幻灯片）。

格式（markdown）：
## Slide 1: 标题页
- {演示主题} [^N]
- {副标题或核心信息}
**Notes**: 介绍演示主题与目标听众。

## Slide 2: {章节标题}
- 要点 1 [^N]
- 要点 2 [^N]
- 要点 3 [^N]
**Notes**: 演讲者备注 1-2 句，引导讲解。

...

## Slide N: 总结
- 关键要点回顾 [^N]
- 行动建议 [^N]
**Notes**: 收尾。

要求：
- 8-15 张幻灯片
- 每张 3-5 个要点（≤ 15 字 / 点）
- 每要点带 [^N] 引用
- **Notes** 行 1-2 句演讲者备注
- 严格基于文档内容
- 中文输出（除非文档全是英文）`

// ── 注册表 ───────────────────────────────────────────────────────────────────

export const ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec> = {
  briefing: {
    id: 'briefing',
    label: '简报',
    icon: '📋',
    desc: '一份结构化总结：核心论点 / 共识分歧 / 关键数据 / 行动建议',
    promptTemplate: PROMPT_BRIEFING,
    maxTokens: 3000,
    intent: 'language_op',  // N-005：4 段式总结是语言层提炼
  },
  faq: {
    id: 'faq',
    label: 'FAQ',
    icon: '❓',
    desc: '8-12 条最值得关注的 Q&A，覆盖资料的不同方面',
    promptTemplate: PROMPT_FAQ,
    maxTokens: 3000,
    intent: 'language_op',  // N-005：基于原文重组成 Q&A，是改写
  },
  mindmap: {
    id: 'mindmap',
    label: '思维导图',
    icon: '🧠',
    desc: '层级化梳理：中心主题 → 子主题 → 叶节点（markdown 嵌套列表）',
    promptTemplate: PROMPT_MINDMAP,
    maxTokens: 2000,
    intent: 'language_op',  // N-005：层级化重组
  },
  outline: {
    id: 'outline',
    label: '大纲',
    icon: '📑',
    desc: '一二三级标题的结构化大纲，每节 1-2 行说明',
    promptTemplate: PROMPT_OUTLINE,
    maxTokens: 2500,
    intent: 'language_op',  // N-005：提取标题层次 + 简介
  },
  timeline: {
    id: 'timeline',
    label: '时间线',
    icon: '⏱️',
    desc: '按时间顺序排列的事件序列（markdown 表格）',
    promptTemplate: PROMPT_TIMELINE,
    maxTokens: 2500,
    intent: 'language_op',  // N-005：时间序列重组
  },
  comparison_matrix: {
    id: 'comparison_matrix',
    label: '对比矩阵',
    icon: '📊',
    desc: '多对象 × 多维度对比表（markdown 表格）',
    promptTemplate: PROMPT_COMPARISON_MATRIX,
    maxTokens: 2500,
    intent: 'multi_doc_compare',  // N-005：字面对应多对象对比
  },
  glossary: {
    id: 'glossary',
    label: '术语表',
    icon: '📖',
    desc: '文档涉及的术语 + 定义列表，按字母 / 拼音序',
    promptTemplate: PROMPT_GLOSSARY,
    maxTokens: 2500,
    intent: 'factual_lookup',  // N-005：术语 verbatim 提取定义不发挥
  },
  slides: {
    id: 'slides',
    label: '演示稿大纲',
    icon: '🎞️',
    desc: '8-15 张幻灯片大纲（含 speaker notes）',
    promptTemplate: PROMPT_SLIDES,
    maxTokens: 3500,
    contextStrategy: 'extended',
    intent: 'language_op',  // N-005：演示稿是总结 + 重组
  },
}

export const ALL_ARTIFACT_KINDS: readonly ArtifactKind[] =
  Object.keys(ARTIFACT_REGISTRY) as ArtifactKind[]

export function isArtifactKind(s: unknown): s is ArtifactKind {
  return typeof s === 'string' && (ALL_ARTIFACT_KINDS as readonly string[]).includes(s)
}

export function getArtifactSpec(kind: ArtifactKind): ArtifactSpec {
  return ARTIFACT_REGISTRY[kind]
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 入口：异步生成；调用方负责 INSERT row + setImmediate(fire)
 */
export async function executeArtifact(artifactId: number, kind: ArtifactKind): Promise<void> {
  const pool = getPgPool()
  if (!isArtifactKind(kind)) {
    // 防御：理论上路由层已挡，这里再保一道
    await pool.query(
      `UPDATE notebook_artifact SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
      [artifactId, `unknown artifact kind: ${kind}`],
    )
    return
  }
  const spec = getArtifactSpec(kind)
  await pool.query(
    `UPDATE notebook_artifact SET status = 'running' WHERE id = $1`,
    [artifactId],
  )

  try {
    // 1) 拿到归属 notebook + sources
    const { rows: rArt } = await pool.query(
      `SELECT notebook_id FROM notebook_artifact WHERE id = $1`,
      [artifactId],
    )
    if (!rArt[0]) throw new Error('artifact row missing')
    const notebookId = Number(rArt[0].notebook_id)

    const { rows: nbRow } = await pool.query(
      `SELECT name FROM notebook WHERE id = $1`,
      [notebookId],
    )
    const notebookName = String(nbRow[0]?.name ?? '未命名 Notebook')

    const { rows: srcRows } = await pool.query(
      `SELECT ns.asset_id, ma.name AS asset_name
       FROM notebook_source ns
       JOIN metadata_asset ma ON ma.id = ns.asset_id
       WHERE ns.notebook_id = $1
       ORDER BY ns.asset_id`,
      [notebookId],
    )
    if (srcRows.length === 0) throw new Error('notebook 无任何 source')

    // 2) 收集每个 source 的代表性内容（按 spec.contextStrategy 决定容量）
    const sources: SourceContent[] = []
    for (const r of srcRows) {
      const aid = Number(r.asset_id)
      const name = String(r.asset_name)
      const text = await collectAssetContent(aid, spec.contextStrategy ?? 'default')
      if (text.trim()) sources.push({ asset_id: aid, asset_name: name, text })
    }
    if (sources.length === 0) throw new Error('所有 source 都没有可用 chunk')

    // 3) 拼 prompt（N-005 双路径）
    const promptHead = spec.promptTemplate.replace('{标题}', notebookName)
    const ctx = sources
      .map((s, i) => `[${i + 1}] ${s.asset_name}\n${s.text}`)
      .join('\n\n---\n\n')

    const useIntentRouting = isArtifactIntentRoutingEnabled() && !!spec.intent
    let systemPrompt: string
    let userMessage: string
    if (useIntentRouting && spec.intent) {
      // N-005：走档 B 5 类模板（通用规则 + footnote），artifact 格式描述塞 user message
      systemPrompt = buildSystemPromptByIntent(spec.intent, ctx, '', 'footnote')
      userMessage = `请基于上面的文档生成「${spec.label}」，按以下格式：\n\n${promptHead}`
    } else {
      // 兜底（N-002 行为 / env off）：spec.promptTemplate 当 system；user 消息固定
      systemPrompt = `${promptHead}\n\n# 文档：\n${ctx}`
      userMessage = `请生成${spec.label}。`
    }

    const result = await chatComplete(
      [{ role: 'user', content: userMessage }],
      {
        system: systemPrompt,
        maxTokens: spec.maxTokens,
        ...(spec.temperature !== undefined && { temperature: spec.temperature }),
      },
    )
    const content = (result.content ?? '').trim()
    if (!content) throw new Error('LLM 返空')

    // 4) 写完成
    await pool.query(
      `UPDATE notebook_artifact
       SET status = 'done', content = $2, meta = $3::jsonb, finished_at = NOW()
       WHERE id = $1`,
      [
        artifactId,
        content,
        JSON.stringify({
          sources_snapshot: sources.map((s) => ({ asset_id: s.asset_id, asset_name: s.asset_name })),
          source_count: sources.length,
          kind,
          intent_used: useIntentRouting ? spec.intent : null,  // N-005：可见路径选择
        }),
      ],
    )
  } catch (err) {
    await pool.query(
      `UPDATE notebook_artifact
       SET status = 'failed', error = $2, finished_at = NOW()
       WHERE id = $1`,
      [artifactId, err instanceof Error ? err.message : 'unknown'],
    )
  }
}

/**
 * 抽取一个 asset 的代表性内容：headings 全部 + samples 前 N
 * 'default'  : 8 samples / ≤ 4000 字符（briefing/faq 等中等容量 artifact）
 * 'extended' : 16 samples / ≤ 6000 字符（slides 等需要更多 context 的 artifact）
 */
async function collectAssetContent(
  assetId: number,
  strategy: 'default' | 'extended',
): Promise<string> {
  const sampleLimit = strategy === 'extended' ? 16 : 8
  const charCap = strategy === 'extended' ? 6000 : 4000
  const pool = getPgPool()
  const { rows: headings } = await pool.query(
    `SELECT content FROM metadata_field
     WHERE asset_id = $1 AND chunk_level = 1
     ORDER BY chunk_index LIMIT 30`,
    [assetId],
  )
  const { rows: samples } = await pool.query(
    `SELECT content FROM metadata_field
     WHERE asset_id = $1 AND chunk_level = 3
     ORDER BY chunk_index LIMIT $2`,
    [assetId, sampleLimit],
  )
  const parts = [
    ...headings.map((r) => `## ${String(r.content).trim()}`),
    ...samples.map((r) => String(r.content).trim()),
  ]
  let acc = ''
  for (const p of parts) {
    if (acc.length + p.length + 2 > charCap) break
    acc += (acc ? '\n\n' : '') + p
  }
  return acc
}

// silence unused warning for searchKnowledgeChunks (保留 import 供未来基于 query 的衍生品)
void searchKnowledgeChunks
