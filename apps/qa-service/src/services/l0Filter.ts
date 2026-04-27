/**
 * l0Filter.ts —— ingest-l0-abstract change · RAG 粗筛阶段
 *
 * 在 retrieveInitial 之前可选地用 chunk_abstract.l0_embedding 做 ANN 粗筛，
 * 返回 candidate asset_id 列表，注入 retrieveInitial({assetIds}) 收窄范围。
 *
 * 三种返回值契约（ragPipeline 调用方据此分派）：
 *   undefined → flag 关 / 表空 / 失败 → 走原路径，不 emit
 *   []        → 表非空但 0 命中 → emit warn 走原路径
 *   [n,m,...] → 命中 → 注入 retrieveInitial 并 emit 进度
 *
 * 默认 L0_FILTER_ENABLED=false，eval 通过才打开。
 */

import { getPgPool } from './pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from './embeddings.ts'
import type { EmitFn } from '../ragTypes.ts'

const _lastWarnAt: Map<string, number> = new Map()
function warnOnce(tag: string, msg: string): void {
  const now = Date.now()
  const last = _lastWarnAt.get(tag) ?? 0
  if (now - last < 60_000) return
  _lastWarnAt.set(tag, now)
  // eslint-disable-next-line no-console
  console.warn(`[l0Filter] ${tag}: ${msg}`)
}

export function isL0FilterEnabled(): boolean {
  const v = (process.env.L0_FILTER_ENABLED ?? '').toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'on' || v === 'yes'
}

export function isLazyBackfillEnabled(): boolean {
  const v = (process.env.L0_LAZY_BACKFILL_ENABLED ?? '').toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'on' || v === 'yes'
}

function readTopAssets(): number {
  const n = Number(process.env.L0_FILTER_TOP_ASSETS ?? 50)
  return Number.isFinite(n) && n >= 1 && n <= 500 ? Math.floor(n) : 50
}

export interface CoarseFilterOpts {
  /** 限定到指定 source_ids（spaceId 已被 caller 解析） */
  sourceIds?: number[]
  /** 覆盖默认 top assets */
  topAssets?: number
}

/**
 * L0 粗筛：返回 distinct asset_id 列表（按 cosine 距离从近到远）。
 *
 * 永不抛：任何错误都返回 undefined，调用方走原路径。
 */
export async function coarseFilterByL0(
  question: string,
  emit: EmitFn,
  opts: CoarseFilterOpts = {},
): Promise<number[] | undefined> {
  if (!isL0FilterEnabled()) return undefined
  if (!question.trim()) return undefined
  if (!isEmbeddingConfigured()) return undefined

  const top = opts.topAssets ?? readTopAssets()
  const pool = getPgPool()

  try {
    // 表空快速短路：不做 embed 调用
    const { rows: cnt } = await pool.query(
      `SELECT count(*)::int AS n FROM chunk_abstract LIMIT 1`,
    )
    if (Number(cnt[0]?.n ?? 0) === 0) return undefined

    const [qVec] = await embedTexts([question])
    if (!qVec || qVec.length === 0) return undefined
    const vecStr = `[${qVec.join(',')}]`

    const params: unknown[] = [vecStr, top]
    let sourceFilter = ''
    if (opts.sourceIds?.length) {
      params.push(opts.sourceIds)
      sourceFilter = `AND ma.source_id = ANY($${params.length}::int[])`
    }

    // distinct on (asset_id) 取每个 asset 的最佳 L0 排序
    const sql = `
      SELECT DISTINCT ON (ca.asset_id) ca.asset_id, (ca.l0_embedding <=> $1) AS dist
      FROM chunk_abstract ca
      JOIN metadata_asset ma ON ma.id = ca.asset_id
      WHERE ca.l0_embedding IS NOT NULL ${sourceFilter}
      ORDER BY ca.asset_id, dist
      LIMIT 500
    `
    const { rows } = await pool.query(sql, params)
    if (!rows.length) {
      emit({ type: 'rag_step', icon: '⚠️', label: 'L0 粗筛 0 命中，回退原路径' })
      return []
    }

    // 按 dist 排序后截 top
    const sorted = [...rows].sort((a, b) => Number(a.dist) - Number(b.dist))
    const assetIds = sorted.slice(0, top).map((r) => Number(r.asset_id))
    emit({ type: 'rag_step', icon: '🧰', label: `L0 粗筛：${assetIds.length} 个候选 asset` })
    return assetIds
  } catch (err) {
    warnOnce('coarse:err', (err as Error).message)
    return undefined
  }
}

/**
 * 检查给定 chunk_id 列表中哪些缺 L0（用于 lazy 回填决策）。
 * 失败时返回空数组，不抛。
 */
export async function chunksMissingL0(chunkIds: number[]): Promise<number[]> {
  if (chunkIds.length === 0) return []
  try {
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT mf.id
       FROM metadata_field mf
       LEFT JOIN chunk_abstract ca ON ca.chunk_id = mf.id
       WHERE mf.id = ANY($1::int[]) AND ca.id IS NULL`,
      [chunkIds],
    )
    return rows.map((r) => Number(r.id))
  } catch {
    return []
  }
}
