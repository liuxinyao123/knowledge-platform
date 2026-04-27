/**
 * graphInsights/dismissed.ts —— metadata_graph_insight_dismissed CRUD
 *
 * 设计 D-006：用户 × space × insight_key 三元主键，跨会话持久化。
 */
import { getPgPool } from '../pgDb.ts'

export async function listDismissed(
  userEmail: string,
  spaceId: number,
): Promise<Set<string>> {
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT insight_key
       FROM metadata_graph_insight_dismissed
      WHERE user_email = $1 AND space_id = $2`,
    [userEmail, spaceId],
  )
  return new Set(rows.map((r) => r.insight_key as string))
}

/** UPSERT on conflict do nothing —— 幂等 */
export async function addDismissed(
  userEmail: string,
  spaceId: number,
  insightKey: string,
): Promise<void> {
  const pool = getPgPool()
  await pool.query(
    `INSERT INTO metadata_graph_insight_dismissed
       (user_email, space_id, insight_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_email, space_id, insight_key) DO NOTHING`,
    [userEmail, spaceId, insightKey],
  )
}

export async function removeDismissed(
  userEmail: string,
  spaceId: number,
  insightKey: string,
): Promise<void> {
  const pool = getPgPool()
  await pool.query(
    `DELETE FROM metadata_graph_insight_dismissed
      WHERE user_email = $1 AND space_id = $2 AND insight_key = $3`,
    [userEmail, spaceId, insightKey],
  )
}
