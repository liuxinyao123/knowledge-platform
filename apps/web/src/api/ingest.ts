import axios from 'axios'

const client = axios.create({
  baseURL: '/api/ingest',
})

export type ExtractIngestResponse =
  | { ok: true; text: string; attachmentOnly?: false; summary?: string }
  | { ok: true; attachmentOnly: true; hint: string }
  | { ok: false; error: string }

// ── 类型守卫（供消费方在 ok 分支内部做二次收窄） ────────────────────────────
type ExtractOk = Extract<ExtractIngestResponse, { ok: true }>
type ExtractAttachment = Extract<ExtractOk, { attachmentOnly: true }>
type ExtractText = Exclude<ExtractOk, { attachmentOnly: true }>

export function isExtractAttachment(ex: ExtractIngestResponse): ex is ExtractAttachment {
  return ex.ok === true && (ex as { attachmentOnly?: unknown }).attachmentOnly === true
}

export function isExtractText(ex: ExtractIngestResponse): ex is ExtractText {
  return ex.ok === true && (ex as { attachmentOnly?: unknown }).attachmentOnly !== true
}

export function isExtractError(ex: ExtractIngestResponse): ex is Extract<ExtractIngestResponse, { ok: false }> {
  return ex.ok === false
}

export async function extractIngestText(file: File): Promise<ExtractIngestResponse> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await client.post<ExtractIngestResponse>('/extract-text', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** 将 BookStack 页面登记到资产目录并增量写入向量索引（需配置嵌入 API 才会写入切片） */
export async function registerIndexedPage(pageId: number, summary?: string): Promise<void> {
  await client.post('/register-indexed-page', {
    pageId,
    ...(summary ? { summary } : {}),
  })
}

// ── PRD §7 最近入库历史 ───────────────────────────────────────────────────────

export interface RecentImport {
  id: number
  email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  at: string
  name: string | null
  chunks: number | null
  images: number | null
  tags: string[] | null
}

export async function getRecentImports(limit = 10): Promise<RecentImport[]> {
  const { data } = await client.get<{ items: RecentImport[] }>('/recent', { params: { limit } })
  return data.items
}

// ═════════════════════════════════════════════════════════════════════════════
// ── PRD §7 数据预处理模块：新版高层 ingest API
// ═════════════════════════════════════════════════════════════════════════════

export type JobKind = 'upload' | 'fetch-url' | 'conversation' | 'batch' | 'scan-folder'

export type JobPhase =
  | 'pending' | 'parse' | 'ocr' | 'table' | 'chunk'
  | 'tag' | 'embed' | 'done' | 'failed' | 'paused'

export interface IngestOptions {
  space?: string
  sourceId?: number
  tags?: string[]
  strategy?: 'heading' | 'fixed' | 'smart'
  vectorize?: boolean
}

export interface JobSummary {
  id: string
  kind: JobKind
  name: string
  space: string
  tags: string[]
  phase: JobPhase
  progress: number
  startedAt: number
  updatedAt: number
  finishedAt?: number
  error?: string
  assetId?: number
  chunkCount?: number
}

export interface JobLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  phase: JobPhase
  msg: string
}

export interface JobPreview {
  tables?: Array<{ name?: string; rows: string[][] }>
  chunks?: { generated: number; total: number; avgTokens: number; strategy?: string }
  images?: number
  tags?: string[]
}

export interface JobDetail extends JobSummary {
  sourceId: number
  strategy: string
  vectorize: boolean
  log: JobLogEntry[]
  preview: JobPreview
}

export interface JobStep {
  id: JobPhase
  label: string
  status: 'done' | 'active' | 'pending' | 'failed'
}

export async function uploadFull(file: File, options: IngestOptions = {}): Promise<{ jobId: string }> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('options', JSON.stringify(options))
  const { data } = await client.post<{ jobId: string }>('/upload-full', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function fetchUrl(url: string, options: IngestOptions = {}): Promise<{ jobId: string }> {
  const { data } = await client.post<{ jobId: string }>('/fetch-url', { url, options })
  return data
}

export async function ingestConversation(
  title: string,
  messages: Array<{ role: string; text: string }>,
  options: IngestOptions = {},
): Promise<{ jobId: string }> {
  const { data } = await client.post<{ jobId: string }>('/conversation', { title, messages, options })
  return data
}

export async function listJobs(params: { limit?: number; includeFinished?: boolean } = {}): Promise<JobSummary[]> {
  const { data } = await client.get<{ items: JobSummary[] }>('/jobs', { params })
  return data.items
}

export async function getJob(id: string): Promise<{ job: JobDetail; steps: JobStep[] }> {
  const { data } = await client.get<{ job: JobDetail; steps: JobStep[] }>(`/jobs/${encodeURIComponent(id)}`)
  return data
}

export async function pauseJob(id: string): Promise<void> {
  await client.post(`/jobs/${encodeURIComponent(id)}/pause`)
}

export async function retryJob(id: string): Promise<void> {
  await client.post(`/jobs/${encodeURIComponent(id)}/retry`)
}

// ── ingest-async-pipeline · SSE 订阅（Phase B optional）────────────────────
//
// 使用示例：
//   const stop = streamJob(jobId, {
//     onPhase: (p) => setPhase(p),
//     onLog:   (entries) => setLog((cur) => [...cur, ...entries]),
//     onPreview: (preview) => setPreview(preview),
//     onDone: (r) => { setPhase(r.ingest_status === 'indexed' ? 'done' : 'failed'); stop() },
//     onError: (e) => console.warn('stream error', e),
//   })
//   useEffect(() => stop, [stop])
//
// 采用 native EventSource（不走 axios）；credentials: 'include' 由 cookies 透传 JWT。
// 注意 EventSource 的 `Authorization` header 不可自定义——qa-service 端必须接受 cookie
// 形式的鉴权 fallback，或由浏览器同源 cookie 自动带上。本 helper 假设 requireAuth 能
// 从 cookie / 同源凭据中取到 principal；若鉴权失败会触发 onError。

export interface JobStreamHandlers {
  onPhase?: (data: { phase: JobPhase; progress: number; at: number }) => void
  onLog?: (entries: Array<{ at: number; level: 'info' | 'warn' | 'error'; phase: JobPhase; msg: string }>) => void
  onPreview?: (preview: unknown) => void
  onDone?: (result: { ingest_status: 'indexed' | 'failed' | 'cancelled'; asset_id: number | null; error: string | null }) => void
  onError?: (err: Event | Error) => void
}

/** 返回 stop 函数；调用方 useEffect cleanup 里调用以关闭连接。 */
export function streamJob(jobId: string, handlers: JobStreamHandlers): () => void {
  const url = `/api/ingest/jobs/${encodeURIComponent(jobId)}/stream`
  const es = new EventSource(url, { withCredentials: true })

  const handle = (event: string, cb?: (payload: unknown) => void) => {
    if (!cb) return
    es.addEventListener(event, (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data)
        cb(data)
      } catch (err) {
        handlers.onError?.(err as Error)
      }
    })
  }

  handle('phase',   handlers.onPhase   as (p: unknown) => void)
  handle('log',     (payload) => {
    const tail = (payload as { tail?: unknown }).tail
    if (Array.isArray(tail)) handlers.onLog?.(tail as Parameters<NonNullable<JobStreamHandlers['onLog']>>[0])
  })
  handle('preview', handlers.onPreview as (p: unknown) => void)
  handle('done', (payload) => {
    handlers.onDone?.(payload as Parameters<NonNullable<JobStreamHandlers['onDone']>>[0])
    es.close()
  })

  es.onerror = (ev) => {
    // EventSource 会自动重连；onError 仅信号化给上层记日志 / UI toast
    handlers.onError?.(ev)
  }

  return () => es.close()
}
