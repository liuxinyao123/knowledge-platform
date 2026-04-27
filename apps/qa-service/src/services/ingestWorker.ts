/**
 * services/ingestWorker.ts —— 异步 ingest 任务消费者
 *
 * 契约：openspec/changes/ingest-async-pipeline/{proposal,design,specs}.md
 *
 * 职责：
 *   1. `setInterval` 周期轮询 `ingest_job` 表的 queued 行
 *   2. 用 `SELECT ... FOR UPDATE SKIP LOCKED` 原子认领一行并置为 in_progress
 *   3. 并发上限 `INGEST_WORKER_CONCURRENCY`（默认 2）
 *   4. 读 bytes_ref → 组装 IngestInput → 调 ingestDocument（传 progress 回调 hook 到 jobRegistry）
 *   5. 成功/失败/取消分别走 finish / fail / cancelled 分支；tmp 文件统一清理
 *   6. 优雅关停：stop() 停止认领新 job，等 in_progress 至多 `SHUTDOWN_GRACE_MS`；超时把未完成
 *      的行回滚为 queued（下次进程启动会重新认领）
 *
 * 进程重启恢复：index.ts 在调用 startIngestWorker 前应先把前次进程留下的 in_progress 行
 * 批量回滚为 queued（design.md §启动 hook）。
 */
import { promises as fs } from 'node:fs'
import { getPgPool } from './pgDb.ts'
import { adoptJob, updatePhase, finish, fail, appendLog, type JobPhase } from './jobRegistry.ts'
import { ingestDocument, type IngestInput } from './ingestPipeline/index.ts'

// ── 可配置参数 ────────────────────────────────────────────────────────────────
const DEFAULT_INTERVAL_MS    = Number(process.env.INGEST_WORKER_INTERVAL_MS ?? 500)
const DEFAULT_CONCURRENCY    = Math.max(1, Number(process.env.INGEST_WORKER_CONCURRENCY ?? 2))
const SHUTDOWN_GRACE_MS      = Number(process.env.INGEST_WORKER_SHUTDOWN_GRACE_MS ?? 30_000)
const CANCEL_POLL_INTERVAL_MS = 1_000 // 在 job 运行中每 1s 查一次 status 是否被改成 cancelled

export interface IngestWorkerOptions {
  intervalMs?: number
  concurrency?: number
  /** 可传入外部 AbortSignal 联动整体停机；内部也会处理 SIGTERM */
  signal?: AbortSignal
}

export interface IngestWorkerHandle {
  stop(): Promise<void>
  stats(): IngestWorkerStats
  /** 测试用：强制立即跑一次 tick，不等定时器 */
  __tickForTest(): Promise<void>
}

export interface IngestWorkerStats {
  running: number
  picked: number
  failed: number
  succeeded: number
  cancelled: number
}

// ── 内部 ──────────────────────────────────────────────────────────────────────

// 2026-04-25 unblock dev: parameter property 改显式字段（ADR-37 纪律）
class JobCancelledError extends Error {
  readonly jobId: string
  constructor(jobId: string) {
    super(`ingest_job ${jobId} cancelled`)
    this.name = 'JobCancelledError'
    this.jobId = jobId
  }
}

interface ClaimedRow {
  id: string
  kind: 'upload' | 'fetch-url' | 'conversation' | 'batch' | 'scan-folder' | 'abstract'
  source_id: number | null
  name: string
  bytes_ref: string | null
  input_payload: Record<string, unknown> | null
  status: string
  phase: string
  progress: number
  log: unknown
  preview: unknown
  created_by: string
  created_at: Date
  updated_at: Date
  finished_at: Date | null
  asset_id: number | null
  error: string | null
}

/** 原子认领一行 queued → in_progress；无可认领则返回 undefined */
async function claimOne(): Promise<ClaimedRow | undefined> {
  const pool = getPgPool()
  const { rows } = await pool.query<ClaimedRow>(
    `UPDATE ingest_job
        SET status = 'in_progress',
            phase = 'parse',
            phase_started_at = NOW(),
            updated_at = NOW()
      WHERE id = (
        SELECT id FROM ingest_job
          WHERE status = 'queued'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
      )
      RETURNING id, kind, source_id, name, bytes_ref, input_payload,
                status, phase, progress, log, preview, created_by,
                created_at, updated_at, finished_at, asset_id, error`,
  )
  return rows[0]
}

/** 查询当前 status；用于运行中的取消检测 */
async function readStatus(jobId: string): Promise<string | undefined> {
  const pool = getPgPool()
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM ingest_job WHERE id = $1`,
    [jobId],
  )
  return rows[0]?.status
}

/** Worker 退出时把仍 in_progress 的行批量回滚为 queued */
async function rollbackInProgress(): Promise<number> {
  const pool = getPgPool()
  const { rowCount } = await pool.query(
    `UPDATE ingest_job
        SET status = 'queued',
            phase = 'pending',
            phase_started_at = NULL,
            progress = 0,
            updated_at = NOW()
      WHERE status = 'in_progress'`,
  )
  return rowCount ?? 0
}

/** 清理 bytes_ref 指向的 tmp 文件（best-effort） */
async function cleanupBytesRef(bytesRef: string | null | undefined): Promise<void> {
  if (!bytesRef) return
  try {
    await fs.unlink(bytesRef)
  } catch {
    // 文件可能已被清理或 OS 重启后不存在；忽略
  }
}

/** 把 DB 行 → 可跑的 IngestInput（读 bytes_ref、还原 opts） */
async function hydrateInput(row: ClaimedRow): Promise<IngestInput> {
  if (!row.bytes_ref) {
    throw new Error('bytes_ref missing — enqueue 阶段写入失败或 tmp 已被清理')
  }
  const buffer = await fs.readFile(row.bytes_ref)
  const payload = (row.input_payload ?? {}) as Record<string, unknown>
  return {
    buffer,
    name: row.name,
    sourceId: row.source_id ?? 0,
    principal: undefined, // 异步入口已在 enqueue 时做完 enforceAcl；此处不再携带
    opts: (payload.opts && typeof payload.opts === 'object'
      ? payload.opts as IngestInput['opts']
      : undefined),
  }
}

/** 跑一个 job 的主逻辑；失败/取消由上层 catch 统一处理 */
async function runOne(row: ClaimedRow, signal: AbortSignal): Promise<void> {
  // 1) 把 DB 行 rehydrate 到 jobRegistry 内存缓存
  adoptJob(row)

  // 2) 取消检测定时器：每 1s 轮询 status，若变 cancelled 则 abort
  const ac = new AbortController()
  const signalListener = () => ac.abort()
  signal.addEventListener('abort', signalListener, { once: true })

  const cancelPoll = setInterval(async () => {
    try {
      const s = await readStatus(row.id)
      if (s === 'cancelled') ac.abort()
    } catch {
      // 读失败忽略；下次再查
    }
  }, CANCEL_POLL_INTERVAL_MS)

  const throwIfAborted = () => {
    if (ac.signal.aborted) throw new JobCancelledError(row.id)
  }

  try {
    // ingest-l0-abstract（ADR-32 候选）：kind='abstract' 不读 bytes，只跑 generateAbstractsForChunks
    if (row.kind === 'abstract') {
      const payload = (row.input_payload ?? {}) as Record<string, unknown>
      const ids = Array.isArray(payload.chunk_ids)
        ? (payload.chunk_ids as unknown[]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
        : []
      throwIfAborted()
      updatePhase(row.id, 'abstract', `backfill ${ids.length} chunks`)
      const { generateAbstractsForChunks } = await import('./ingestPipeline/abstract.ts')
      const c = await generateAbstractsForChunks(ids, getPgPool())
      throwIfAborted()
      appendLog(row.id, 'info', 'abstract',
        `generated=${c.generated} failed=${c.failed} skipped=${c.skipped}`)
      // abstract 任务无 asset_id 产物；用 -1 占位标记
      finish(row.id, { assetId: -1, chunkCount: c.generated })
      return
    }

    // 3) 读 bytes + 组装 input
    const input = await hydrateInput(row)
    throwIfAborted()

    // 4) 跑 ingestDocument，progress 回调 → jobRegistry.updatePhase（自动回写 DB）
    const out = await ingestDocument(input, (ev) => {
      // 映射 pipeline phase → jobRegistry JobPhase
      const jp: JobPhase = ev.phase === 'done' ? 'done' : (ev.phase as JobPhase)
      throwIfAborted()
      updatePhase(row.id, jp, ev.msg)
    })

    throwIfAborted()

    // 5) 成功收尾
    finish(row.id, { assetId: out.assetId, chunkCount: out.chunks.l1 + out.chunks.l3 })
  } finally {
    clearInterval(cancelPoll)
    signal.removeEventListener('abort', signalListener)
    // 无论成败都清理 tmp
    await cleanupBytesRef(row.bytes_ref)
  }
}

// ── 对外 API ──────────────────────────────────────────────────────────────────

export function startIngestWorker(opts: IngestWorkerOptions = {}): IngestWorkerHandle {
  const intervalMs  = opts.intervalMs  ?? DEFAULT_INTERVAL_MS
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)

  let stopping = false
  const running = new Set<string>() // job IDs currently executing
  const stats: IngestWorkerStats = {
    running: 0, picked: 0, succeeded: 0, failed: 0, cancelled: 0,
  }

  const ac = new AbortController()
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort()
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  async function tick(): Promise<void> {
    if (stopping) return
    // 若当前并发未满，尝试认领（最多认领 N 条把并发窗口填满）
    const slots = concurrency - running.size
    for (let i = 0; i < slots; i++) {
      if (stopping) break
      let row: ClaimedRow | undefined
      try {
        row = await claimOne()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[ingestWorker] claim failed: ${(err as Error).message}`)
        return
      }
      if (!row) return // 无 queued 可认领

      stats.picked++
      running.add(row.id)
      stats.running = running.size

      // 异步执行，不阻塞 tick
      void (async () => {
        try {
          await runOne(row, ac.signal)
          stats.succeeded++
        } catch (err) {
          if (err instanceof JobCancelledError) {
            stats.cancelled++
            // cancelled 状态已由 DELETE 端点或外部写入；worker 只需把内存对齐
            appendLog(row!.id, 'warn', 'failed', 'job cancelled')
            // 注意不 call fail()（会覆盖 status 为 failed）；DB 上 status 已是 cancelled
          } else {
            stats.failed++
            const msg = (err as Error).message
            fail(row!.id, msg)
          }
        } finally {
          running.delete(row!.id)
          stats.running = running.size
        }
      })()
    }
  }

  const timer = setInterval(() => {
    tick().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[ingestWorker] tick error: ${(err as Error).message}`)
    })
  }, intervalMs)
  // 不阻塞 node event loop 退出（测试 / SIGTERM 友好）
  timer.unref?.()

  async function stop(): Promise<void> {
    if (stopping) return
    stopping = true
    clearInterval(timer)
    ac.abort()

    // 等 running set 清空，上限 SHUTDOWN_GRACE_MS
    const startedAt = Date.now()
    while (running.size > 0 && Date.now() - startedAt < SHUTDOWN_GRACE_MS) {
      await new Promise((r) => setTimeout(r, 100))
    }

    // 仍有未完成的 —— 回滚
    if (running.size > 0) {
      try {
        const n = await rollbackInProgress()
        // eslint-disable-next-line no-console
        console.warn(`[ingestWorker] forced rollback of ${n} in_progress jobs (grace exceeded)`)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[ingestWorker] rollback failed: ${(err as Error).message}`)
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`✓ ingest worker started · concurrency=${concurrency} · interval=${intervalMs}ms`)

  return {
    stop,
    stats: () => ({ ...stats }),
    __tickForTest: tick,
  }
}

// ── 启动恢复（由 index.ts 调） ────────────────────────────────────────────────

/**
 * 进程启动时调用：把前次进程异常退出遗留的 in_progress 行重置为 queued。
 * 与 design.md §崩溃恢复 一致。
 */
export async function resetInProgressJobs(): Promise<number> {
  return rollbackInProgress()
}
