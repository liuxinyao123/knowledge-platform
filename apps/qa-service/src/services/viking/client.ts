/**
 * OpenViking sidecar - HTTP 客户端
 *
 * 设计原则：
 *   1. VIKING_ENABLED=0 时全部 no-op，零网络调用，零日志噪音
 *   2. 所有方法都软超时 + 不抛，主链路对故障无感
 *   3. URI 强制 prefix 校验（不允许跨用户写读），防止 principal id 串污
 *
 * 不抛规则：
 *   - 网络/超时/4xx/5xx 都吞掉，返回安全默认值（[]、false 或 null）
 *   - 但要 console.warn 一次（采样：每分钟最多一次同类警告，避免日志风暴）
 *
 * 不引入新依赖，复用 axios（qa-service 已有）。
 */

import axios, { type AxiosInstance } from 'axios'
import type {
  VikingFindHit,
  VikingFindRequest,
  VikingHealthResult,
  VikingUri,
  VikingWriteRequest,
} from './types.ts'

// ─── 配置 ────────────────────────────────────────────────────────

interface VikingConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  recallTimeoutMs: number
  saveTimeoutMs: number
}

function readConfig(): VikingConfig {
  return {
    enabled: process.env.VIKING_ENABLED === '1' || process.env.VIKING_ENABLED === 'true',
    baseUrl: (process.env.VIKING_BASE_URL || 'http://localhost:1933').replace(/\/+$/, ''),
    apiKey: process.env.VIKING_ROOT_KEY?.trim() || '',
    recallTimeoutMs: parseInt(process.env.VIKING_RECALL_TIMEOUT_MS || '200', 10),
    saveTimeoutMs: parseInt(process.env.VIKING_SAVE_TIMEOUT_MS || '1000', 10),
  }
}

// 缓存配置在进程内，避免每次都读 env（env 不会运行时变）
let _cfg: VikingConfig | null = null
function cfg(): VikingConfig {
  if (_cfg === null) _cfg = readConfig()
  return _cfg
}

/** 测试辅助：重置配置缓存 */
export function __resetVikingConfigForTest(): void {
  _cfg = null
}

// ─── 日志降噪（每类警告每分钟一条） ─────────────────────────────

const _lastWarnAt: Map<string, number> = new Map()
function warnOnce(tag: string, msg: string): void {
  const now = Date.now()
  const last = _lastWarnAt.get(tag) ?? 0
  if (now - last < 60_000) return
  _lastWarnAt.set(tag, now)
  // eslint-disable-next-line no-console
  console.warn(`[viking] ${tag}: ${msg}`)
}

// ─── axios 工厂 ────────────────────────────────────────────────

function makeHttp(timeoutMs: number): AxiosInstance {
  const c = cfg()
  return axios.create({
    baseURL: c.baseUrl,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
    },
    // 4xx/5xx 不抛 axios 异常，由我们手动判
    validateStatus: () => true,
  })
}

// ─── URI 安全：强制 prefix 校验 ──────────────────────────────────

/**
 * 把 principalId 规整成路径段：去除 viking://、/、空白等。
 * 避免恶意 principal id（虽然 Permissions V2 已经过滤，多一层防御）。
 */
export function principalToPathSeg(principalId: string | number): string {
  const s = String(principalId).trim()
  if (!s || /[\/\\:]/.test(s)) {
    throw new Error(`[viking] invalid principalId for path: ${JSON.stringify(s)}`)
  }
  return s
}

/** 校验 uri 必须以指定前缀开头，否则抛 —— 写入时强制 */
function assertPrefix(uri: VikingUri, prefix: VikingUri): void {
  if (!uri.startsWith(prefix)) {
    throw new Error(`[viking] URI ${uri} violates required prefix ${prefix}`)
  }
}

// ─── 公开 API ────────────────────────────────────────────────────

export function isEnabled(): boolean {
  return cfg().enabled
}

/**
 * 健康检查：只在启动时调一次，写日志用。失败不抛。
 * VIKING_ENABLED=0 时直接返回 { ok: false, reason: 'disabled' } 不发请求。
 */
export async function health(): Promise<VikingHealthResult> {
  const c = cfg()
  if (!c.enabled) return { ok: false, reason: 'disabled' }
  try {
    const http = makeHttp(2000)
    const res = await http.get('/healthz')
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, version: typeof res.data?.version === 'string' ? res.data.version : undefined }
    }
    return { ok: false, reason: `http ${res.status}` }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

/**
 * 检索记忆。强制限定 pathPrefix，外部不能传任意路径。
 * 软超时，超时返回 [] 不抛。
 */
export async function find(req: VikingFindRequest): Promise<VikingFindHit[]> {
  const c = cfg()
  if (!c.enabled) return []
  if (!req.pathPrefix.startsWith('viking://')) {
    throw new Error(`[viking] pathPrefix must start with viking://, got ${req.pathPrefix}`)
  }
  try {
    const http = makeHttp(c.recallTimeoutMs)
    const res = await http.post('/v1/find', {
      query: req.query,
      path_prefix: req.pathPrefix,
      top_k: req.topK ?? 5,
      layer: req.layer ?? 'l1',
    })
    if (res.status >= 200 && res.status < 300) {
      const hits: unknown[] = Array.isArray(res.data?.hits) ? res.data.hits : []
      return hits.map((h: unknown): VikingFindHit => {
        const o = (h ?? {}) as Record<string, unknown>
        return {
          uri: typeof o.uri === 'string' ? o.uri : '',
          l1: typeof o.l1 === 'string' ? o.l1 : (typeof o.overview === 'string' ? o.overview : undefined),
          l0: typeof o.l0 === 'string' ? o.l0 : (typeof o.abstract === 'string' ? o.abstract : undefined),
          score: typeof o.score === 'number' ? o.score : undefined,
          metadata: (o.metadata && typeof o.metadata === 'object') ? o.metadata as Record<string, unknown> : undefined,
        }
      }).filter(h => h.uri)
    }
    warnOnce('find:http', `status ${res.status}`)
    return []
  } catch (err) {
    warnOnce('find:err', (err as Error).message)
    return []
  }
}

/**
 * 写入一条 context。不 await 即 fire-and-forget；caller 软超时控制。
 * URI 必须以 requiredPrefix 开头，否则抛（这是程序员错误，不应该吞）。
 */
export async function write(
  req: VikingWriteRequest,
  requiredPrefix: VikingUri,
): Promise<boolean> {
  const c = cfg()
  if (!c.enabled) return false
  assertPrefix(req.uri, requiredPrefix)
  try {
    const http = makeHttp(c.saveTimeoutMs)
    const res = await http.post('/v1/write', {
      uri: req.uri,
      content: req.content,
      metadata: req.metadata ?? {},
    })
    if (res.status >= 200 && res.status < 300) return true
    warnOnce('write:http', `status ${res.status} for ${req.uri}`)
    return false
  } catch (err) {
    warnOnce('write:err', (err as Error).message)
    return false
  }
}

/** 读全文（调试 / 后续 mcp 工具会用到，本轮 KnowledgeQaAgent 不调） */
export async function read(uri: VikingUri): Promise<string | null> {
  const c = cfg()
  if (!c.enabled) return null
  try {
    const http = makeHttp(c.recallTimeoutMs)
    const res = await http.get('/v1/read', { params: { uri } })
    if (res.status >= 200 && res.status < 300) {
      return typeof res.data?.content === 'string' ? res.data.content : null
    }
    return null
  } catch {
    return null
  }
}

/** 列目录（调试用） */
export async function ls(path: VikingUri): Promise<string[]> {
  const c = cfg()
  if (!c.enabled) return []
  try {
    const http = makeHttp(c.recallTimeoutMs)
    const res = await http.get('/v1/ls', { params: { path } })
    if (res.status >= 200 && res.status < 300) {
      const items = Array.isArray(res.data?.items) ? res.data.items : []
      return items.map((x: unknown) => String(x)).filter(Boolean)
    }
    return []
  } catch {
    return []
  }
}
