/**
 * ingestPipeline/abstractBackfill.ts —— ingest-l0-abstract change · lazy 回填入队
 *
 * ragPipeline rerank 阶段顺手把命中但缺 L0 的 chunk_id 列表打包成一条 ingest_job
 * （kind='abstract'）；ingestWorker 拿到后调 generateAbstractsForChunks。
 *
 * 默认关：`L0_LAZY_BACKFILL_ENABLED=false`。本模块永不抛，调用方 fire-and-forget。
 */

import { getPgPool } from '../pgDb.ts'
import { createJob } from '../jobRegistry.ts'
import { chunksMissingL0 } from '../l0Filter.ts'

const _lastWarnAt: Map<string, number> = new Map()
function warnOnce(tag: string, msg: string): void {
  const now = Date.now()
  const last = _lastWarnAt.get(tag) ?? 0
  if (now - last < 60_000) return
  _lastWarnAt.set(tag, now)
  // eslint-disable-next-line no-console
  console.warn(`[abstractBackfill] ${tag}: ${msg}`)
}

/**
 * 把 chunk_id 列表打包入队为一条 abstract job。
 *
 * 行为：
 *   1. flag 关 / 列表空 → 直接 resolve，不写 DB
 *   2. 过滤已经有 L0 的 chunk
 *   3. 用 jobRegistry.createJob 登记 ingest_job 一行 kind='abstract'
 *   4. 把 chunk_ids 写入 input_payload
 *
 * 永不抛；失败仅打 WARN。
 */
export async function enqueueAbstractBackfill(
  chunkIds: number[],
): Promise<{ enqueued: boolean; jobId?: string; missingCount: number }> {
  const v = (process.env.L0_LAZY_BACKFILL_ENABLED ?? '').toLowerCase().trim()
  const enabled = v === 'true' || v === '1' || v === 'on' || v === 'yes'
  if (!enabled) return { enqueued: false, missingCount: 0 }
  if (!chunkIds.length) return { enqueued: false, missingCount: 0 }

  try {
    const missing = await chunksMissingL0(chunkIds)
    if (missing.length === 0) return { enqueued: false, missingCount: 0 }

    // 用 createJob 登记一行（同步写入 DB + 内存缓存）
    const job = createJob({
      kind: 'abstract',
      name: `lazy-l0-backfill-${missing.length}`,
      space: '',
      sourceId: 0, // abstract job 不关联 source
      createdBy: 'lazy-backfill',
    })

    // 把 chunk_ids 塞进 input_payload；abstract worker 路径会读取
    await getPgPool().query(
      `UPDATE ingest_job SET input_payload = input_payload || $2::jsonb WHERE id = $1`,
      [job.id, JSON.stringify({ chunk_ids: missing })],
    )

    return { enqueued: true, jobId: job.id, missingCount: missing.length }
  } catch (err) {
    warnOnce('enqueue:err', (err as Error).message)
    return { enqueued: false, missingCount: 0 }
  }
}
