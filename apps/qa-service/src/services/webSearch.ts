/**
 * services/webSearch.ts —— 联网检索 service（ADR-35 候选）
 *
 * 职责：
 *   - 提供 webSearch(query, opts) 抽象，支持多 provider（Tavily 默认，Bing 备选）
 *   - Provider 通过环境变量 WEB_SEARCH_PROVIDER 选择，对应 *_API_KEY 必填
 *   - 软超时 + 错误软返 []，永不阻塞 RAG 主链路
 *
 * 调用方：
 *   - KnowledgeQaAgent 在 web_search=true 时调用，结果作为额外 citation 集 emit
 *
 * 环境变量：
 *   WEB_SEARCH_PROVIDER       'tavily' | 'bing' | 'none'（默认 none）
 *   WEB_SEARCH_TIMEOUT_MS     默认 5000
 *   TAVILY_API_KEY            tvly-... （https://tavily.com，1000 / month free）
 *   BING_API_KEY              Azure Cognitive Services Bing v7
 *   WEB_SEARCH_DEFAULT_TOP_K  默认 5
 */

const _lastWarnAt: Map<string, number> = new Map()
function warnOnce(tag: string, msg: string): void {
  const now = Date.now()
  const last = _lastWarnAt.get(tag) ?? 0
  if (now - last < 60_000) return
  _lastWarnAt.set(tag, now)
  // eslint-disable-next-line no-console
  console.warn(`[webSearch] ${tag}: ${msg}`)
}

export type WebSearchProvider = 'tavily' | 'bing' | 'none'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  /** 0..1，按 provider 归一化 */
  score?: number
  /** 来源 provider，便于前端展示 */
  provider: WebSearchProvider
}

export interface WebSearchOpts {
  topK?: number
  /** 软超时，默认读 env */
  timeoutMs?: number
}

export function getProvider(): WebSearchProvider {
  const v = (process.env.WEB_SEARCH_PROVIDER ?? '').toLowerCase().trim()
  if (v === 'tavily' || v === 'bing') return v
  return 'none'
}

export function isWebSearchConfigured(): boolean {
  const p = getProvider()
  if (p === 'tavily') return !!(process.env.TAVILY_API_KEY?.trim())
  if (p === 'bing') return !!(process.env.BING_API_KEY?.trim())
  return false
}

function readTopK(opt?: number): number {
  const n = Number(opt ?? process.env.WEB_SEARCH_DEFAULT_TOP_K ?? 5)
  return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 5
}

function readTimeout(opt?: number): number {
  const n = Number(opt ?? process.env.WEB_SEARCH_TIMEOUT_MS ?? 5000)
  return Number.isFinite(n) && n >= 500 && n <= 30000 ? Math.floor(n) : 5000
}

/** 主入口：永不抛，失败返 [] */
export async function webSearch(
  query: string,
  opts: WebSearchOpts = {},
): Promise<WebSearchHit[]> {
  if (!query.trim()) return []
  const provider = getProvider()
  if (provider === 'none' || !isWebSearchConfigured()) {
    warnOnce('not-configured', `provider=${provider}; set WEB_SEARCH_PROVIDER + corresponding *_API_KEY`)
    return []
  }
  const topK = readTopK(opts.topK)
  const timeoutMs = readTimeout(opts.timeoutMs)

  try {
    if (provider === 'tavily') return await tavilySearch(query, topK, timeoutMs)
    if (provider === 'bing') return await bingSearch(query, topK, timeoutMs)
    return []
  } catch (err) {
    warnOnce('err', (err as Error).message.slice(0, 200))
    return []
  }
}

// ── Tavily ─────────────────────────────────────────────────────────
// docs: https://docs.tavily.com/docs/rest-api/api-reference

interface TavilyResp {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    score?: number
  }>
}

async function tavilySearch(
  query: string,
  topK: number,
  timeoutMs: number,
): Promise<WebSearchHit[]> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY!.trim(),
        query,
        max_results: topK,
        search_depth: 'basic',     // basic 1c / advanced 2c per call
        include_answer: false,
      }),
      signal: ctl.signal,
    })
    if (!res.ok) {
      warnOnce('tavily-http', `status ${res.status}`)
      return []
    }
    const data = (await res.json()) as TavilyResp
    const items = Array.isArray(data.results) ? data.results : []
    return items
      .map<WebSearchHit | null>((r) => {
        if (!r.url || !r.title) return null
        return {
          title: String(r.title).slice(0, 200),
          url: String(r.url),
          snippet: String(r.content ?? '').slice(0, 500),
          score: typeof r.score === 'number' ? r.score : undefined,
          provider: 'tavily',
        }
      })
      .filter((x): x is WebSearchHit => x !== null)
      .slice(0, topK)
  } finally {
    clearTimeout(t)
  }
}

// ── Bing ───────────────────────────────────────────────────────────
// docs: https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/endpoints

interface BingResp {
  webPages?: {
    value?: Array<{
      name?: string
      url?: string
      snippet?: string
    }>
  }
}

async function bingSearch(
  query: string,
  topK: number,
  timeoutMs: number,
): Promise<WebSearchHit[]> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(topK))
    url.searchParams.set('responseFilter', 'webPages')
    url.searchParams.set('mkt', process.env.BING_MARKET || 'zh-CN')
    const res = await fetch(url.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_API_KEY!.trim() },
      signal: ctl.signal,
    })
    if (!res.ok) {
      warnOnce('bing-http', `status ${res.status}`)
      return []
    }
    const data = (await res.json()) as BingResp
    const items = data.webPages?.value ?? []
    return items
      .map<WebSearchHit | null>((r) => {
        if (!r.url || !r.name) return null
        return {
          title: String(r.name).slice(0, 200),
          url: String(r.url),
          snippet: String(r.snippet ?? '').slice(0, 500),
          provider: 'bing',
        }
      })
      .filter((x): x is WebSearchHit => x !== null)
      .slice(0, topK)
  } finally {
    clearTimeout(t)
  }
}

/** 给 LLM context 用的拼接格式 */
export function formatHitsAsContext(hits: WebSearchHit[]): string {
  if (!hits.length) return ''
  const lines = hits.map((h, i) =>
    `[web-${i + 1}] ${h.title}\nURL: ${h.url}\n${h.snippet}`,
  )
  return `[Web search results]\n${lines.join('\n---\n')}\n[/web]`
}
