/**
 * routes/ingestJobs.ts —— 入库任务队列 API
 *
 *   GET    /api/ingest/jobs               列出最近 N 个（内存 + DB 合并）
 *   GET    /api/ingest/jobs/:id           详情（含 log + preview + steps）
 *   GET    /api/ingest/jobs/:id/stream    SSE 订阅 job 进度（ingest-async-pipeline）
 *   POST   /api/ingest/jobs/:id/pause     标记暂停
 *   POST   /api/ingest/jobs/:id/retry     重置为 pending
 *
 * 所有端点 requireAuth；无 permission 门（跟 /api/ingest/recent 一致，普通用户能看）。
 *
 * ingest-async-pipeline（2026-04-24）：读路径支持 DB fallback —— 若内存 jobRegistry 没
 * 命中（worker 在本进程以外的时间创建 / 进程重启后），就去 `ingest_job` 表查，并顺便
 * 把结果 rehydrate 回内存缓存以便后续请求复用。
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../auth/index.ts'
import {
  listJobs, getJob, pauseJob, resetForRetry, adoptJob,
  PIPELINE_STEPS, type JobRecord, type JobPhase,
} from '../services/jobRegistry.ts'
import { getPgPool } from '../services/pgDb.ts'

export const ingestJobsRouter = Router()

ingestJobsRouter.use(requireAuth())

// ── DB 读回落 ────────────────────────────────────────────────────────────────

const JOB_SELECT_COLS = `
  id, kind, source_id, name, input_payload,
  status, phase, progress, log, preview, created_by,
  created_at, updated_at, finished_at, asset_id, error
`

async function dbGetJob(id: string): Promise<JobRecord | undefined> {
  try {
    const { rows } = await getPgPool().query(
      `SELECT ${JOB_SELECT_COLS} FROM ingest_job WHERE id = $1`,
      [id],
    )
    if (!rows[0]) return undefined
    return adoptJob(rows[0])
  } catch {
    return undefined
  }
}

async function dbListJobs(limit: number): Promise<JobRecord[]> {
  try {
    const { rows } = await getPgPool().query(
      `SELECT ${JOB_SELECT_COLS} FROM ingest_job
         ORDER BY created_at DESC
         LIMIT $1`,
      [limit],
    )
    return rows.map((r) => adoptJob(r))
  } catch {
    return []
  }
}

// ── 路由 ──────────────────────────────────────────────────────────────────────

ingestJobsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))
  const includeFinished = req.query.includeFinished !== 'false'

  // 读路径：DB 优先（真相源），降级到内存（DB 挂了仍可用）
  const dbRows = await dbListJobs(limit)
  const source = dbRows.length > 0 ? dbRows : listJobs({ limit, includeFinished })
  const filtered = includeFinished
    ? source
    : source.filter((j) => j.phase !== 'done' && j.phase !== 'failed')

  const items = filtered.slice(0, limit).map((j) => ({
    id: j.id,
    kind: j.kind,
    name: j.name,
    space: j.space,
    tags: j.tags,
    phase: j.phase,
    progress: j.progress,
    startedAt: j.startedAt,
    updatedAt: j.updatedAt,
    finishedAt: j.finishedAt,
    error: j.error,
    assetId: j.assetId,
    chunkCount: j.chunkCount,
  }))
  res.json({ items, total: items.length })
})

ingestJobsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id)
  let j = getJob(id) ?? await dbGetJob(id)
  if (!j) return res.status(404).json({ error: 'job not found' })
  res.json({
    job: j,
    steps: PIPELINE_STEPS.map((s) => ({
      id: s.id,
      label: s.label,
      status: phaseStepStatus(s.id, j!.phase),
    })),
  })
})

// ── SSE: /api/ingest/jobs/:id/stream ──────────────────────────────────────────
//
// 设计：server 每 250ms 轮询 DB，把 phase/progress/log 的增量推给客户端。
// 不走 PG LISTEN/NOTIFY（复杂度高 + 本期规模用不到）。
// keepalive 每 15s 发一次 `:ping`；done 后 server 主动关闭连接。
// 鉴权：createdBy 必须等于当前 principal.email（管理员也能看的细节留到后续 change）。

const SSE_POLL_MS = Number(process.env.INGEST_SSE_POLL_MS ?? 250)
const SSE_KEEPALIVE_MS = 15_000

ingestJobsRouter.get('/:id/stream', async (req: Request, res: Response) => {
  const id = String(req.params.id)
  const principal = req.principal
  const principalEmail = principal?.email ?? null

  const initial = getJob(id) ?? await dbGetJob(id)
  if (!initial) return res.status(404).json({ error: 'job not found' })

  // 鉴权：仅 owner 可订阅（Phase B MVP）；admin 绕行留给后续 change
  const isAdmin = Array.isArray(principal?.roles) && principal!.roles.includes('admin')
  if (!isAdmin && initial.createdBy && initial.createdBy !== 'system' && initial.createdBy !== principalEmail) {
    return res.status(403).json({ error: 'not the owner of this job' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // nginx 友好
  res.flushHeaders()

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // 首条：当前状态快照
  send('phase', {
    phase: initial.phase,
    progress: initial.progress,
    at: Date.now(),
  })
  if ((initial.log?.length ?? 0) > 0) {
    send('log', { tail: initial.log.slice(-10), at: Date.now() })
  }
  if (initial.preview && Object.keys(initial.preview).length > 0) {
    send('preview', initial.preview)
  }

  // 若已是终态，立即 done + 关闭
  if (initial.phase === 'done' || initial.phase === 'failed') {
    send('done', {
      ingest_status: initial.phase === 'done' ? 'indexed' : 'failed',
      asset_id: initial.assetId ?? null,
      error: initial.error ?? null,
    })
    return res.end()
  }

  // 轮询循环
  let lastPhase: JobPhase = initial.phase
  let lastProgress = initial.progress
  let lastLogLen = initial.log?.length ?? 0
  let lastKeepalive = Date.now()
  let stopped = false

  const interval = setInterval(async () => {
    if (stopped) return
    const now = Date.now()
    try {
      const cur = await dbGetJob(id) ?? getJob(id)
      if (!cur) {
        // 可能被删了或 DB 临时不可达；下次再试
        if (now - lastKeepalive >= SSE_KEEPALIVE_MS) {
          res.write(':ping\n\n')
          lastKeepalive = now
        }
        return
      }

      if (cur.phase !== lastPhase || cur.progress !== lastProgress) {
        send('phase', { phase: cur.phase, progress: cur.progress, at: now })
        lastPhase = cur.phase
        lastProgress = cur.progress
      }

      const curLogLen = cur.log?.length ?? 0
      if (curLogLen > lastLogLen) {
        const delta = cur.log.slice(lastLogLen)
        send('log', { tail: delta, at: now })
        lastLogLen = curLogLen
      }

      if (cur.preview && Object.keys(cur.preview).length > 0) {
        // 简易策略：终态前不强制 dedupe，前端可以幂等处理
        send('preview', cur.preview)
      }

      if (cur.phase === 'done' || cur.phase === 'failed') {
        send('done', {
          ingest_status: cur.phase === 'done' ? 'indexed' : 'failed',
          asset_id: cur.assetId ?? null,
          error: cur.error ?? null,
        })
        stopped = true
        clearInterval(interval)
        res.end()
        return
      }

      if (now - lastKeepalive >= SSE_KEEPALIVE_MS) {
        res.write(':ping\n\n')
        lastKeepalive = now
      }
    } catch {
      // 单次 tick 失败不终止订阅；下次再试
    }
  }, SSE_POLL_MS)

  req.on('close', () => {
    stopped = true
    clearInterval(interval)
  })
})

ingestJobsRouter.post('/:id/pause', (req: Request, res: Response) => {
  const j = pauseJob(String(req.params.id))
  if (!j) return res.status(404).json({ error: 'job not found' })
  res.json({ ok: true, job: j })
})

ingestJobsRouter.post('/:id/retry', (req: Request, res: Response) => {
  const j = resetForRetry(String(req.params.id))
  if (!j) return res.status(404).json({ error: 'job not found' })
  res.json({ ok: true, job: j, note: '已标记为 pending；真正的重试需由前端重新提交' })
})

function phaseStepStatus(stepId: string, currentPhase: string): 'done' | 'active' | 'pending' | 'failed' {
  if (currentPhase === 'failed') {
    const order = ['parse', 'ocr', 'table', 'chunk', 'tag', 'embed']
    const cur = order.indexOf(stepId)
    return cur < 0 ? 'pending' : 'failed'
  }
  if (currentPhase === 'done') return 'done'
  if (currentPhase === stepId) return 'active'
  const order = ['pending', 'parse', 'ocr', 'table', 'chunk', 'tag', 'embed', 'done']
  const cur = order.indexOf(currentPhase)
  const stepIdx = order.indexOf(stepId)
  if (cur < 0 || stepIdx < 0) return 'pending'
  return stepIdx < cur ? 'done' : 'pending'
}
