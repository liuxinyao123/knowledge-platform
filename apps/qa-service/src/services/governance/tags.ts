/**
 * 标签体系：列表 / 合并 / 重命名
 */
import { getPgPool } from '../pgDb.ts'

export interface TagInfo {
  name: string
  count: number
  recentGrowth: number                  // 近 7 天新增 asset 带此 tag 数
}

export async function listTags(): Promise<TagInfo[]> {
  const pool = getPgPool()
  const { rows } = await pool.query<{ name: string; count: string; recent: string }>(
    `SELECT t AS name,
            COUNT(*) AS count,
            SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS recent
     FROM metadata_asset, UNNEST(tags) t
     WHERE merged_into IS NULL
     GROUP BY t
     ORDER BY COUNT(*) DESC, t`,
  )
  return rows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    recentGrowth: Number(r.recent),
  }))
}

export async function mergeTags(srcs: string[], dst: string): Promise<{ affected: number }> {
  if (!dst || !srcs.length) return { affected: 0 }
  const pool = getPgPool()
  // 把 srcs 里每个名字在 tags 数组里替换为 dst，然后去重
  // 思路：tags = ARRAY(SELECT DISTINCT unnest(array_replace_many))
  // 但 PG 没有 array_replace_many，多步 array_replace
  let affected = 0
  for (const src of srcs) {
    if (src === dst) continue
    const { rowCount } = await pool.query(
      `UPDATE metadata_asset
       SET tags = (
         SELECT ARRAY(SELECT DISTINCT unnest(array_replace(tags, $1, $2)))
       )
       WHERE $1 = ANY(tags)`,
      [src, dst],
    )
    affected += rowCount ?? 0
  }
  return { affected }
}

export async function renameTag(from: string, to: string): Promise<{ affected: number }> {
  if (!from || !to || from === to) return { affected: 0 }
  return mergeTags([from], to)
}
