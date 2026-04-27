/**
 * services/jobRegistry.ts —— 入库任务注册表
 *
 * PRD §7 数据预处理模块：前端要看"处理中 / 失败 / 已完成"三类任务的实时状态，
 * 以及每个任务的 6 步 pipeline 进度。这个 registry 负责：
 *   1. 对每次入库请求生成 jobId
 *   2. 记录 phase 变化 + 日志 + 预览数据
 *   3. 按 LRU 保留最近 N 个（默认 200），老的自动驱逐
 *
 * ingest-async-pipeline（2026-04-24）：所有 **写操作** 以 fire-and-forget 方式额外
 * 写 `ingest_job` 表持久化；读路径继续走内存（Phase B 再改路由直查 DB）。DB 失败只
 * WARN 并保持内存语义不变，保留"启动无 PG"也能跑的兼容性。
 */
import { randomUUID } from 'node:crypto'
import { getPgPool } from './pgDb.ts'

export type JobKind =
  | 'upload' | 'fetch-url' | 'conversation' | 'batch' | 'scan-folder'
  // ingest-l0-abstract（ADR-32 候选）：lazy / active 回填走同一个 worker 通道
  | 'abstract'

export type JobPhase =
  | 'pending'   // 排队中
  | 'parse'     // 文件解析
  | 'ocr'       // OCR 识别
  | 'table'     // 表格提取
  | 'chunk'     // 切分
  | 'tag'       // 标签提取
  | 'embed'     // 向量化
  | 'abstract'  // L0/L1 摘要（ingest-l0-abstract · ADR-32 候选）
  | 'done'      // 完成
  | 'failed'    // 失败
  | 'paused'    // 暂停（UI 标记，当前实现不真的中断）

export const PIPELINE_STEPS: Array<{ id: JobPhase; label: string }> = [
  { id: 'parse', label: '文件解析' },
  { id: 'ocr',   label: 'OCR 识别' },
  { id: 'table', label: '表格提取' },
  { id: 'chunk', label: '切分' },
  { id: 'tag',   label: '标签提取' },
  { id: 'embed', label: '向量化' },
  { id: 'abstract', label: 'L0/L1 摘要' },
]

/** 每一步在整体进度中的权重，累计到 100 */
const PHASE_WEIGHT: Record<JobPhase, number> = {
  pending: 0, parse: 10, ocr: 25, table: 40, chunk: 60, tag: 75, embed: 95,
  abstract: 98,
  done: 100, failed: 0, paused: 0,
}

export interface JobLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  phase: JobPhase
  msg: string
}

export interface JobPreview {
  /** 表格提取预览：每张表前 N 行 */
  tables?: Array<{ name?: string; rows: string[][] }>
  /** 切片统计 */
  chunks?: { generated: number; total: number; avgTokens: number; strategy?: string }
  /** 图片张数 */
  images?: number
  /** 提取出的 tags */
  tags?: string[]
}

export interface JobRecord {
  id: string
  kind: JobKind
  name: string              // 文件名 / URL / 对话标题
  space: string             // 目标空间名；仅展示用
  sourceId: number          // 真正的 metadata_source.id
  tags: string[]            // 用户指定的 tags
  strategy: string          // 分段策略
  vectorize: boolean        // 是否向量化
  phase: JobPhase
  progress: number          // 0-100
  startedAt: number
  updatedAt: number
  finishedAt?: number
  error?: string
  assetId?: number
  chunkCount?: number
  log: JobLogEntry[]
  preview: JobPreview
  createdBy?: string        // ingest-async-pipeline · 异步模式下 SSE 鉴权用；同步路径可留空
}

export interface CreateJobInput {
  kind: JobKind
  name: string
  space: string
  sourceId: number
  tags?: string[]
  strategy?: string
  vectorize?: boolean
  /** ingest-async-pipeline · 异步入口必填；同步路径默认 'system' */
  createdBy?: string
}

const MAX_JOBS = 200
const MAX_LOG_PER_JOB = 50

const jobs = new Map<string, JobRecord>()

// ── ingest-async-pipeline · DB 持久化辅助 ──────────────────────────────────────
//
// 所有 DB 写入都是 fire-and-forget。任何异常只 WARN 一次并不阻塞内存语义。
// DB 一次性失败（PG down / 迁移未跑）→ WARN；后续调用继续尝试，不拉黑名单。

let _dbWarnedAt = 0

function dbWarn(msg: string): void {
  const now = Date.now()
  if (now - _dbWarnedAt < 60_000) return
  _dbWarnedAt = now
  // eslint-disable-next-line no-console
  console.warn(`[jobRegistry] DB write skipped: ${msg}`)
}

/** JobPhase → ingest_job.status 粗粒度映射 */
export function phaseToStatus(phase: JobPhase): string {
  switch (phase) {
    case 'pending': return 'queued'
    case 'done':    return 'indexed'
    case 'failed':  return 'failed'
    case 'paused':  return 'queued'        // paused 目前仅 UI 标记，不真的中断，映回可认领
    default:        return 'in_progress'   // parse / ocr / table / chunk / tag / embed
  }
}

function truncatedLog(log: JobLogEntry[]): JobLogEntry[] {
  // 持久化时只保留最近 MAX_LOG_PER_JOB 条；内存已自己 cap
  return log.length <= MAX_LOG_PER_JOB ? log : log.slice(-MAX_LOG_PER_JOB)
}

/** 异步 INSERT，不 await；调用处不关心结果 */
function dbInsertJob(job: JobRecord): void {
  const pool = getPgPool()
  const payload = {
    space: job.space,
    tags: job.tags,
    strategy: job.strategy,
    vectorize: job.vectorize,
  }
  pool.query(
    `INSERT INTO ingest_job
       (id, kind, source_id, name, input_payload, status, phase, progress, log, preview, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      job.id,
      job.kind,
      job.sourceId,
      job.name,
      JSON.stringify(payload),
      phaseToStatus(job.phase),
      job.phase,
      job.progress,
      JSON.stringify(truncatedLog(job.log)),
      JSON.stringify(job.preview),
      job.createdBy ?? 'system',
    ],
  ).catch((err) => dbWarn((err as Error).message))
}

/** 异步 UPDATE 的部分字段；不 await */
function dbUpdateJob(id: string, patch: {
  phase?: JobPhase
  progress?: number
  error?: string | null
  assetId?: number | null
  log?: JobLogEntry[]
  preview?: JobPreview
  finishedAt?: number
}): void {
  const pool = getPgPool()
  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = []
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length + 1}`) }

  if (patch.phase !== undefined) {
    push('phase', patch.phase)
    push('status', phaseToStatus(patch.phase))
    if (patch.phase === 'parse' || patch.phase === 'ocr' || patch.phase === 'table'
      || patch.phase === 'chunk' || patch.phase === 'tag' || patch.phase === 'embed') {
      push('phase_started_at', new Date())
    }
  }
  if (patch.progress !== undefined)   push('progress', patch.progress)
  if (patch.error !== undefined)      push('error', patch.error)
  if (patch.assetId !== undefined)    push('asset_id', patch.assetId)
  if (patch.log !== undefined)        push('log', JSON.stringify(truncatedLog(patch.log)))
  if (patch.preview !== undefined)    push('preview', JSON.stringify(patch.preview))
  if (patch.finishedAt !== undefined) push('finished_at', new Date(patch.finishedAt))

  const sql = `UPDATE ingest_job SET ${sets.join(', ')} WHERE id = $1`
  pool.query(sql, [id, ...vals]).catch((err) => dbWarn((err as Error).message))
}

function evictIfNeeded() {
  if (jobs.size <= MAX_JOBS) return
  // 按 updatedAt 删最老的
  const sorted = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt)
  const toDrop = sorted.slice(0, jobs.size - MAX_JOBS)
  for (const j of toDrop) jobs.delete(j.id)
}

export function createJob(input: CreateJobInput): JobRecord {
  const id = randomUUID()
  const now = Date.now()
  const job: JobRecord = {
    id,
    kind: input.kind,
    name: input.name,
    space: input.space,
    sourceId: input.sourceId,
    tags: input.tags ?? [],
    strategy: input.strategy ?? 'heading',
    vectorize: input.vectorize ?? true,
    phase: 'pending',
    progress: 0,
    startedAt: now,
    updatedAt: now,
    log: [{ at: now, level: 'info', phase: 'pending', msg: `任务已创建 · ${input.kind}` }],
    preview: {},
    createdBy: input.createdBy ?? 'system',
  }
  jobs.set(id, job)
  evictIfNeeded()
  dbInsertJob(job)
  return job
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id)
}

export function listJobs(opts: { limit?: number; includeFinished?: boolean } = {}): JobRecord[] {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50))
  const includeFinished = opts.includeFinished !== false
  const all = [...jobs.values()]
  const filtered = all.filter((j) => includeFinished || (j.phase !== 'done' && j.phase !== 'failed'))
  return filtered
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export function updatePhase(id: string, phase: JobPhase, msg?: string): JobRecord | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  job.phase = phase
  job.progress = PHASE_WEIGHT[phase] ?? job.progress
  job.updatedAt = Date.now()
  if (phase === 'done' || phase === 'failed') {
    job.finishedAt = job.updatedAt
  }
  if (msg) appendLog(id, phase === 'failed' ? 'error' : 'info', phase, msg)
  dbUpdateJob(id, {
    phase,
    progress: job.progress,
    log: job.log,
    finishedAt: job.finishedAt,
  })
  return job
}

export function setProgress(id: string, percent: number): void {
  const job = jobs.get(id)
  if (!job) return
  job.progress = Math.max(0, Math.min(100, percent))
  job.updatedAt = Date.now()
  dbUpdateJob(id, { progress: job.progress })
}

export function appendLog(
  id: string,
  level: JobLogEntry['level'],
  phase: JobPhase,
  msg: string,
): void {
  const job = jobs.get(id)
  if (!job) return
  job.log.push({ at: Date.now(), level, phase, msg })
  if (job.log.length > MAX_LOG_PER_JOB) {
    job.log = job.log.slice(-MAX_LOG_PER_JOB)
  }
  job.updatedAt = Date.now()
  dbUpdateJob(id, { log: job.log })
}

export function fail(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.phase = 'failed'
  job.error = error
  job.updatedAt = Date.now()
  job.finishedAt = job.updatedAt
  appendLog(id, 'error', 'failed', error)
  dbUpdateJob(id, {
    phase: 'failed',
    error,
    finishedAt: job.finishedAt,
    log: job.log,
  })
}

export function finish(id: string, result: { assetId?: number; chunkCount?: number }): void {
  const job = jobs.get(id)
  if (!job) return
  job.phase = 'done'
  job.progress = 100
  job.updatedAt = Date.now()
  job.finishedAt = job.updatedAt
  if (result.assetId != null) job.assetId = result.assetId
  if (result.chunkCount != null) job.chunkCount = result.chunkCount
  appendLog(id, 'info', 'done', `完成：asset_id=${result.assetId ?? '?'} chunks=${result.chunkCount ?? 0}`)
  dbUpdateJob(id, {
    phase: 'done',
    progress: 100,
    assetId: result.assetId ?? null,
    finishedAt: job.finishedAt,
    log: job.log,
  })
}

export function mergePreview(id: string, patch: JobPreview): void {
  const job = jobs.get(id)
  if (!job) return
  job.preview = { ...job.preview, ...patch }
  job.updatedAt = Date.now()
  dbUpdateJob(id, { preview: job.preview })
}

export function pauseJob(id: string): JobRecord | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  if (job.phase === 'done' || job.phase === 'failed') return job
  job.phase = 'paused'
  job.updatedAt = Date.now()
  appendLog(id, 'warn', 'paused', '已请求暂停（注：当前流水线为同步执行，标记仅 UI 用）')
  return job
}

export function resetForRetry(id: string): JobRecord | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  job.phase = 'pending'
  job.progress = 0
  job.error = undefined
  job.finishedAt = undefined
  job.updatedAt = Date.now()
  appendLog(id, 'info', 'pending', '已请求重试')
  return job
}

/** 测试辅助 */
export function __resetJobsForTest(): void {
  jobs.clear()
}

// ── ingest-async-pipeline · 跨重启的 DB 行 → 内存 rehydration ─────────────────

/**
 * 从 ingest_job 表里拉的一行重建内存 JobRecord（不再 INSERT DB，仅 upsert 内存缓存）。
 *
 * Worker 认领 job 后调用：让随后的 `updatePhase` / `finish` / `fail` / `appendLog`
 * 走统一 jobRegistry API，既更新内存缓存（供同进程内读路径使用）也更新 DB 行
 * （供 SSE / /api/ingest/jobs 查询使用）。
 */
export function adoptJob(dbRow: {
  id: string
  kind: JobKind
  source_id: number | null
  name: string
  input_payload: Record<string, unknown> | null
  status: string
  phase: string
  progress: number
  log: unknown
  preview: unknown
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  finished_at: Date | string | null
  asset_id: number | null
  error: string | null
}): JobRecord {
  const payload = (dbRow.input_payload ?? {}) as Record<string, unknown>
  const logArr = Array.isArray(dbRow.log) ? (dbRow.log as JobLogEntry[]) : []
  const preview = (dbRow.preview && typeof dbRow.preview === 'object' ? dbRow.preview : {}) as JobPreview
  const phase = (isJobPhase(dbRow.phase) ? dbRow.phase : 'pending') as JobPhase
  const now = Date.now()
  const job: JobRecord = {
    id: dbRow.id,
    kind: dbRow.kind,
    name: dbRow.name,
    space: typeof payload.space === 'string' ? payload.space : '',
    sourceId: dbRow.source_id ?? 0,
    tags: Array.isArray(payload.tags) ? payload.tags as string[] : [],
    strategy: typeof payload.strategy === 'string' ? payload.strategy : 'heading',
    vectorize: typeof payload.vectorize === 'boolean' ? payload.vectorize : true,
    phase,
    progress: Math.max(0, Math.min(100, Number(dbRow.progress) || 0)),
    startedAt: new Date(dbRow.created_at).getTime(),
    updatedAt: new Date(dbRow.updated_at).getTime() || now,
    finishedAt: dbRow.finished_at ? new Date(dbRow.finished_at).getTime() : undefined,
    error: dbRow.error ?? undefined,
    assetId: dbRow.asset_id ?? undefined,
    log: logArr,
    preview,
    createdBy: dbRow.created_by,
  }
  jobs.set(job.id, job)
  evictIfNeeded()
  return job
}

function isJobPhase(s: string): s is JobPhase {
  return s === 'pending' || s === 'parse' || s === 'ocr' || s === 'table'
      || s === 'chunk' || s === 'tag' || s === 'embed'
      || s === 'done' || s === 'failed' || s === 'paused'
}
