/**
 * __tests__/ingestWorker.test.ts —— ingest-async-pipeline 的 worker 行为单测
 *
 * 不跑真实 PG：用一个 fake pool，按 SQL 模式匹配返回预置行。
 * 不跑真实 ingestDocument：vi.mock 掉整个 ingestPipeline/index.ts。
 * 验证重点：
 *   1. resetInProgressJobs 把 in_progress → queued
 *   2. worker tick 认领 queued 行 → adoptJob → runPipeline → finish（状态 indexed）
 *   3. concurrency 上限：10 个 queued + concurrency=1 时任意时刻 running ≤ 1
 *   4. cancel 检测：runOne 执行中 status 被外部改 cancelled → JobCancelledError → 计数 ++，不标 failed
 *   5. stop() grace 超时回滚 in_progress
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── fake DB 状态 ─────────────────────────────────────────────────────────────
// 模拟 ingest_job 表；worker 对它做 SELECT/UPDATE
interface FakeJobRow {
  id: string
  kind: 'upload'
  source_id: number
  name: string
  bytes_ref: string | null
  input_payload: Record<string, unknown>
  status: 'queued' | 'in_progress' | 'indexed' | 'failed' | 'cancelled'
  phase: string
  progress: number
  log: unknown[]
  preview: Record<string, unknown>
  created_by: string
  created_at: Date
  updated_at: Date
  finished_at: Date | null
  asset_id: number | null
  error: string | null
}

const fakeJobs = new Map<string, FakeJobRow>()

function makeRow(id: string, status: FakeJobRow['status'] = 'queued'): FakeJobRow {
  return {
    id, kind: 'upload', source_id: 1, name: `${id}.txt`,
    bytes_ref: `/tmp/ingest-${id}`,
    input_payload: {},
    status, phase: status === 'queued' ? 'pending' : 'parse', progress: 0,
    log: [], preview: {}, created_by: 'tester',
    created_at: new Date(), updated_at: new Date(),
    finished_at: null, asset_id: null, error: null,
  }
}

// 认领计数，供并发断言用
let pickedIds: string[] = []

const fakePool = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    // 1) 认领一行（UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED ...)）
    if (/UPDATE ingest_job\s+SET status = 'in_progress'/.test(sql)) {
      // 取第一个 queued 的行
      const first = [...fakeJobs.values()].find((r) => r.status === 'queued')
      if (!first) return { rows: [], rowCount: 0 }
      first.status = 'in_progress'
      first.phase = 'parse'
      first.updated_at = new Date()
      pickedIds.push(first.id)
      return { rows: [{ ...first }], rowCount: 1 }
    }
    // 2) 批量 in_progress → queued 回滚（resetInProgressJobs 与 stop() 超时用）
    if (/UPDATE ingest_job\s+SET status = 'queued'/.test(sql)) {
      let n = 0
      for (const r of fakeJobs.values()) {
        if (r.status === 'in_progress') {
          r.status = 'queued'; r.phase = 'pending'; r.progress = 0
          n++
        }
      }
      return { rows: [], rowCount: n }
    }
    // 3) readStatus: SELECT status FROM ingest_job WHERE id = $1
    if (/^SELECT status FROM ingest_job WHERE id = \$1/.test(sql)) {
      const row = fakeJobs.get(String(params[0]))
      return { rows: row ? [{ status: row.status }] : [] }
    }
    // 4) 各种 INSERT ingest_job ON CONFLICT DO NOTHING（jobRegistry.dbInsertJob）
    if (/^INSERT INTO ingest_job/.test(sql)) {
      // 参数顺序：[id, kind, source_id, name, payload, status, phase, progress, log, preview, created_by]
      const id = String(params[0])
      if (!fakeJobs.has(id)) {
        fakeJobs.set(id, {
          id, kind: 'upload', source_id: Number(params[2]),
          name: String(params[3]), bytes_ref: null,
          input_payload: JSON.parse(String(params[4])),
          status: String(params[5]) as FakeJobRow['status'],
          phase: String(params[6]), progress: Number(params[7]),
          log: JSON.parse(String(params[8])), preview: JSON.parse(String(params[9])),
          created_by: String(params[10]),
          created_at: new Date(), updated_at: new Date(),
          finished_at: null, asset_id: null, error: null,
        })
      }
      return { rows: [], rowCount: 1 }
    }
    // 5) UPDATE ingest_job SET updated_at=NOW(), ... WHERE id=$1 (dbUpdateJob)
    if (/^UPDATE ingest_job SET updated_at/.test(sql)) {
      const row = fakeJobs.get(String(params[0]))
      if (!row) return { rows: [], rowCount: 0 }
      // 用简单解析：顺序参照 dbUpdateJob 内部 push 顺序
      // 不强求字段顺序一致，解析到什么改什么
      const cols = sql.match(/\b(phase|status|phase_started_at|progress|error|asset_id|log|preview|finished_at)\s*=\s*\$(\d+)/g)
      if (cols) {
        for (const c of cols) {
          const m = c.match(/(\w+)\s*=\s*\$(\d+)/)!
          const col = m[1]
          const idx = Number(m[2]) - 1
          const v = params[idx]
          if (col === 'phase') row.phase = String(v)
          else if (col === 'status') row.status = v as FakeJobRow['status']
          else if (col === 'progress') row.progress = Number(v)
          else if (col === 'error') row.error = v == null ? null : String(v)
          else if (col === 'asset_id') row.asset_id = v == null ? null : Number(v)
          else if (col === 'finished_at') row.finished_at = v ? new Date(v as string | Date) : null
          else if (col === 'log') {
            try { row.log = JSON.parse(String(v)) } catch { /* ignore */ }
          }
          else if (col === 'preview') {
            try { row.preview = JSON.parse(String(v)) } catch { /* ignore */ }
          }
        }
      }
      row.updated_at = new Date()
      return { rows: [], rowCount: 1 }
    }
    // 默认
    return { rows: [], rowCount: 0 }
  }),
}

vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => fakePool,
}))

// 不走真实 extractor 与 pipeline
vi.mock('../services/ingestPipeline/index.ts', async () => {
  return {
    ingestDocument: vi.fn(async (input: { name: string }, progress?: (e: unknown) => void) => {
      // 调用几次 progress 模拟阶段推进
      progress?.({ phase: 'chunk', progress: 60, msg: 'chunking' })
      progress?.({ phase: 'tag', progress: 75, msg: 'tagging' })
      progress?.({ phase: 'done', progress: 100, msg: 'all done' })
      return {
        assetId: 999,
        chunks: { l1: 1, l2: 0, l3: 3 },
        structuredChunks: 4,
        images: { total: 0, withCaption: 0 },
        tags: [],
        extractorId: 'pdf' as const,
        warnings: undefined,
      }
    }),
  }
})

// fs.readFile 绕过（bytes_ref 路径不真实）
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    promises: {
      ...real.promises,
      readFile: vi.fn(async () => Buffer.from('x')),
      unlink: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
    },
  }
})

// 导入被测代码（必须在 mocks 之后）
import {
  startIngestWorker,
  resetInProgressJobs,
} from '../services/ingestWorker.ts'
import { __resetJobsForTest } from '../services/jobRegistry.ts'

function uuid(label: string) { return `00000000-0000-4000-8000-${label.padStart(12, '0')}` }

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

describe('ingestWorker', () => {
  beforeEach(() => {
    fakeJobs.clear()
    pickedIds = []
    __resetJobsForTest()
    fakePool.query.mockClear()
  })

  afterEach(async () => {
    // 清净
    fakeJobs.clear()
    pickedIds = []
  })

  it('resetInProgressJobs rolls back stale in_progress rows to queued', async () => {
    fakeJobs.set(uuid('01'), { ...makeRow(uuid('01'), 'in_progress') })
    fakeJobs.set(uuid('02'), { ...makeRow(uuid('02'), 'in_progress') })
    fakeJobs.set(uuid('03'), { ...makeRow(uuid('03'), 'indexed') })

    const n = await resetInProgressJobs()
    expect(n).toBe(2)
    expect(fakeJobs.get(uuid('01'))!.status).toBe('queued')
    expect(fakeJobs.get(uuid('02'))!.status).toBe('queued')
    expect(fakeJobs.get(uuid('03'))!.status).toBe('indexed')
  })

  it('claims a queued job, runs pipeline, finishes as indexed', async () => {
    fakeJobs.set(uuid('10'), { ...makeRow(uuid('10'), 'queued') })

    const handle = startIngestWorker({ intervalMs: 10_000, concurrency: 1 })
    // 不等定时器，直接 tick
    await handle.__tickForTest()
    // 等异步执行（ingestDocument mock 是立即 resolve 的）
    await sleep(50)
    await handle.stop()

    const row = fakeJobs.get(uuid('10'))!
    expect(row.status).toBe('indexed')
    expect(row.asset_id).toBe(999)
    expect(handle.stats().succeeded).toBeGreaterThanOrEqual(1)
  })

  it('respects concurrency upper bound', async () => {
    // 5 个 queued
    for (let i = 0; i < 5; i++) fakeJobs.set(uuid(String(i)), { ...makeRow(uuid(String(i)), 'queued') })

    const handle = startIngestWorker({ intervalMs: 10_000, concurrency: 2 })

    // 手动循环 tick 直到所有 queued + in_progress 清空。
    // __tickForTest 只认领"当前空闲 slot"，fire-and-forget 的 runOne 需要微秒级让出控制权后
    // running.size 才会减；所以每次 tick 后要 sleep 一下让微任务跑完。
    let maxObservedRunning = 0
    for (let iter = 0; iter < 30; iter++) {
      await handle.__tickForTest()
      maxObservedRunning = Math.max(maxObservedRunning, handle.stats().running)
      await sleep(20)
      const pending = [...fakeJobs.values()].filter(
        (r) => r.status === 'queued' || r.status === 'in_progress',
      )
      if (pending.length === 0) break
    }
    await handle.stop()

    // 关键断言：任何时刻都没超出 concurrency 上限
    expect(maxObservedRunning).toBeLessThanOrEqual(2)
    // 最终 5 个都应 indexed
    const indexed = [...fakeJobs.values()].filter((r) => r.status === 'indexed')
    expect(indexed.length).toBe(5)
    // 总认领数 = 5（没有遗漏）
    expect(handle.stats().picked).toBe(5)
  }, 10_000)

  it('detects external cancellation: status flips to cancelled mid-run → counted as cancelled, not failed', async () => {
    const id = uuid('aa')
    fakeJobs.set(id, { ...makeRow(id, 'queued') })

    // ingestDocument 的 mock 覆盖为"慢任务"，期间我们把 status 改 cancelled
    const { ingestDocument } = await import('../services/ingestPipeline/index.ts')
    vi.mocked(ingestDocument).mockImplementationOnce(async (_input, progress) => {
      progress?.({ phase: 'chunk', progress: 60 })
      // 外部改 status
      fakeJobs.get(id)!.status = 'cancelled'
      // 等到 cancel 轮询（1s）触发 abort（测试里 CANCEL_POLL_INTERVAL 是硬编码 1_000）
      // 为了不让测试太慢，直接等 1.2s
      await sleep(1200)
      // 此时 progress 回调会被 adopt→updatePhase 连带抛 JobCancelledError（由于 throwIfAborted）
      progress?.({ phase: 'tag', progress: 75 })
      return {
        assetId: 1, chunks: { l1: 0, l2: 0, l3: 0 }, structuredChunks: 0,
        images: { total: 0, withCaption: 0 }, tags: [],
        extractorId: 'pdf' as const, warnings: undefined,
      }
    })

    const handle = startIngestWorker({ intervalMs: 10_000, concurrency: 1 })
    await handle.__tickForTest()
    // 给足时间让 cancel poll 检测到（CANCEL_POLL_INTERVAL_MS=1000）
    await sleep(1500)
    await handle.stop()

    expect(handle.stats().cancelled).toBeGreaterThanOrEqual(1)
    expect(handle.stats().failed).toBe(0)
    // DB 里 status 保持 cancelled，未被 worker 改成 failed
    expect(fakeJobs.get(id)!.status).toBe('cancelled')
  }, 10_000)

  it('stop() grace-timeouts and rolls back hanging in_progress jobs (fake timers)', async () => {
    // ingest-async-pipeline (ADR-40 §Follow-up #6 · 2026-04-25)：
    // 用 vi.useFakeTimers 精确验证 SHUTDOWN_GRACE_MS（30s 默认）超时后强制回滚 in_progress 行。
    // 不再依赖 env 覆盖（模块顶层 const 早已固化为 30_000）。
    vi.useFakeTimers({ shouldAdvanceTime: false })

    const id = uuid('bb')
    fakeJobs.set(id, { ...makeRow(id, 'queued') })

    const { ingestDocument } = await import('../services/ingestPipeline/index.ts')
    // 永不 resolve，模拟卡死的 pipeline
    vi.mocked(ingestDocument).mockImplementationOnce(() => new Promise<never>(() => {}))

    const handle = startIngestWorker({ intervalMs: 10_000, concurrency: 1 })
    await handle.__tickForTest()
    // 让 fire-and-forget 的 runOne 把 row 标 in_progress 并进入 ingestDocument 永挂状态
    await vi.advanceTimersByTimeAsync(10)
    expect(handle.stats().running).toBe(1)
    expect(fakeJobs.get(id)!.status).toBe('in_progress')

    // 触发 stop —— 内部 while 循环每 100ms tick，最长跑到 SHUTDOWN_GRACE_MS=30_000ms
    const stopP = handle.stop()
    // fast-forward 31s 让 grace 过期
    await vi.advanceTimersByTimeAsync(31_000)
    await stopP

    // grace 超时强制 rollback：行从 in_progress 回到 queued
    expect(fakeJobs.get(id)!.status).toBe('queued')
    expect(fakeJobs.get(id)!.phase).toBe('pending')
    expect(fakeJobs.get(id)!.progress).toBe(0)

    vi.useRealTimers()
  }, 10_000)
})
