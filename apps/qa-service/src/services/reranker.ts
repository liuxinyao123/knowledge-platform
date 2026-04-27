/**
 * services/reranker.ts —— Cross-encoder rerank（默认 BAAI/bge-reranker-v2-m3）
 *
 * 用途：把向量检索 top-N 用 cross-encoder 重新精排，把"对的但排不前"的 chunk
 * 提到前面。修 R@1 的主要手段。
 *
 * 配置（与 embeddings.ts 同源；rerank 走同一 vendor）：
 *   RERANKER_MODEL=BAAI/bge-reranker-v2-m3   ← 留空 / 'off' 则禁用
 *   RERANKER_BASE_URL=https://api.siliconflow.cn/v1   ← 默认沿用 EMBEDDING_BASE_URL
 *   RERANKER_API_KEY                                 ← 默认沿用 EMBEDDING_API_KEY / SILICONFLOW_API_KEY
 *   RERANKER_TIMEOUT_MS=10000
 *
 * API 形态（OpenAI / SiliconFlow 兼容）：
 *   POST {base}/rerank
 *   { model, query, documents: string[], top_n? }
 *   → { results: [{ index, relevance_score }, ...] }   按分数倒序
 */

const RERANK_PATH = '/rerank'
const DEFAULT_TIMEOUT = 10_000

function pickEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim()
    if (v) return v
  }
  return ''
}

export function rerankerModel(): string {
  return pickEnv('RERANKER_MODEL')
}

export function isRerankerConfigured(): boolean {
  const m = rerankerModel().toLowerCase()
  if (!m || m === 'off' || m === 'none' || m === 'disabled') return false
  return !!rerankerApiKey()
}

function rerankerBaseUrl(): string {
  return (pickEnv(
    'RERANKER_BASE_URL',
    'EMBEDDING_BASE_URL',
    'SILICONFLOW_BASE_URL',
    'OPENAI_BASE_URL',
  ) || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '')
}

function rerankerApiKey(): string {
  return pickEnv(
    'RERANKER_API_KEY',
    'EMBEDDING_API_KEY',
    'SILICONFLOW_API_KEY',
    'OPENAI_API_KEY',
  )
}

export interface RerankResult {
  index: number          // 原 documents 数组里的下标
  score: number          // cross-encoder 相关性分数
}

/**
 * 单次 rerank 调用。失败抛异常；调用方负责降级回原顺序。
 *
 * @param query    用户问题
 * @param documents 候选 chunk 文本列表（原顺序）
 * @param top_n    可选，只返前 N 条
 */
export async function rerank(
  query: string, documents: string[], top_n?: number,
): Promise<RerankResult[]> {
  if (!documents.length) return []
  if (!isRerankerConfigured()) {
    throw new Error('reranker not configured (set RERANKER_MODEL + key)')
  }
  const url = `${rerankerBaseUrl()}${RERANK_PATH}`
  const timeout = Math.max(1_000, Number(process.env.RERANKER_TIMEOUT_MS ?? DEFAULT_TIMEOUT))
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const body: Record<string, unknown> = {
      model: rerankerModel(),
      query,
      documents,
    }
    if (typeof top_n === 'number' && top_n > 0) body.top_n = Math.min(top_n, documents.length)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rerankerApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Rerank API ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json() as {
      results?: Array<{ index?: number; relevance_score?: number; score?: number }>
    }
    const out: RerankResult[] = []
    for (const r of data.results ?? []) {
      const idx = Number(r.index)
      if (!Number.isFinite(idx) || idx < 0 || idx >= documents.length) continue
      const score = Number(r.relevance_score ?? r.score ?? 0)
      out.push({ index: idx, score })
    }
    // SiliconFlow 已按 score 倒序；保险起见再排一次
    out.sort((a, b) => b.score - a.score)
    return out
  } finally {
    clearTimeout(timer)
  }
}
