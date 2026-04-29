/**
 * services/kbMetaHandler.ts —— D-002.2 RAG kb_meta 路由 asset_catalog
 *
 * 当用户问的是「目录元查询」（"我这库里有 X 吗"/"列出 X 文档"/"有哪些 X 资料"），
 * 不应该走 retrieval/rerank/generateAnswer：
 *   - 如果 retrieval 凉（V3D），top-1 rerank < 0.05 → short-circuit 兜底，永远到不了 kb_meta
 *   - 如果 retrieval 命中（kbmeta-test 命中道德经注释），档 B 误判 factual_lookup
 *
 * 本模块绕过 retrieval，直查 metadata_asset 表 + 可选 LLM 语义筛 + 列表渲染。
 *
 * 两个接入点（在 ragPipeline.ts）：
 *   1) runRagPipeline 入口：isObviousKbMeta(q) → 直接 runKbMetaHandler 短路 + return
 *   2) generateAnswer 内：classifyAnswerIntent 返回 kb_meta → runKbMetaHandler 替代 LLM 流
 *
 * env KB_META_HANDLER_ENABLED（默认 true）；false 时回到老路径（buildKbMetaPrompt + LLM）。
 *
 * spec：openspec/changes/rag-kb-meta-routing/specs/kb-meta-handler-spec.md
 */

import type { EmitFn } from '../ragTypes.ts'
import { getPgPool } from './pgDb.ts'
import { chatComplete, getLlmFastModel, isLlmConfigured } from './llm.ts'

// ── env 守卫 ─────────────────────────────────────────────────────────────────

export function isKbMetaHandlerEnabled(): boolean {
  const v = (process.env.KB_META_HANDLER_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

// ── 1. isObviousKbMeta · 顶层规则前置 ───────────────────────────────────────
//
// 设计原则：bias to false。宁可漏判（档 B 兜底），也不要抢正常 RAG 问题
//          （"知识中台的核心模块有哪些"/"道德经的作者是谁"）。
// 实现：双锚定正则——目录前缀（库/库里/有哪些 X 文档）+ 文档名词必须同时出现。

const KB_META_PATTERNS: RegExp[] = [
  // 中文 · 直接问目录："库里有 X 吗" / "知识库中包不包含 X"
  /(知识)?库(里|中)?(有|是否|包含|包不包含|有没有)[^。？?]{1,30}(吗|？|\?|$)/,
  // 中文 · "我这/你这 + 库/空间 + 有 X" 句式
  /(我这|你这|当前|这个)?\s*(知识)?(库|空间|项目)(里|中)?(有|是否|包含|有没有)/,
  // 中文 · 列出/查找/有哪些类（必须接文档名词）
  /^(列出|找一下|找出|查一下|搜一下|有哪些|看一下).{0,30}(文档|资料|文件|材料|资产|pdf|xlsx|md|pptx|docx)/i,
  /(有哪些|有没有).{0,15}(相关的)?(文档|资料|文件|材料)/,
  // 英文
  /^\s*(list|find|search|show me|enumerate)\b.{0,40}(documents?|files?|assets?|materials?)/i,
  /\b(do you have|is there|are there|got any)\b.{0,40}(documents?|files?|materials?)\b.{0,30}(on|about|for|related)/i,
]

export function isObviousKbMeta(question: string): boolean {
  if (!question) return false
  const q = question.trim()
  if (q.length === 0 || q.length > 200) return false  // 过长一般是粘贴/正文

  // 排除明显的"问对象属性"：句中出现"X 的 Y" + Y 是名词性
  // 例："知识中台的核心模块有哪些" → false（虽含"有哪些"，但是问"中台的模块"属性）
  // 例："道德经的作者是谁" → false（"X 的作者"是属性查询）
  if (/.{1,15}的(作者|核心|模块|模块|内容|要点|参数|定义|含义|意思|区别|目的|意图|原因)/.test(q)) return false

  return KB_META_PATTERNS.some((re) => re.test(q))
}

// ── 2. extractKbMetaKeywords · 抽 SQL LIKE 关键词 ──────────────────────────

// 顺序敏感：长串放前面，避免短前缀先吃掉
const STOP_PREFIXES = [
  '知识库里有', '知识库中有', '我这库里有', '我这库中有', '你这库里有', '当前库里有',
  '库里有没有', '库中有没有',
  '库里有', '库中有', '库里包不包含', '库中包不包含', '库里包含', '库中包含',
  '库里是否', '库中是否', '库里', '库中', '我这库里', '我这库中',
  '知识库中包不包含', '知识库中包含',
  '是否有', '是否存在', '是否包含',
  '有没有', '有哪些',
  '列出', '找一下', '找出', '查一下', '搜一下', '看一下', '看看',
  'list ', 'find ', 'search ', 'show me ', 'enumerate ',
  'do you have ', 'is there ', 'are there ', 'got any ',
]
const STOP_SUFFIXES = [
  '相关的资料', '相关的文档', '相关的文件', '相关的材料',
  '的资料', '的文档', '的文件', '的材料', '的资产',
  '相关', '吗', '？', '?', '。', '.',
  'documents', 'document', 'files', 'file', 'materials', 'material',
  'on this', 'for this', 'about this',
]
const STOP_WORDS = new Set([
  '的', '是', '个', '些', '一些', '一个', '所有', '全部', '都', '里', '中', '内', '有',
  '资料', '文档', '文件', '材料', '资产',
  'a', 'an', 'the', 'any', 'some', 'all', 'about', 'on', 'for', 'related', 'to', 'with',
  'pdf', 'xlsx', 'md', 'pptx', 'docx',  // 类型词不当关键词（需要结构化 filter，不是 name LIKE）
])

export function extractKbMetaKeywords(question: string): string[] {
  if (!question) return []
  let q = question.trim().toLowerCase()

  // 反复剥前缀（最长匹配优先；可能"我这库里"剥完后又出现"有"等再剥）
  let changed = true
  while (changed) {
    changed = false
    for (const p of STOP_PREFIXES) {
      const lp = p.toLowerCase()
      if (q.startsWith(lp)) { q = q.slice(lp.length).trim(); changed = true; break }
    }
  }
  // 反复剥后缀
  changed = true
  while (changed) {
    changed = false
    for (const s of STOP_SUFFIXES) {
      if (q.endsWith(s.toLowerCase())) { q = q.slice(0, -s.length).trim(); changed = true; break }
    }
  }
  // 剥剩余的"列出/找一下"等如果中间出现
  q = q.replace(/(列出|找一下|找出|查一下|搜一下|有哪些|是否|包含|包不包含|有没有)/g, ' ')
       .replace(/\b(documents?|files?|materials?|assets?|on|about|for|related|to)\b/g, ' ')

  // 切词：中文按 whitespace + 标点；英文按空格
  const tokens = q.split(/[\s,，。！!？?；;：:、（）()「」『』《》【】\-_/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))

  // 去重、按长度倒序、top 3
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tokens.sort((a, b) => b.length - a.length)) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= 3) break
  }
  return out
}

// ── 3. queryAssetCatalog · 直查 metadata_asset ─────────────────────────────

export interface AssetCatalogRow {
  id: number
  name: string
  type: string | null
  indexed_at: string | null
  tags: unknown
}

export async function queryAssetCatalog(opts: {
  keywords: string[]
  /** 限定在指定 metadata_asset.id 集合（Notebook 等显式 scope） */
  assetIds?: number[]
  /** 限定在指定 source_id 集合（ACL / space scope） */
  sourceIds?: number[]
  limit?: number
}): Promise<AssetCatalogRow[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const keywords = (opts.keywords ?? []).filter((k) => k && k.length >= 2)
  const assetIds = (opts.assetIds ?? []).filter((n) => Number.isFinite(n))
  const sourceIds = (opts.sourceIds ?? []).filter((n) => Number.isFinite(n))

  try {
    const pool = getPgPool()

    // 动态 WHERE
    const params: unknown[] = []
    const where: string[] = []
    if (keywords.length > 0) {
      params.push(keywords)
      where.push(
        `name ILIKE ANY (SELECT '%' || k || '%' FROM unnest($${params.length}::text[]) AS k)`,
      )
    }
    if (assetIds.length > 0) {
      params.push(assetIds)
      where.push(`id = ANY($${params.length}::int[])`)
    }
    if (sourceIds.length > 0) {
      params.push(sourceIds)
      where.push(`source_id = ANY($${params.length}::int[])`)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const sql = `
      SELECT id, name, type,
             to_char(indexed_at, 'YYYY-MM-DD') AS indexed_at,
             tags
      FROM metadata_asset
      ${whereSql}
      ORDER BY indexed_at DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `
    const { rows } = await pool.query<AssetCatalogRow>(sql, params)
    return rows
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[kbMetaHandler] queryAssetCatalog failed:', (err as Error).message)
    return []
  }
}

// ── 4. renderKbMetaAnswer · 渲染答案 ────────────────────────────────────────

const FAST_LLM_TIMEOUT_MS = 8000

function fallbackMarkdownList(question: string, candidates: AssetCatalogRow[], maxRows = 8): string {
  const head = `找到以下 ${Math.min(candidates.length, maxRows)} 个相关文档：\n\n`
  const lines = candidates.slice(0, maxRows).map((c) => {
    const date = c.indexed_at ? `${c.indexed_at} 入库` : '尚未完成入库'
    const typeLabel = c.type ? `${c.type} · ` : ''
    return `· [${c.name}]（${typeLabel}${date}）`
  })
  const tail = candidates.length > maxRows
    ? `\n\n（仅展示前 ${maxRows} 条；完整列表请去「资产目录」查看）`
    : ''
  return head + lines.join('\n') + tail
}

function emptyAnswer(question: string): string {
  return `知识库里似乎没有与「${question.trim().slice(0, 30)}」相关的资料。\n\n建议在「资产目录」里用关键词搜索，或上传相关文档。`
}

export async function renderKbMetaAnswer(opts: {
  question: string
  candidates: AssetCatalogRow[]
  signal: AbortSignal
}): Promise<string> {
  const { question, candidates, signal } = opts

  if (candidates.length === 0) return emptyAnswer(question)

  // ≤ 10 → 直接 fallback markdown（已含"找到以下" + 后缀）
  // > 10 → 先用 LLM 在精简 name 列表上语义筛
  if (candidates.length <= 10 || !isLlmConfigured()) {
    return fallbackMarkdownList(question, candidates)
  }

  // 大列表 → fast LLM 语义筛
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FAST_LLM_TIMEOUT_MS)
  signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  try {
    const idx = candidates.slice(0, 30).map((c, i) => `${i + 1}. ${c.name}`).join('\n')
    const prompt = `用户问：${question}

下面是知识库内的候选文档（按入库时间倒序，最多 30 条）。请挑出**与问题语义最相关的最多 8 条**，按相关性倒序输出它们的编号（仅数字，逗号分隔）。如果都不相关，输出 "0"。

候选：
${idx}

只输出数字，不解释。`

    const { content } = await chatComplete(
      [{ role: 'user', content: prompt }],
      { model: getLlmFastModel(), maxTokens: 60, temperature: 0.1 },
    )
    clearTimeout(t)

    const nums = String(content || '').match(/\d+/g)?.map(Number).filter((n) => n >= 1 && n <= candidates.length) ?? []
    if (nums.length === 0) {
      // LLM 说全无关 → 返回空答案 + 建议
      return emptyAnswer(question)
    }
    const picked = [...new Set(nums)].slice(0, 8).map((i) => candidates[i - 1])
    return fallbackMarkdownList(question, picked)
  } catch {
    clearTimeout(t)
    // LLM 抖了 → 退化前 8 条
    return fallbackMarkdownList(question, candidates)
  }
}

// ── 5. runKbMetaHandler · 编排 ──────────────────────────────────────────────

export interface RunKbMetaOptions {
  /** 限定在指定 metadata_asset.id 集合（Notebook 显式 scope） */
  assetIds?: number[]
  /** 限定在指定 source_id 集合（ACL / space scope） */
  sourceIds?: number[]
  /** 调用方提供 trace（顶层短路时为新建，档 B fallback 时复用 RAG 的） */
  trace?: Record<string, unknown>
  /**
   * 档 B fallback 路径：caller (runRagPipeline 主流程) 自己 emit 最终 trace + done。
   * 顶层短路路径：handler 自己负责 emit trace + done。默认 false。
   */
  omitDoneAndTrace?: boolean
  /**
   * 档 B fallback 路径：caller 已 emit 过 🎭 答案意图分类 → kb_meta，handler 跳过避免重复。
   */
  omitIntentEmit?: boolean
}

export async function runKbMetaHandler(
  question: string,
  emit: EmitFn,
  signal: AbortSignal,
  opts: RunKbMetaOptions = {},
): Promise<void> {
  emit({
    type: 'rag_step', icon: '📚',
    label: 'kb_meta · 直查 metadata_asset 目录（绕过 retrieval）',
  })

  const keywords = extractKbMetaKeywords(question)
  if (keywords.length > 0) {
    emit({ type: 'rag_step', icon: '🔑', label: `关键词: ${keywords.join(', ')}` })
  } else {
    emit({ type: 'rag_step', icon: '🔑', label: `无显式关键词 → 列全部（按入库时间倒序）` })
  }

  if (signal.aborted) return

  let candidates = await queryAssetCatalog({
    keywords,
    assetIds: opts.assetIds,
    sourceIds: opts.sourceIds,
    limit: 50,
  })

  // V3D 关键修复：keywords 非空但 SQL 字面 ILIKE 召回 0 条 → 退化到无关键词查询
  // （列全部按时间倒序），交给 renderKbMetaAnswer 内的 LLM 语义筛去判断相关性。
  // 典型场景："汽车工程相关的资料"（用户语义词）vs 库内 "LFTGATE/Bumper/尾门" (文档实
  // 际命名)——SQL 字面没法跨——全列 + LLM 语义筛是唯一出路。
  if (keywords.length > 0 && candidates.length === 0) {
    emit({
      type: 'rag_step', icon: '🔄',
      label: `关键词 SQL 0 命中 → 退化到全库列表（交给 LLM 语义筛）`,
    })
    candidates = await queryAssetCatalog({
      keywords: [],
      assetIds: opts.assetIds,
      sourceIds: opts.sourceIds,
      limit: 50,
    })
  }

  emit({
    type: 'rag_step', icon: '📋',
    label: `命中 ${candidates.length} 个候选`,
  })

  if (signal.aborted) return

  // 保持 D-003 评测器兼容（assertIntent 看 🎭 → kb_meta 拿 answerIntent）
  // 档 B fallback 路径下 caller 已 emit 过 🎭 → 跳过避免重复
  if (!opts.omitIntentEmit) {
    emit({
      type: 'rag_step', icon: '🎭',
      label: `答案意图分类 → kb_meta（rule:short-circuit / handler:catalog）`,
    })
  }

  let answer: string
  try {
    answer = await renderKbMetaAnswer({ question, candidates, signal })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[kbMetaHandler] renderKbMetaAnswer failed:', (err as Error).message)
    answer = candidates.length > 0
      ? fallbackMarkdownList(question, candidates)
      : emptyAnswer(question)
  }

  if (signal.aborted) return

  emit({ type: 'content', text: answer })

  if (opts.omitDoneAndTrace) return

  // trace 留空 citations（kb_meta 不是事实引用）
  emit({
    type: 'trace',
    data: {
      ...(opts.trace ?? {}),
      citations: [],
      kb_meta_handler: true,
      kb_meta_keywords: keywords,
      kb_meta_candidate_count: candidates.length,
    },
  })

  emit({ type: 'done' })
}
