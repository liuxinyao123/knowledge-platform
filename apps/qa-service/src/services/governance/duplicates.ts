/**
 * 重复检测：基于每个 asset 的"代表向量"做 pgvector 最近邻
 * 代表向量 = metadata_field.embedding WHERE chunk_level=3 LIMIT 1（chunk_index=0 优先）
 */
import { getPgPool } from '../pgDb.ts'

export interface DuplicatePair {
  a: { id: number; name: string }
  b: { id: number; name: string }
  similarity: number
}

export async function findDuplicatePairs(opts: {
  threshold?: number
  limit?: number
} = {}): Promise<DuplicatePair[]> {
  const threshold = opts.threshold ?? 0.85
  const limit = Math.min(200, opts.limit ?? 50)
  const pool = getPgPool()

  // 代表向量视图 = 每 asset 取 chunk_level=3 的第一条（按 chunk_index 升序）
  const sql = `
    WITH rep AS (
      SELECT DISTINCT ON (mf.asset_id)
             mf.asset_id AS aid,
             mf.embedding AS emb,
             ma.name AS name
      FROM metadata_field mf
      JOIN metadata_asset ma ON ma.id = mf.asset_id
      WHERE mf.embedding IS NOT NULL
        AND mf.chunk_level = 3
        AND ma.merged_into IS NULL
      ORDER BY mf.asset_id, mf.chunk_index
    ),
    pairs AS (
      SELECT r1.aid AS a_id, r1.name AS a_name,
             r2.aid AS b_id, r2.name AS b_name,
             1 - (r1.emb <=> r2.emb) AS sim
      FROM rep r1
      JOIN rep r2 ON r1.aid < r2.aid
    )
    SELECT p.*
    FROM pairs p
    LEFT JOIN duplicate_dismissed d
      ON (d.asset_id_a = p.a_id AND d.asset_id_b = p.b_id)
      OR (d.asset_id_a = p.b_id AND d.asset_id_b = p.a_id)
    WHERE d.asset_id_a IS NULL
      AND p.sim > $1
    ORDER BY p.sim DESC
    LIMIT $2
  `
  const { rows } = await pool.query<{
    a_id: number; a_name: string; b_id: number; b_name: string; sim: number
  }>(sql, [threshold, limit])

  return rows.map((r) => ({
    a: { id: Number(r.a_id), name: r.a_name },
    b: { id: Number(r.b_id), name: r.b_name },
    similarity: Number(r.sim),
  }))
}

export async function mergeAssets(srcId: number, dstId: number): Promise<void> {
  if (srcId === dstId) throw new Error('srcId === dstId')
  const pool = getPgPool()
  // 把 src 的 chunks 转给 dst；src 软标 merged_into
  await pool.query(`UPDATE metadata_field SET asset_id = $1 WHERE asset_id = $2`, [dstId, srcId])
  await pool.query(`UPDATE metadata_asset SET merged_into = $1 WHERE id = $2`, [dstId, srcId])
}

export async function dismissDuplicate(a: number, b: number): Promise<void> {
  const pool = getPgPool()
  const [x, y] = a < b ? [a, b] : [b, a]
  await pool.query(
    `INSERT INTO duplicate_dismissed (asset_id_a, asset_id_b)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [x, y],
  )
}
