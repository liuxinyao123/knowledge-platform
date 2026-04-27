/**
 * services/textHygiene.ts —— 共享文本卫生工具
 *
 * 三个判别器：
 *   - looksLikeOcrFragment  —— OCR 残留 / 单字符堆叠（"g g g"）/ 含 emoji / 含裸引号
 *   - looksLikeErrorJsonBlob —— 入库失败的 JSON error body 被当正文
 *   - isBadChunk             —— 综合：长度 + 前两者
 *
 * 对应 spec: openspec/changes/rag-relevance-hygiene/specs/chunk-hygiene-spec.md
 *
 * 复用：
 *   - services/tagExtract.ts::cleanOne（批 D · BUG-14 修复）
 *   - services/ingestPipeline/pipeline.ts chunk gate（本 change · C）
 *   - scripts/cleanup-bad-chunks-ocr.mjs（本 change · D）
 */

export const MIN_CHUNK_CHARS = 20

const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u
const LOOSE_PUNCT_RE = /["'`\u201c\u201d\u2018\u2019]/

/**
 * 识别 OCR 碎片 / 单字符堆叠 / 含 emoji / 含裸引号的 tag 或 chunk。
 * 正常短语（"知识图谱" / "machine learning" / "RAG pipeline"）应返 false。
 */
export function looksLikeOcrFragment(s: string): boolean {
  if (!s) return false
  if (EMOJI_RE.test(s)) return true
  if (LOOSE_PUNCT_RE.test(s)) return true
  // 全 ASCII（英文 / 数字 / 常见分隔符）才进 token 平均长度判断；
  // 中文 / 混合文本不在这条规则范围（中文 token 概念不同）。
  if (/^[A-Za-z0-9\s\-_/]+$/.test(s)) {
    const tokens = s.split(/\s+/).filter(Boolean)
    if (tokens.length >= 3) {
      const avg = tokens.reduce((a, t) => a + t.length, 0) / tokens.length
      if (avg < 2) return true            // "g g g" / "a b c d" 型
      const singles = tokens.filter((t) => t.length === 1).length
      if (singles >= 3) return true       // "G G G D" 型
    }
  }
  return false
}

/**
 * 识别被当正文存进来的 JSON error blob。严格条件：必须以 `{` 开头（顶层对象），
 * 且包含 error / not_found_error / File not found in container 等特征。
 */
export function looksLikeErrorJsonBlob(s: string): boolean {
  if (!s) return false
  const t = s.trim()
  if (!t.startsWith('{')) return false
  return /"type"\s*:\s*"error"/.test(t)
      || /"error"\s*:\s*\{/.test(t)
      || /not_found_error/.test(t)
      || /File not found in container/.test(t)
}

export type BadChunkReason = 'too_short' | 'error_json_blob' | 'ocr_fragment'

export interface BadChunkCheck {
  bad: boolean
  reason?: BadChunkReason
}

/**
 * 综合判定：chunk 是否值得入库。
 * 优先级：长度 > JSON error > OCR 碎片。
 */
export function isBadChunk(content: string | null | undefined): BadChunkCheck {
  if (!content) return { bad: true, reason: 'too_short' }
  const c = content.trim()
  if (c.length < MIN_CHUNK_CHARS) return { bad: true, reason: 'too_short' }
  if (looksLikeErrorJsonBlob(c))  return { bad: true, reason: 'error_json_blob' }
  if (looksLikeOcrFragment(c))    return { bad: true, reason: 'ocr_fragment' }
  return { bad: false }
}
