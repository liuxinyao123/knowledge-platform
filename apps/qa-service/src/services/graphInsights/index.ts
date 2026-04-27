/**
 * graphInsights/index.ts —— 编排器：读 cache → 判 fresh → pg_try_advisory_lock 下重算
 *
 * 对外暴露 getInsights(spaceId, opts) 作为路由层唯一入口。
 *
 * 失效 / 降级 / 并发策略见 design.md §D-004/D-005/D-007。
 */
import { getPgPool } from '../pgDb.ts'
import { isGraphEnabled } from '../graphDb.ts'

import { loadGraphInsightsConfig, type GraphInsightsConfig } from './config.ts'
import { loadSpaceSubgraph, type SpaceSubgraph } from './loader.ts'
import {
  detectCommunities,
  GraphTooLargeError,
  LouvainFailureError,
  type LouvainResult,
} from './louvain.ts'
import { computeIsolated, type IsolatedInsight } from './isolated.ts'
import {
  computeBridgesByCommunity,
  computeBridgesByTag,
  type BridgeInsight,
} from './bridges.ts'
import { computeSurprises, type SurpriseInsight } from './surprises.ts'
import { computeSparse, type SparseInsight } from './sparse.ts'
import { readCache, writeCache, isFresh } from './cache.ts'

export interface InsightsPayload {
  space_id: number
  generated_at: string
  computed_at: string
  degraded: boolean
  /** 降级原因：'graph_too_large' | 'louvain_exception' | null */
  degrade_reason: string | null
  stats: {
    asset_count: number
    edge_count: number
    community_count: number
  }
  isolated: IsolatedInsight[]
  bridges: BridgeInsight[]
  surprises: SurpriseInsight[]
  sparse: SparseInsight[]
}

export class KgUnavailableError extends Error {
  constructor() {
    super('knowledge graph unavailable')
    this.name = 'KgUnavailableError'
  }
}

export class FeatureDisabledError extends Error {
  constructor() {
    super('graph-insights disabled by env')
    this.name = 'FeatureDisabledError'
  }
}

function advisoryLockKey(spaceId: number): string {
  return `graph_insights:${spaceId}`
}

async function tryAdvisoryLock(key: string): Promise<boolean> {
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS got`,
    [key],
  )
  return Boolean(rows[0]?.got)
}

async function releaseAdvisoryLock(key: string): Promise<void> {
  const pool = getPgPool()
  await pool.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {})
}

function buildPayload(args: {
  spaceId: number
  subgraph: SpaceSubgraph
  louvain: LouvainResult | null
  degraded: boolean
  degradeReason: string | null
  cfg: GraphInsightsConfig
}): InsightsPayload {
  const { spaceId, subgraph, louvain, degraded, degradeReason, cfg } = args
  const now = new Date().toISOString()

  const isolated = computeIsolated(subgraph, { minAgeDays: cfg.isolatedMinAgeDays })

  let bridges: BridgeInsight[]
  let surprises: SurpriseInsight[]
  let sparse: SparseInsight[]
  if (louvain) {
    bridges = computeBridgesByCommunity(subgraph, louvain, { minBridges: 3 })
    surprises = computeSurprises(subgraph, louvain, {
      weights: cfg.weights,
      topN: cfg.topSurprises,
    })
    sparse = computeSparse(subgraph, louvain, {
      cohesionThreshold: cfg.sparseCohesionThreshold,
      minSize: cfg.sparseMinSize,
    })
  } else {
    // 降级：bridges 走 HAS_TAG 回退；surprises / sparse 空
    bridges = computeBridgesByTag(subgraph, { minBridges: 3 })
    surprises = []
    sparse = []
  }

  return {
    space_id: spaceId,
    generated_at: now,
    computed_at: now,
    degraded,
    degrade_reason: degradeReason,
    stats: {
      asset_count: subgraph.assets.length,
      edge_count: subgraph.coCitedEdges.length,
      community_count: louvain?.sizes.size ?? 0,
    },
    isolated,
    bridges,
    surprises,
    sparse,
  }
}

export interface GetInsightsOptions {
  /** 绕过 cache freshness 检查（Admin refresh 用） */
  force?: boolean
}

export async function getInsights(
  spaceId: number,
  opts: GetInsightsOptions = {},
): Promise<InsightsPayload> {
  const cfg = loadGraphInsightsConfig()
  if (!cfg.enabled) throw new FeatureDisabledError()
  if (!isGraphEnabled()) throw new KgUnavailableError()

  // 先拉当前签名（便于缓存比对）；非极小开销，但避免双缓存失配
  const subgraph = await loadSpaceSubgraph(spaceId)

  if (!opts.force) {
    const cached = await readCache(spaceId)
    if (cached && isFresh(cached, subgraph.signature)) {
      const payload = cached.payload as InsightsPayload
      // eslint-disable-next-line no-console
      console.log(
        `graph_insights_cache_hit ${JSON.stringify({
          space_id: spaceId,
          reason: 'valid',
        })}`,
      )
      // 复写 generated_at 为"此次响应时间"，保留 computed_at 为原记录
      return {
        ...payload,
        generated_at: new Date().toISOString(),
        computed_at: new Date(cached.computed_at).toISOString(),
      }
    }
  }

  // 尝试拿 advisory lock；拿不到 → 读旧缓存（即使 stale）+ WARN
  const lockKey = advisoryLockKey(spaceId)
  const gotLock = await tryAdvisoryLock(lockKey)
  if (!gotLock) {
    const cached = await readCache(spaceId)
    // eslint-disable-next-line no-console
    console.warn(
      `graph_insights_cache_hit ${JSON.stringify({
        space_id: spaceId,
        reason: 'advisory_lock_held',
      })}`,
    )
    if (cached) {
      return {
        ...(cached.payload as InsightsPayload),
        generated_at: new Date().toISOString(),
        computed_at: new Date(cached.computed_at).toISOString(),
      }
    }
    // 从未计算过且又拿不到锁：回落到同步计算（单次 lock 未拿但无缓存，罕见）
  }

  try {
    const t0 = Date.now()
    let louvain: LouvainResult | null = null
    let degraded = false
    let degradeReason: string | null = null

    const nodeIds = subgraph.assets.map((a) => a.id)
    try {
      louvain = detectCommunities(subgraph.coCitedEdges, nodeIds, {
        resolution: cfg.louvainResolution,
        maxEdges: cfg.maxEdges,
      })
    } catch (err) {
      if (err instanceof GraphTooLargeError) {
        degraded = true
        degradeReason = 'graph_too_large'
        // eslint-disable-next-line no-console
        console.warn(
          `graph_insights_louvain_skipped ${JSON.stringify({
            space_id: spaceId,
            reason: 'graph_too_large',
            edge_count: err.edgeCount,
            limit: err.limit,
          })}`,
        )
      } else if (err instanceof LouvainFailureError) {
        degraded = true
        degradeReason = 'louvain_exception'
        // eslint-disable-next-line no-console
        console.warn(
          `graph_insights_louvain_failed ${JSON.stringify({
            space_id: spaceId,
            reason: (err.cause as Error)?.message ?? 'unknown',
          })}`,
        )
      } else {
        throw err
      }
    }

    const payload = buildPayload({
      spaceId,
      subgraph,
      louvain,
      degraded,
      degradeReason,
      cfg,
    })

    await writeCache(spaceId, payload, subgraph.signature, cfg.ttlSec)

    // eslint-disable-next-line no-console
    console.log(
      `graph_insights_computed ${JSON.stringify({
        space_id: spaceId,
        duration_ms: Date.now() - t0,
        asset_count: payload.stats.asset_count,
        edge_count: payload.stats.edge_count,
        communities: payload.stats.community_count,
        degraded,
      })}`,
    )

    return payload
  } finally {
    if (gotLock) await releaseAdvisoryLock(lockKey)
  }
}

/** 路由层使用：从 cache payload 里按 insight_key 拿单条洞察（Deep Research 主题生成用） */
export type FoundInsight =
  | { kind: 'isolated'; data: IsolatedInsight }
  | { kind: 'bridge'; data: BridgeInsight }
  | { kind: 'surprise'; data: SurpriseInsight }
  | { kind: 'sparse'; data: SparseInsight }

export function findInsightByKey(
  payload: InsightsPayload,
  key: string,
): FoundInsight | null {
  const iso = payload.isolated.find((x) => x.key === key)
  if (iso) return { kind: 'isolated', data: iso }
  const br = payload.bridges.find((x) => x.key === key)
  if (br) return { kind: 'bridge', data: br }
  const su = payload.surprises.find((x) => x.key === key)
  if (su) return { kind: 'surprise', data: su }
  const sp = payload.sparse.find((x) => x.key === key)
  if (sp) return { kind: 'sparse', data: sp }
  return null
}
