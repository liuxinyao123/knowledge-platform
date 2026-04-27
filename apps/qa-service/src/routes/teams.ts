/**
 * routes/teams.ts —— Permissions V2: Teams CRUD + 成员
 *
 * 端点 /api/iam/teams：
 *   GET    /                                    list（admin 全部；其它人只看自己加入的）
 *   POST   /                                    create     [permission:manage]
 *   GET    /:id                                 detail + members
 *   PATCH  /:id                                 改名/描述   [permission:manage]
 *   DELETE /:id                                 删          [permission:manage]
 *   POST   /:id/members                         加成员     [permission:manage]
 *   DELETE /:id/members/:email                  踢人       [permission:manage]
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { getPgPool } from '../services/pgDb.ts'

export const teamsRouter = Router()

const adminOnly = enforceAcl({ requiredPermission: 'permission:manage' })

teamsRouter.use(requireAuth())

teamsRouter.get('/', async (req: Request, res: Response) => {
  const email = req.principal?.email ?? ''
  const isAdmin = (req.principal?.roles ?? []).includes('admin')
  const pool = getPgPool()
  const sql = isAdmin
    ? `SELECT t.id, t.name, t.description, t.created_by,
              EXTRACT(EPOCH FROM t.created_at) * 1000 AS created_at_ms,
              EXTRACT(EPOCH FROM t.updated_at) * 1000 AS updated_at_ms,
              (SELECT COUNT(*)::int FROM team_member tm WHERE tm.team_id = t.id) AS member_count
       FROM team t ORDER BY t.id DESC`
    : `SELECT t.id, t.name, t.description, t.created_by,
              EXTRACT(EPOCH FROM t.created_at) * 1000 AS created_at_ms,
              EXTRACT(EPOCH FROM t.updated_at) * 1000 AS updated_at_ms,
              (SELECT COUNT(*)::int FROM team_member tm WHERE tm.team_id = t.id) AS member_count
       FROM team t
       JOIN team_member tm ON tm.team_id = t.id
       WHERE tm.user_email = $1
       ORDER BY t.id DESC`
  const params = isAdmin ? [] : [email]
  const { rows } = await pool.query(sql, params)
  res.json({ items: rows })
})

teamsRouter.post('/', adminOnly, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name required' })
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const pool = getPgPool()
  try {
    const { rows } = await pool.query(
      `INSERT INTO team (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by,
                 EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms`,
      [name, description, req.principal?.email ?? null],
    )
    res.status(201).json(rows[0])
  } catch (e) {
    const msg = (e as Error).message
    if (/duplicate|unique/i.test(msg)) return res.status(409).json({ error: 'team name already exists' })
    throw e
  }
})

teamsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rows: tRows } = await pool.query(
    `SELECT id, name, description, created_by,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_ms
     FROM team WHERE id = $1`,
    [id],
  )
  if (!tRows[0]) return res.status(404).json({ error: 'team not found' })
  // 鉴权：admin 全开；非 admin 必须是该 team 成员
  const isAdmin = (req.principal?.roles ?? []).includes('admin')
  if (!isAdmin) {
    const { rows: mr } = await pool.query(
      `SELECT 1 FROM team_member WHERE team_id = $1 AND user_email = $2 LIMIT 1`,
      [id, req.principal?.email ?? ''],
    )
    if (mr.length === 0) return res.status(403).json({ error: 'not a member' })
  }
  const { rows: mRows } = await pool.query(
    `SELECT user_email, role, added_by,
            EXTRACT(EPOCH FROM joined_at) * 1000 AS joined_at_ms
     FROM team_member WHERE team_id = $1 ORDER BY joined_at ASC`,
    [id],
  )
  res.json({ team: tRows[0], members: mRows })
})

teamsRouter.patch('/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.name === 'string') { params.push(body.name.trim()); sets.push(`name = $${params.length}`) }
  if (typeof body.description === 'string') { params.push(body.description.trim()); sets.push(`description = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  sets.push(`updated_at = NOW()`)
  params.push(id)
  const pool = getPgPool()
  await pool.query(`UPDATE team SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
  res.json({ ok: true })
})

teamsRouter.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  await pool.query(`DELETE FROM team WHERE id = $1`, [id])
  res.json({ ok: true })
})

// ── Members ────────────────────────────────────────────────────────────────

teamsRouter.post('/:id/members', adminOnly, async (req: Request, res: Response) => {
  const teamId = Number(req.params.id)
  if (!Number.isFinite(teamId)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as { user_email?: unknown; role?: unknown }
  const userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : ''
  if (!userEmail) return res.status(400).json({ error: 'user_email required' })
  const role = body.role === 'owner' ? 'owner' : 'member'
  const pool = getPgPool()
  await pool.query(
    `INSERT INTO team_member (team_id, user_email, role, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (team_id, user_email) DO UPDATE SET role = EXCLUDED.role`,
    [teamId, userEmail, role, req.principal?.email ?? null],
  )
  res.status(201).json({ ok: true, user_email: userEmail, role })
})

teamsRouter.delete('/:id/members/:email', adminOnly, async (req: Request, res: Response) => {
  const teamId = Number(req.params.id)
  const email = String(req.params.email).trim().toLowerCase()
  if (!Number.isFinite(teamId)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  await pool.query(
    `DELETE FROM team_member WHERE team_id = $1 AND user_email = $2`,
    [teamId, email],
  )
  res.json({ ok: true })
})
