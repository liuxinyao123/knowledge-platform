/**
 * services/fileSource/lock.ts —— 单 source 串行的内存锁
 *
 * 约束：同 sourceId 的重入调用复用现有 Promise，不阻塞调用方、不排队。
 * 多 sourceId 独立并行。
 */

const inFlight = new Map<number, Promise<unknown>>()

export function withSourceLock<T>(sourceId: number, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(sourceId)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => {
    if (inFlight.get(sourceId) === p) inFlight.delete(sourceId)
  })
  inFlight.set(sourceId, p)
  return p
}

export function isScanRunning(sourceId: number): boolean {
  return inFlight.has(sourceId)
}

/** 仅测试用：清空锁表 */
export function __resetLocksForTest(): void {
  inFlight.clear()
}
