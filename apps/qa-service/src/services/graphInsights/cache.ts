/**
 * graphInsights/cache.ts —— metadata_graph_insight_cache 读写
 *
 * 失效（design.md §D-004）：
 *   - TTL: now - computed_at > ttl_sec
 *   - signature 不匹配
 *   - 手动 refresh
 */
import { getPgPool } from '../pgDb.ts'

export interface CachedEntry {
  space_id: number
  computed_at: Date
  ttl_sec: number
  graph_signature: string
  payload: unknown
}

export async function readCache(spaceId: number): Promise<CachedEntry | null> {
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT space_id, computed_at, ttl_sec, graph_signature, payload
       FROM metadata_graph_insight_cache
      WHERE space_id = $1`,
    [spaceId],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    space_id: r.space_id,
    computed_at: r.computed_at,
    ttl_sec: r.ttl_sec,
    graph_signature: r.graph_signature,
    payload: r.payload,
  }
}

export async function writeCache(
  spaceId: number,
  payload: unknown,
  signature: string,
  ttlSec: number,
): Promise<void> {
  const pool = getPgPool()
  await pool.query(
    `INSERT INTO metadata_graph_insight_cache
       (space_id, computed_at, ttl_sec, graph_signature, payload)
     VALUES ($1, NOW(), $2, $3, $4::jsonb)
     ON CONFLICT (space_id) DO UPDATE
       SET computed_at = NOW(),
           ttl_sec = EXCLUDED.ttl_sec,
           graph_signature = EXCLUDED.graph_signature,
           payload = EXCLUDED.payload`,
    [spaceId, ttlSec, signature, JSON.stringify(payload)],
  )
}

export function isFresh(entry: CachedEntry, signature: string): boolean {
  if (entry.graph_signature !== signature) return false
  const ageMs = Date.now() - new Date(entry.computed_at).getTime()
  return ageMs <= entry.ttl_sec * 1000
}
