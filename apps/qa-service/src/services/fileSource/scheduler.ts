/**
 * services/fileSource/scheduler.ts —— 进程内 cron 调度
 *
 * 生命周期：
 *   boot 时调 `bootScheduler()` 把所有 enabled + cron != '@manual' 的 source 排期
 *   PATCH /:id 改 cron/enabled → `rescheduleOne(id)`
 *   DELETE /:id 或 enabled=false → `unschedule(id)`
 *   SIGTERM → `abortAllScans()`
 */
import { createRequire } from 'node:module'
import { getPgPool } from '../pgDb.ts'
import { runScan } from './index.ts'

// 动态加载 node-cron；未安装时 scheduler 不启动，但其它功能不受影响
type CronTask = { start: () => void; stop: () => void }
type CronModule = {
  schedule: (expr: string, fn: () => void | Promise<void>) => CronTask
  validate: (expr: string) => boolean
}
let cron: CronModule | null = null
function loadCron(): CronModule | null {
  if (cron) return cron
  try {
    const req = createRequire(import.meta.url)
    cron = req('node-cron') as CronModule
    return cron
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[fileSource] node-cron not installed; scheduler disabled（手动扫仍可用）')
    return null
  }
}

const scheduled = new Map<number, CronTask>()
const controllers = new Map<number, AbortController>()

export async function bootScheduler(): Promise<void> {
  const pool = getPgPool()
  const { rows } = await pool.query<{ id: number; cron: string; enabled: boolean }>(
    `SELECT id, cron, enabled FROM metadata_file_source WHERE enabled = true AND cron <> '@manual'`,
  )
  let n = 0
  for (const r of rows) {
    if (scheduleOne(r.id, r.cron)) n++
  }
  // eslint-disable-next-line no-console
  console.log(`✓ file-source scheduler: ${n}/${rows.length} sources scheduled`)
}

export function rescheduleOne(sourceId: number, newCron: string, enabled: boolean): void {
  unschedule(sourceId)
  if (enabled && newCron !== '@manual') scheduleOne(sourceId, newCron)
}

export function unschedule(sourceId: number): void {
  const t = scheduled.get(sourceId)
  if (t) { try { t.stop() } catch { /* ignore */ } }
  scheduled.delete(sourceId)
}

export function abortAllScans(): void {
  for (const [, ac] of controllers) ac.abort()
  controllers.clear()
  for (const [, t] of scheduled) { try { t.stop() } catch { /* ignore */ } }
  scheduled.clear()
}

function scheduleOne(sourceId: number, expr: string): boolean {
  const c = loadCron()
  if (!c) return false
  if (!c.validate(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[fileSource] invalid cron for source ${sourceId}: ${expr}; skipped`)
    return false
  }
  const task = c.schedule(expr, async () => {
    // 同源串行由 lock.ts 兜底
    const ac = new AbortController()
    controllers.set(sourceId, ac)
    try {
      await runScan(sourceId, ac.signal)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[fileSource] scan failed for ${sourceId}: ${(err as Error).message}`)
    } finally {
      if (controllers.get(sourceId) === ac) controllers.delete(sourceId)
    }
  })
  scheduled.set(sourceId, task)
  return true
}
