/**
 * routes/auth.ts —— 用户身份 / 会话端点
 *
 * GET  /api/auth/me         —— 返当前 principal
 * POST /api/auth/login      —— email + password → { token, user }
 * POST /api/auth/logout     —— stateless：server 端仅回 ok
 * POST /api/auth/register   —— ADMIN 专用，创建用户
 * POST /api/auth/password   —— self 改密
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { isAuthConfigured } from '../auth/verifyToken.ts'
import { signHS256 } from '../auth/signToken.ts'
import { expandRolesToPermissions } from '../auth/permissions.ts'
import { getPgPool } from '../services/pgDb.ts'
import { hashPassword, verifyPassword } from '../services/passwordHash.ts'
import { writeAudit } from '../services/audit.ts'

export const authRouter = Router()

authRouter.get('/me', requireAuth(), (req: Request, res: Response) => {
  if (!req.principal) return res.status(401).json({ error: 'unauthorized' })
  const { user_id, email, roles, permissions } = req.principal
  res.json({
    user_id,
    email,
    roles,
    permissions,
    dev_bypass: !isAuthConfigured() && process.env.NODE_ENV !== 'production',
  })
})

// ───────────────────────── POST /login ─────────────────────────
authRouter.post('/login', async (req: Request, res: Response) => {
  const secret = process.env.AUTH_HS256_SECRET
  if (!secret) {
    return res.status(500).json({ error: 'login not configured (AUTH_HS256_SECRET missing)' })
  }
  const body = (req.body ?? {}) as { email?: string; password?: string }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' })
  }

  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, roles FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  )
  if (rows.length === 0) {
    return res.status(401).json({ error: 'invalid credentials' })
  }
  const u = rows[0] as { id: number; email: string; password_hash: string; roles: string[] }
  const ok = await verifyPassword(password, u.password_hash)
  if (!ok) {
    await writeAudit({ action: 'login_failed', targetType: 'user', targetId: u.id, detail: { email } })
    return res.status(401).json({ error: 'invalid credentials' })
  }

  const roles = Array.isArray(u.roles) ? u.roles : []
  const permissions = expandRolesToPermissions(roles)
  const token = signHS256({ sub: u.id, email: u.email, roles, permissions }, secret)

  await writeAudit({
    action: 'login_success',
    targetType: 'user',
    targetId: u.id,
    detail: { email: u.email },
  })

  return res.json({
    token,
    user: { user_id: u.id, email: u.email, roles, permissions },
  })
})

// ───────────────────────── POST /logout ─────────────────────────
authRouter.post('/logout', requireAuth(), async (req: Request, res: Response) => {
  if (req.principal) {
    await writeAudit({
      action: 'logout',
      targetType: 'user',
      targetId: req.principal.user_id,
      principal: req.principal,
    })
  }
  res.json({ ok: true })
})

// ───────────────────────── POST /register (ADMIN) ─────────────────────────
authRouter.post(
  '/register',
  requireAuth(),
  enforceAcl({ requiredPermission: 'permission:manage' }),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      email?: string
      password?: string
      roles?: string[]
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const roles = Array.isArray(body.roles) ? body.roles.filter((r) => typeof r === 'string') : []
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be ≥ 8 characters' })
    }

    const pool = getPgPool()
    const hash = await hashPassword(password)
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, roles)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id`,
        [email, hash, JSON.stringify(roles)],
      )
      const id = Number(rows[0].id)
      await writeAudit({
        action: 'user_register',
        targetType: 'user',
        targetId: id,
        detail: { email, roles },
        principal: req.principal,
      })
      res.status(201).json({ id })
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'insert failed'
      if (/duplicate/i.test(msg) || /unique/i.test(msg)) {
        return res.status(409).json({ error: 'email already exists' })
      }
      throw e
    }
  },
)

// ───────────────────────── PATCH /users/:id (ADMIN) ─────────────────────────
authRouter.patch(
  '/users/:id',
  requireAuth(),
  enforceAcl({ requiredPermission: 'permission:manage' }),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
    const body = (req.body ?? {}) as { email?: string; roles?: string[] }
    const patch: Record<string, unknown> = {}
    if (typeof body.email === 'string') patch.email = body.email.trim().toLowerCase()
    if (Array.isArray(body.roles)) {
      if (req.principal && Number(req.principal.user_id) === id) {
        return res.status(400).json({ error: 'cannot change own roles' })
      }
      patch.roles = body.roles.filter((r) => typeof r === 'string')
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'nothing to update' })
    }

    const pool = getPgPool()
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.email !== undefined) {
      sets.push(`email = $${sets.length + 1}`)
      params.push(patch.email)
    }
    if (patch.roles !== undefined) {
      sets.push(`roles = $${sets.length + 1}::jsonb`)
      params.push(JSON.stringify(patch.roles))
    }
    sets.push(`updated_at = NOW()`)
    params.push(id)

    try {
      const { rowCount } = await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      )
      if (!rowCount) return res.status(404).json({ error: 'user not found' })
      await writeAudit({
        action: 'user_updated',
        targetType: 'user',
        targetId: id,
        detail: patch,
        principal: req.principal,
      })
      res.json({ ok: true })
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'update failed'
      if (/duplicate/i.test(msg) || /unique/i.test(msg)) {
        return res.status(409).json({ error: 'email already exists' })
      }
      throw e
    }
  },
)

// ───────────────────────── DELETE /users/:id (ADMIN) ─────────────────────────
authRouter.delete(
  '/users/:id',
  requireAuth(),
  enforceAcl({ requiredPermission: 'permission:manage' }),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
    if (req.principal && Number(req.principal.user_id) === id) {
      return res.status(400).json({ error: 'cannot delete self' })
    }
    const pool = getPgPool()
    const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    if (!rowCount) return res.status(404).json({ error: 'user not found' })
    await writeAudit({
      action: 'user_deleted',
      targetType: 'user',
      targetId: id,
      principal: req.principal,
    })
    res.json({ ok: true })
  },
)

// ───────────────── POST /users/:id/reset-password (ADMIN) ─────────────────
authRouter.post(
  '/users/:id/reset-password',
  requireAuth(),
  enforceAcl({ requiredPermission: 'permission:manage' }),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
    const body = (req.body ?? {}) as { newPassword?: string }
    const newPw = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (newPw.length < 8) {
      return res.status(400).json({ error: 'new password must be ≥ 8 characters' })
    }
    const pool = getPgPool()
    const hash = await hashPassword(newPw)
    const { rowCount } = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, id],
    )
    if (!rowCount) return res.status(404).json({ error: 'user not found' })
    await writeAudit({
      action: 'user_password_reset_by_admin',
      targetType: 'user',
      targetId: id,
      principal: req.principal,
    })
    res.json({ ok: true })
  },
)

// ───────────────────────── POST /password ─────────────────────────
authRouter.post('/password', requireAuth(), async (req: Request, res: Response) => {
  if (!req.principal) return res.status(401).json({ error: 'unauthorized' })
  const body = (req.body ?? {}) as { oldPassword?: string; newPassword?: string }
  const oldPw = typeof body.oldPassword === 'string' ? body.oldPassword : ''
  const newPw = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (!oldPw || !newPw) {
    return res.status(400).json({ error: 'oldPassword and newPassword required' })
  }
  if (newPw.length < 8) {
    return res.status(400).json({ error: 'new password must be ≥ 8 characters' })
  }

  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, password_hash FROM users WHERE id = $1`,
    [req.principal.user_id],
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'user not found' })
  }
  const okOld = await verifyPassword(oldPw, rows[0].password_hash as string)
  if (!okOld) return res.status(401).json({ error: 'old password incorrect' })

  const newHash = await hashPassword(newPw)
  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [newHash, req.principal.user_id],
  )
  await writeAudit({
    action: 'user_password_changed',
    targetType: 'user',
    targetId: req.principal.user_id,
    principal: req.principal,
  })
  res.json({ ok: true })
})
