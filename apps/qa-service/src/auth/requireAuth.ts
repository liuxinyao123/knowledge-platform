/**
 * auth/requireAuth.ts —— 解析 Bearer token → Principal，注入 req.principal
 *
 * DEV BYPASS：非生产 (NODE_ENV !== 'production') 且未配置 AUTH_* 时，
 * 所有请求注入 { user_id: 0, email: 'dev@local', roles: ['admin'] }
 * 并打 WARN 日志。
 *
 * 生产模式（NODE_ENV=production）若未配置 AUTH_* 会在 index.ts 启动时 fail-fast。
 */
import type { RequestHandler } from 'express'
import { getPool } from '../services/db.ts'
import { verifyToken, isAuthConfigured, TokenError } from './verifyToken.ts'
import type { Principal } from './types.ts'
import { ADMIN_PERMS, expandRolesToPermissions } from './permissions.ts'

const DEV_PRINCIPAL: Principal = {
  user_id: 0,
  email: 'dev@local',
  roles: ['admin'],
  permissions: [...ADMIN_PERMS],
  team_ids: [],
  team_names: [],
}

/** 查 user 加入的 team_ids/names；失败/异常都返空数组（不影响登录） */
async function loadUserTeams(email: string): Promise<{ ids: string[]; names: string[] }> {
  if (!email) return { ids: [], names: [] }
  try {
    const { getPgPool } = await import('../services/pgDb.ts')
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT t.id, t.name FROM team t
       JOIN team_member tm ON tm.team_id = t.id
       WHERE tm.user_email = $1`,
      [email],
    )
    return {
      ids: rows.map((r) => String(r.id)),
      names: rows.map((r) => String(r.name)),
    }
  } catch {
    return { ids: [], names: [] }
  }
}

let devWarnedOnce = false

async function loadRolesFromDb(user_id: number): Promise<string[]> {
  if (user_id === 0) return DEV_PRINCIPAL.roles
  try {
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT role FROM knowledge_user_roles WHERE user_id = ?`,
      [user_id],
    )
    const r = (rows as Array<{ role?: string }>)[0]
    if (r?.role) return [r.role]
    return ['viewer']                                     // 默认
  } catch {
    return ['viewer']
  }
}

export function requireAuth(): RequestHandler {
  return async (req, res, next) => {
    // DEV BYPASS：未配置且非生产
    if (!isAuthConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        // 理论上 index.ts 启动时已 fail-fast；兜底返 500
        return res.status(500).json({ error: 'auth not configured' })
      }
      if (!devWarnedOnce) {
        devWarnedOnce = true
        // eslint-disable-next-line no-console
        console.warn('WARN: AUTH DEV BYPASS enabled — any request is admin')
      }
      req.principal = DEV_PRINCIPAL
      return next()
    }

    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) {
      return res.status(401).json({ error: 'missing token' })
    }

    try {
      const payload = await verifyToken(token)
      const roles = await loadRolesFromDb(payload.user_id)
      // PRD §2.5: token.permissions 优先；否则从 (DB roles + token.roles) 展开
      const permissions = (payload.permissions && payload.permissions.length > 0)
        ? payload.permissions
        : expandRolesToPermissions([...roles, ...(payload.roles ?? [])])
      const teams = await loadUserTeams(payload.email ?? '')
      req.principal = {
        user_id: payload.user_id,
        email: payload.email,
        roles,
        permissions,
        team_ids: teams.ids,
        team_names: teams.names,
      }
      return next()
    } catch (err) {
      const detail = err instanceof TokenError ? err.message : 'verification failed'
      return res.status(401).json({ error: 'invalid token', detail })
    }
  }
}

/** 测试辅助：用预置 Principal 跳过 token 解析（仅用于集成测试 / mock） */
export function __devPrincipal(): Principal {
  return { ...DEV_PRINCIPAL }
}
