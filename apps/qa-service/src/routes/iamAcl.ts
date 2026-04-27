/**
 * routes/iamAcl.ts —— IAM · ACL 审计查询（Permissions V2 · F-3）
 *
 * 挂载到 /api/iam/acl：
 *   GET /audit  —— 列出 acl_rule_audit（支持 rule_id / actor / since / until / limit 过滤）
 *
 * 门：requireAuth + enforceAcl({ requiredPermission: 'iam:manage' })
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-audit-spec.md
 */
import { Router, type Request, type Response } from 'express'
import { getPgPool } from '../services/pgDb.ts'
import { requireAuth, enforceAcl } from '../auth/index.ts'

export const iamAclRouter = Router()

iamAclRouter.use(
  requireAuth(),
  enforceAcl({ requiredPermission: 'iam:manage' }),
)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

iamAclRouter.get('/audit', async (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>
  const where: string[] = []
  const params: unknown[] = []

  if (q.rule_id) {
    const n = Number(q.rule_id)
    if (Number.isFinite(n)) {
      params.push(n)
      where.push(`rule_id = $${params.length}`)
    }
  }
  if (q.actor) {
    params.push(q.actor)
    where.push(`actor_email = $${params.length}`)
  }
  if (q.since) {
    const d = new Date(q.since)
    if (!Number.isNaN(d.getTime())) {
      params.push(d)
      where.push(`at >= $${params.length}`)
    }
  }
  if (q.until) {
    const d = new Date(q.until)
    if (!Number.isNaN(d.getTime())) {
      params.push(d)
      where.push(`at < $${params.length}`)
    }
  }

  let limit = DEFAULT_LIMIT
  if (q.limit) {
    const n = Number(q.limit)
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(n, MAX_LIMIT)   // clamp
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const pool = getPgPool()

  // total（忽略 limit）
  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM acl_rule_audit ${whereSql}`,
    params,
  )
  const total = Number(cnt[0]?.total ?? 0)

  // items（按 at DESC + limit）
  params.push(limit)
  const { rows: items } = await pool.query(
    `SELECT id, rule_id, actor_user_id, actor_email, op,
            before_json, after_json,
            EXTRACT(EPOCH FROM at) * 1000 AS at_ms
     FROM acl_rule_audit
     ${whereSql}
     ORDER BY at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  )

  const shaped = items.map((r) => ({
    id: Number(r.id),
    rule_id: r.rule_id == null ? null : Number(r.rule_id),
    actor_user_id: r.actor_user_id == null ? null : Number(r.actor_user_id),
    actor_email: r.actor_email == null ? null : String(r.actor_email),
    op: String(r.op) as 'CREATE' | 'UPDATE' | 'DELETE',
    before_json: r.before_json ?? null,
    after_json:  r.after_json ?? null,
    at: new Date(Number(r.at_ms)).toISOString(),
  }))

  res.json({ items: shaped, total })
})
