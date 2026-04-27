/**
 * services/tagExtract.ts —— 从文档正文抽取主题标签（3-8 个）
 *
 * 调用方：
 *   - ingest pipeline 写入 metadata_asset.tags
 *   - 可单测：从已有 text 提标签
 *
 * 行为：
 *   - 未配 LLM / 调用失败 → 返回 []（非致命；ingest 不阻塞）
 *   - 最多 MAX_TAGS 个；单标签 ≤ 12 字符
 *   - 英文全小写；中文原样
 */
import {
  chatComplete, getLlmFastModel, isLlmConfigured,
  type OAITool,
} from './llm.ts'

const MAX_TAGS = 8
const MAX_TAG_LEN = 24       // 之前 12 太短，"Body Side Clearance" 都截掉一半
const MIN_TAG_LEN = 2
const MAX_INPUT_CHARS = 4000

// 标签前后/内部要剥掉的边界字符（JSON / Markdown / 列表残留）
const TRIM_CHARS_RE = /^[\s"'`\[\]{}()<>，,。、；;:：!！?？*•\-\u2013\u2014\u201c\u201d\u2018\u2019]+|[\s"'`\[\]{}()<>，,。、；;:：!！?？*•\-\u2013\u2014\u201c\u201d\u2018\u2019]+$/g
const ONLY_PUNCT_RE = /^[^\p{L}\p{N}]+$/u  // 全是非字母数字 → 丢掉

const EXTRACT_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'extract_tags',
    description: 'Extract 3-8 thematic tags from the given text',
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '3-8 短标签，每个 2-8 个字符/1-3 个英文单词',
        },
      },
      required: ['tags'],
    },
  },
}

// BUG-14 防 OCR 碎片判别已抽到 services/textHygiene.ts（rag-relevance-hygiene change · C）
// 这里直接 re-export 供 cleanOne 使用；保证两处（tagExtract + ingest chunk gate）共用同一套规则。
import { looksLikeOcrFragment } from './textHygiene.ts'

function cleanOne(t: string): string | null {
  if (typeof t !== 'string') return null
  let s = t
    // 去 JSON / 列表残留前缀（"1. " / "- " / "* "）
    .replace(/^[\s\d.]+[\s.)、]+/, '')
    // 剥两端引号 / 括号 / 标点 / 空白
    .replace(TRIM_CHARS_RE, '')
    .trim()
  if (!s) return null
  if (s.length < MIN_TAG_LEN) return null
  if (ONLY_PUNCT_RE.test(s)) return null
  if (looksLikeOcrFragment(s)) return null   // BUG-14
  // 太长就截到边界字符附近（首选空格 / 标点）
  if (s.length > MAX_TAG_LEN) {
    const cut = s.slice(0, MAX_TAG_LEN)
    const lastBoundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('-'), cut.lastIndexOf('/'))
    s = lastBoundary > MAX_TAG_LEN * 0.6 ? cut.slice(0, lastBoundary) : cut
    s = s.replace(TRIM_CHARS_RE, '').trim()
  }
  // 全英文（含空格/连字符）小写化便于去重
  if (/^[A-Za-z][A-Za-z0-9\s\-_/]*$/.test(s)) s = s.toLowerCase().replace(/\s+/g, ' ').trim()
  return s.length >= MIN_TAG_LEN ? s : null
}

function sanitize(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const clean = cleanOne(t)
    if (!clean) continue
    const k = clean.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(clean)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export async function extractTags(
  text: string,
  opts: { signal?: AbortSignal; assetName?: string } = {},
): Promise<string[]> {
  if (!text || !text.trim()) return []
  if (!isLlmConfigured()) return []
  if (opts.signal?.aborted) return []

  const trimmed = text.slice(0, MAX_INPUT_CHARS)
  const prompt = opts.assetName
    ? `资产名：${opts.assetName}\n\n正文摘录：\n${trimmed}`
    : `正文摘录：\n${trimmed}`

  try {
    const { content, toolCalls } = await chatComplete(
      [{ role: 'user', content: prompt }],
      {
        model: getLlmFastModel(),
        maxTokens: 200,
        system:
          '你是内容标签专家。为文档输出 3-8 个主题标签（行业术语 / 领域关键字），'
          + '精炼、具体、可检索。直接输出标签列表，用中文逗号或英文逗号分隔，不要解释。',
        tools: [EXTRACT_TOOL],
        // 不强制 tool_choice：小模型（如 Qwen 7B）可能无法稳定响应 tool；
        // 'auto' 让它自由选——支持工具就走 function-call，不支持就返文本（走下方 content fallback）。
        toolChoice: 'auto',
      },
    )

    // 路径 A：tool call 正常回
    const args = toolCalls[0]?.function?.arguments
    if (args) {
      try {
        const parsed = JSON.parse(args) as { tags?: unknown }
        if (Array.isArray(parsed.tags)) return sanitize(parsed.tags as string[])
      } catch { /* fall through */ }
    }

    // 路径 B：部分开源模型不吃 tool_choice，直接回普通文本；要稳健解析多种格式
    if (typeof content === 'string' && content.trim()) {
      // B1：尝试整段当 JSON array 解（最常见的"小模型自作主张"返回 ["a","b","c"]）
      const trimmedContent = content.trim()
      // 先试着抽出第一个 [...] 块（哪怕外面有"标签：" 之类前缀）
      const arrayMatch = trimmedContent.match(/\[[^\]]*\]/)
      if (arrayMatch) {
        try {
          const parsed = JSON.parse(arrayMatch[0]) as unknown
          if (Array.isArray(parsed)) {
            const cleaned = sanitize(parsed.map((x) => String(x)))
            if (cleaned.length) return cleaned
          }
        } catch { /* fall to B2 */ }
      }
      // B2：按逗号/分号/换行拆，每段过 cleanOne
      const keywords = trimmedContent
        .replace(/^(标签|tags?|关键词|keywords?)\s*[:：]?\s*/i, '')   // 去 "标签：" 前缀
        .split(/[,，、;；\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (keywords.length) return sanitize(keywords)
    }

    return []
  } catch {
    return []
  }
}
