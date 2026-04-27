/**
 * services/ontologyContext.ts —— Ontology-Augmented Generation (OAG)
 *
 * 对外暴露 expandOntologyContext，实现 2-hop 邻域扩展、ACL 剪枝、超时管理。
 * 集成点：ragPipeline.ts rerank 与 gradeDocs 之间
 *
 * 设计：
 *   1. 前置 ACL：过滤输入 chunks 的 asset_id；只处理可见的
 *   2. hop=0 自填：可见 asset 本身
 *   3. hop=1 traverse：CONTAINS / HAS_TAG 邻居（Source / Tag）
 *   4. hop=2 traverse：Space + 同标签 Asset（bounded）
 *   5. 二次 ACL：对 hop=2 带出的新 Asset 再校验
 *   6. 超时 guard：AbortController fallback
 */

import { runCypher, isGraphEnabled } from './graphDb.ts'
import { evaluateAcl } from '../auth/evaluateAcl.ts'
import type { Principal } from '../auth/types.ts'

// ── Data types ────────────────────────────────────────────────────────────────

export interface OntologyEntity {
  kind: 'Asset' | 'Source' | 'Space' | 'Tag' | 'Question'
  id: string
  label: string
  attrs?: Record<string, unknown>
  distance: 0 | 1 | 2
}

export interface OntologyEdge {
  kind: 'CONTAINS' | 'SCOPES' | 'HAS_TAG' | 'CITED' | 'CO_CITED'
  from: string
  to: string
  weight?: number
}

export interface OntologyContext {
  entities: OntologyEntity[]
  edges: OntologyEdge[]
  meta: {
    hop_depth: 0 | 1 | 2
    source_chunks: number
    fallback: boolean
    latency_ms: number
  }
}

interface ExpandInput {
  chunks: Array<{ asset_id: number | string; score: number }>
  principal: Principal
  maxHop?: 1 | 2
  timeoutMs?: number
}

// ── Attribute whitelist ────────────────────────────────────────────────────────

type AttrWhitelist = Record<string, string[]>

const ATTR_WHITELIST: AttrWhitelist = {
  Asset: ['status', 'source_id', 'mime', 'updated_at', 'summary_text'],
  Source: ['name', 'kind', 'offline'],
  Space: ['name', 'permission_mode'],
  Tag: ['name', 'color'],
  Question: ['first_seen_at', 'cite_count'],
}

function filterAttrs(
  kind: OntologyEntity['kind'],
  attrs: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined
  const whitelist = ATTR_WHITELIST[kind] || []
  const filtered: Record<string, unknown> = {}
  for (const key of whitelist) {
    if (key in attrs) {
      filtered[key] = (attrs as Record<string, unknown>)[key]
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined
}

// ── ACL batch evaluation ───────────────────────────────────────────────────────

async function batchEvaluateRead(
  principal: Principal,
  assetIds: string[],
  aclCache: Map<string, boolean>,
): Promise<Set<string>> {
  const unseen = assetIds.filter((id) => !aclCache.has(id))
  if (unseen.length === 0) {
    return new Set(assetIds.filter((id) => aclCache.get(id)))
  }

  // 并发上限 16，防止 ACL 缓存抖动
  const batchSize = 16
  for (let i = 0; i < unseen.length; i += batchSize) {
    const batch = unseen.slice(i, i + batchSize)
    await Promise.all(
      batch.map(async (id) => {
        try {
          // asset_id 需要是 number，尝试转换
          const assetIdNum = Number(id)
          const resource = Number.isFinite(assetIdNum) ? { asset_id: assetIdNum } : { asset_id: id }
          const decision = await evaluateAcl(principal, 'READ', resource as any)
          aclCache.set(id, decision.allow)
        } catch (err) {
          // 异常保守拒绝
          aclCache.set(id, false)
        }
      }),
    )
  }

  return new Set(assetIds.filter((id) => aclCache.get(id) === true))
}

// ── Cypher helpers ────────────────────────────────────────────────────────────

async function readAssetNeighborsHop1(
  assetIds: string[],
  signal: AbortSignal,
): Promise<{ entities: OntologyEntity[]; edges: OntologyEdge[] }> {
  if (!isGraphEnabled() || assetIds.length === 0) return { entities: [], edges: [] }
  if (signal.aborted) return { entities: [], edges: [] }

  // Cypher：读 (a:Asset)-[:CONTAINS|HAS_TAG]-(x)，限 50 行
  const query = `
    MATCH (a:Asset)-[r:CONTAINS|HAS_TAG]-(x)
    WHERE a.id IN $ids
    RETURN a.id as aid, a.name as aname, a, r, x, x.kind as xkind, x.id as xid, x.name as xname
    LIMIT 50
  `
  const rows = await runCypher(query, { ids: assetIds })

  const entities: Map<string, OntologyEntity> = new Map()
  const edges: OntologyEdge[] = []

  for (const row of rows) {
    if (signal.aborted) break

    // a:Asset (distance=0，不重复）
    const aId = String((row as any).aid)
    if (!entities.has(`Asset:${aId}`)) {
      entities.set(`Asset:${aId}`, {
        kind: 'Asset',
        id: aId,
        label: String((row as any).aname || aId),
        distance: 0,
        attrs: filterAttrs('Asset', (row as any).a as Record<string, unknown> | null),
      })
    }

    // x (Source / Tag，distance=1)
    const xId = String((row as any).xid)
    const xKind = String((row as any).xkind || 'Unknown') as 'Source' | 'Tag'
    if (!entities.has(`${xKind}:${xId}`)) {
      entities.set(`${xKind}:${xId}`, {
        kind: xKind,
        id: xId,
        label: String((row as any).xname || xId),
        distance: 1,
        attrs: filterAttrs(xKind, (row as any).x as Record<string, unknown> | null),
      })
    }

    // Edge
    const relType = String(((row as any).r as any)?.type || 'UNKNOWN') as 'CONTAINS' | 'HAS_TAG'
    edges.push({
      kind: relType,
      from: aId,
      to: xId,
    })
  }

  return { entities: Array.from(entities.values()), edges }
}

async function readAssetNeighborsHop2(
  assetIds: string[],
  signal: AbortSignal,
): Promise<{ entities: OntologyEntity[]; edges: OntologyEdge[] }> {
  if (!isGraphEnabled() || assetIds.length === 0) return { entities: [], edges: [] }
  if (signal.aborted) return { entities: [], edges: [] }

  // Cypher：2-hop 邻域
  // (a:Asset)-[:CONTAINS]-(s:Source)-[:SCOPES]-(sp:Space)
  // (a:Asset)-[:HAS_TAG]-(t:Tag)<-[:HAS_TAG]-(a2:Asset) [限 10]
  const query = `
    MATCH p=(a:Asset)-[r:CONTAINS|HAS_TAG]-(x)
    WHERE a.id IN $ids
    WITH a, r, x
    MATCH (x)-[r2]-(y)
    WHERE (x:Source AND r2:SCOPES) OR (x:Tag AND r2:HAS_TAG)
    RETURN
      a.id as aid, a.name as aname, a,
      x.id as xid, x.kind as xkind, x.name as xname, x,
      r, r2,
      y.id as yid, y.kind as ykind, y.name as yname, y
    LIMIT 150
  `
  const rows = await runCypher(query, { ids: assetIds })

  const entities: Map<string, OntologyEntity> = new Map()
  const edges: OntologyEdge[] = []
  const coTaggedAssets = new Map<string, number>()

  for (const row of rows) {
    if (signal.aborted) break

    const aId = String((row as any).aid)
    const xId = String((row as any).xid)
    const yId = String((row as any).yid)
    const yKind = String((row as any).ykind || 'Unknown') as OntologyEntity['kind']

    // 去重
    if (!entities.has(`${yKind}:${yId}`)) {
      // 若是 Asset（hop=2），计数用于限制（最多 10 同标签 asset）
      if (yKind === 'Asset') {
        const tagKey = `${(row as any).xid}`
        const count = (coTaggedAssets.get(tagKey) || 0) + 1
        if (count > 10) continue
        coTaggedAssets.set(tagKey, count)
      }

      entities.set(`${yKind}:${yId}`, {
        kind: yKind,
        id: yId,
        label: String((row as any).yname || yId),
        distance: 2,
        attrs: filterAttrs(yKind, (row as any).y as Record<string, unknown> | null),
      })
    }

    // Edge: x → y
    const relType2 = String(((row as any).r2 as any)?.type || 'UNKNOWN') as OntologyEdge['kind']
    edges.push({
      kind: relType2,
      from: xId,
      to: yId,
    })
  }

  return { entities: Array.from(entities.values()), edges }
}

// ── Main API ───────────────────────────────────────────────────────────────────

export async function expandOntologyContext(input: ExpandInput): Promise<OntologyContext> {
  const startMs = Date.now()
  const timeoutMs = input.timeoutMs ?? 200
  const maxHop = Math.max(1, Math.min(2, input.maxHop ?? 2)) // Clamp to [1, 2]

  // 无图或空 chunks → 快速返回
  if (!isGraphEnabled() || input.chunks.length === 0) {
    return {
      entities: [],
      edges: [],
      meta: {
        hop_depth: maxHop as 0 | 1 | 2,
        source_chunks: input.chunks.length,
        fallback: false,
        latency_ms: Date.now() - startMs,
      },
    }
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  /**
   * Race a work promise against the abort signal. If the signal aborts first,
   * resolves to a sentinel `null` so the caller can take the fallback branch
   * synchronously (the in-flight work is orphaned, which is acceptable for a
   * best-effort 200ms budget). If the promise rejects, it's caught and the
   * caller gets `null` too.
   */
  const raceAbort = async <T>(work: Promise<T>): Promise<T | null> => {
    return await new Promise<T | null>((resolve) => {
      let settled = false
      const done = (v: T | null) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      if (controller.signal.aborted) return done(null)
      const onAbort = () => done(null)
      controller.signal.addEventListener('abort', onAbort)
      work.then(
        (v) => {
          controller.signal.removeEventListener('abort', onAbort)
          done(v)
        },
        () => {
          controller.signal.removeEventListener('abort', onAbort)
          done(null)
        },
      )
    })
  }

  try {
    const aclCache = new Map<string, boolean>()

    // 前置 ACL：过滤可见 asset (转换为 number)
    const inputAssetIds = input.chunks.map((c) => {
      const id = c.asset_id
      return typeof id === 'number' ? String(id) : id
    })
    const visibleAssets = await batchEvaluateRead(input.principal, inputAssetIds, aclCache)
    if (controller.signal.aborted) {
      return {
        entities: [],
        edges: [],
        meta: {
          hop_depth: maxHop as 0 | 1 | 2,
          source_chunks: input.chunks.length,
          fallback: true,
          latency_ms: Date.now() - startMs,
        },
      }
    }

    if (visibleAssets.size === 0) {
      return {
        entities: [],
        edges: [],
        meta: {
          hop_depth: maxHop as 0 | 1 | 2,
          source_chunks: input.chunks.length,
          fallback: true,
          latency_ms: Date.now() - startMs,
        },
      }
    }

    const entities: Map<string, OntologyEntity> = new Map()
    const allEdges: OntologyEdge[] = []

    // hop=0：自填可见 asset
    for (const assetId of visibleAssets) {
      entities.set(`Asset:${assetId}`, {
        kind: 'Asset',
        id: assetId,
        label: assetId,
        distance: 0,
      })
    }

    // hop=1
    const hop1 = await raceAbort(
      readAssetNeighborsHop1(Array.from(visibleAssets), controller.signal),
    )
    if (hop1 === null || controller.signal.aborted) {
      return {
        entities: Array.from(entities.values()),
        edges: allEdges,
        meta: {
          hop_depth: 1,
          source_chunks: input.chunks.length,
          fallback: true,
          latency_ms: Date.now() - startMs,
        },
      }
    }

    for (const e of hop1.entities) {
      entities.set(`${e.kind}:${e.id}`, e)
    }
    allEdges.push(...hop1.edges)

    // hop=2
    let hop2Entities = Array<OntologyEntity>()
    if (maxHop === 2) {
      const hop2 = await raceAbort(
        readAssetNeighborsHop2(Array.from(visibleAssets), controller.signal),
      )
      if (hop2 === null || controller.signal.aborted) {
        return {
          entities: Array.from(entities.values()),
          edges: allEdges,
          meta: {
            hop_depth: 1,
            source_chunks: input.chunks.length,
            fallback: true,
            latency_ms: Date.now() - startMs,
          },
        }
      }

      hop2Entities = hop2.entities.filter((e) => e.kind === 'Asset')
      for (const e of hop2.entities) {
        entities.set(`${e.kind}:${e.id}`, e)
      }
      allEdges.push(...hop2.edges)
    }

    // 二次 ACL：过滤 hop=2 的新 Asset
    if (hop2Entities.length > 0) {
      const hop2AssetIds = hop2Entities.map((e) => e.id)
      const visibleHop2 = await batchEvaluateRead(input.principal, hop2AssetIds, aclCache)
      if (controller.signal.aborted) {
        return {
          entities: Array.from(entities.values()),
          edges: allEdges,
          meta: {
            hop_depth: 1,
            source_chunks: input.chunks.length,
            fallback: true,
            latency_ms: Date.now() - startMs,
          },
        }
      }

      // 剪掉不可见的 Asset + 相关 edges
      for (const assetId of hop2AssetIds) {
        if (!visibleHop2.has(assetId)) {
          entities.delete(`Asset:${assetId}`)
          // 删除相关 edges
          const filtered = allEdges.filter(
            (e) => !(e.from === assetId || e.to === assetId),
          )
          allEdges.length = 0
          allEdges.push(...filtered)
        }
      }
    }

    return {
      entities: Array.from(entities.values()),
      edges: allEdges,
      meta: {
        hop_depth: maxHop as 0 | 1 | 2,
        source_chunks: input.chunks.length,
        fallback: false,
        latency_ms: Date.now() - startMs,
      },
    }
  } catch (err) {
    // Cypher 異常兜底
    // eslint-disable-next-line no-console
    console.warn(`[ontology] expand failed: ${(err as Error).message?.slice(0, 200)}`)
    return {
      entities: [],
      edges: [],
      meta: {
        hop_depth: maxHop as 0 | 1 | 2,
        source_chunks: input.chunks.length,
        fallback: true,
        latency_ms: Date.now() - startMs,
      },
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}
