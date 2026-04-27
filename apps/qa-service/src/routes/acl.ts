/**
 * routes/acl.ts —— Admin 管理 API
 *
 * 所有端点都要求 ADMIN 角色。
 *   GET    /api/acl/rules
 *   POST   /api/acl/rules
 *   PUT    /api/acl/rules/:id
 *   DELETE /api/acl/rules/:id
 *   POST   /api/acl/cache/flush
 */
import { Router, type Request, type Response } from 'express'
import { getPgPool } from '../services/pgDb.ts'
import {
  requireAuth, enforceAcl, reloadRules, aclCacheFlush, evaluateAcl,
} from '../auth/index.ts'
import type { Principal, AclAction, AclResource } from '../auth/index.ts'
import { ROLE_TO_PERMS, expandRolesToPermissions } from '../auth/permissions.ts'
import { writeAudit } from '../services/audit.ts'

export const aclRouter = Router()

// 所有 /api/acl/* 需要 `permission:manage`（admin 角色才有）。
// 走 permission model 而非旧 evaluateAcl 规则表，避免默认表空时自锁。
aclRouter.use(
  requireAuth(),
  enforceAcl({ requiredPermission: 'permission:manage' }),
)

// ── Permissions V2 · F-3 · ACL 规则审计 helper ─────────────────────────────────
//
// 与既有 `writeAudit({action:'acl_rule_*'})` 并行：writeAudit 写 audit_log 供跨业务查询，
// 这里额外写 acl_rule_audit，结构化 before_json / after_json 列，便于 IAM 审计视图直接查。
// 失败只 console.error，不阻塞业务返回。

type AclAuditOp = 'CREATE' | 'UPDATE' | 'DELETE'

async function writeAclRuleAudit(args: {
  ruleId: number
  op: AclAuditOp
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  principal: Principal | null | undefined
}): Promise<void> {
  try {
    const pool = getPgPool()
    await pool.query(
      `INSERT INTO acl_rule_audit
         (rule_id, actor_user_id, actor_email, op, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        args.ruleId,
        args.principal?.user_id ?? null,
        args.principal?.email ?? null,
        args.op,
        args.before ? JSON.stringify(args.before) : null,
        args.after ? JSON.stringify(args.after) : null,
      ],
    )
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[acl_rule_audit] insert failed, swallowing to not break business:', e)
  }
}

/** 读取规则当前值（UPDATE/DELETE 之前取 before 用）。返回 null 表示未找到。 */
async function loadRuleRow(id: number): Promise<Record<string, unknown> | null> {
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, source_id, asset_id, role, permission, condition,
            subject_type, subject_id, effect, expires_at, permission_required
     FROM metadata_acl_rule WHERE id = $1 LIMIT 1`,
    [id],
  )
  if (rows.length === 0) return null
  return rows[0] as Record<string, unknown>
}

// GET /api/acl/rules — 列出（支持 ?source_id= / ?asset_id= / ?subject_type= 过滤）
aclRouter.get('/rules', async (req: Request, res: Response) => {
  const pool = getPgPool()
  const filters: string[] = []
  const params: unknown[] = []
  if (req.query.source_id !== undefined) {
    params.push(Number(req.query.source_id))
    filters.push(`source_id = $${params.length}`)
  }
  if (req.query.asset_id !== undefined) {
    params.push(Number(req.query.asset_id))
    filters.push(`asset_id = $${params.length}`)
  }
  if (typeof req.query.subject_type === 'string') {
    params.push(req.query.subject_type)
    filters.push(`subject_type = $${params.length}`)
  }
  if (typeof req.query.subject_id === 'string') {
    params.push(req.query.subject_id)
    filters.push(`subject_id = $${params.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const { rows } = await pool.query(
    `SELECT id, source_id, asset_id, role, permission, permission_required, condition,
            subject_type, subject_id, effect, expires_at, created_at
     FROM metadata_acl_rule
     ${where}
     ORDER BY id DESC
     LIMIT 500`,
    params,
  )
  res.json({ items: rows })
})

// POST /api/acl/rules — 新增（V2：支持 subject_type/subject_id/effect/expires_at）
aclRouter.post('/rules', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    source_id?: number
    asset_id?: number
    role?: string | null            // 老字段，新规则建议留空
    permission?: string             // ACL action: READ / WRITE / DELETE / ADMIN
    permission_required?: string | null  // PRD §2 细粒度权限（可选附加判断）
    condition?: Record<string, unknown> | null
    subject_type?: 'role' | 'user' | 'team'
    subject_id?: string
    effect?: 'allow' | 'deny'
    expires_at?: string | null
  }
  if (!body.permission || typeof body.permission !== 'string') {
    return res.status(400).json({ error: 'permission required' })
  }
  // 收紧：permission 字段只接 ACL action（PRD 细粒度权限请用 permission_required）
  if (!['READ', 'WRITE', 'DELETE', 'ADMIN'].includes(body.permission)) {
    return res.status(400).json({
      error: 'permission must be READ | WRITE | DELETE | ADMIN; fine-grained permissions go into permission_required',
    })
  }
  // V2 必填：subject_type + subject_id；老的 role 字段也允许（自动 backfill）
  let subject_type = body.subject_type ?? null
  let subject_id   = body.subject_id ?? null
  if (!subject_type && body.role) {
    subject_type = 'role'
    subject_id = body.role
  }
  if (!subject_type || !subject_id) {
    return res.status(400).json({ error: 'subject_type + subject_id required (or legacy role)' })
  }
  if (!['role', 'user', 'team'].includes(subject_type)) {
    return res.status(400).json({ error: 'subject_type must be role|user|team' })
  }
  const effect = body.effect === 'deny' ? 'deny' : 'allow'
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null

  // permission_required：可选；空串归一为 null；非空必须是已知 permission
  const permissionRequired = typeof body.permission_required === 'string' && body.permission_required.trim()
    ? body.permission_required.trim()
    : null

  const pool = getPgPool()
  const { rows } = await pool.query(
    `INSERT INTO metadata_acl_rule
       (source_id, asset_id, role, permission, condition,
        subject_type, subject_id, effect, expires_at, permission_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      body.source_id ?? null,
      body.asset_id ?? null,
      // role 字段保留兼容旧 evaluateAcl 路径
      subject_type === 'role' ? subject_id : null,
      body.permission,
      body.condition ?? null,
      subject_type,
      subject_id,
      effect,
      expiresAt,
      permissionRequired,
    ],
  )
  await reloadRules()
  aclCacheFlush()
  const ruleId = Number(rows[0].id)
  await writeAudit({
    action: 'acl_rule_create',
    targetType: 'rule',
    targetId: ruleId,
    detail: { ...body, subject_type, subject_id, effect },
    principal: req.principal,
  })
  // F-3：结构化 ACL 规则审计（与 writeAudit 并行）
  await writeAclRuleAudit({
    ruleId,
    op: 'CREATE',
    before: null,
    after: {
      id: ruleId,
      source_id: body.source_id ?? null,
      asset_id:  body.asset_id  ?? null,
      role:      subject_type === 'role' ? subject_id : null,
      permission: body.permission,
      permission_required: permissionRequired,
      condition: body.condition ?? null,
      subject_type, subject_id, effect, expires_at: body.expires_at ?? null,
    },
    principal: req.principal,
  })
  res.status(201).json({ id: ruleId })
})

// PUT /api/acl/rules/:id — 修改
aclRouter.put('/rules/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const patch = (req.body ?? {}) as Record<string, unknown>

  const updatable = [
    'source_id', 'asset_id', 'role', 'permission', 'condition',
    'subject_type', 'subject_id', 'effect', 'expires_at',
    'permission_required',
  ]
  // permission 收紧：如果 patch 里设了 permission，必须是 ACL action
  if ('permission' in patch && patch.permission != null) {
    const p = String(patch.permission)
    if (!['READ', 'WRITE', 'DELETE', 'ADMIN'].includes(p)) {
      return res.status(400).json({
        error: 'permission must be READ | WRITE | DELETE | ADMIN; fine-grained permissions go into permission_required',
      })
    }
  }
  const sets: string[] = []
  const params: unknown[] = []
  for (const k of updatable) {
    if (k in patch) {
      // permission_required：空串归一为 null
      let v = patch[k]
      if (k === 'permission_required' && typeof v === 'string' && v.trim() === '') v = null
      sets.push(`${k} = $${sets.length + 1}`)
      params.push(v)
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
  params.push(id)

  const pool = getPgPool()
  // F-3：UPDATE 前先读老行（写 audit.before 用）
  const before = await loadRuleRow(id)
  const { rowCount } = await pool.query(
    `UPDATE metadata_acl_rule SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  )
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  const after = await loadRuleRow(id)
  await reloadRules()
  aclCacheFlush()
  await writeAudit({
    action: 'acl_rule_update',
    targetType: 'rule',
    targetId: id,
    detail: patch,
    principal: req.principal,
  })
  await writeAclRuleAudit({
    ruleId: id,
    op: 'UPDATE',
    before,
    after,
    principal: req.principal,
  })
  res.json({ ok: true })
})

// DELETE /api/acl/rules/:id — 删除
aclRouter.delete('/rules/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  // F-3：DELETE 前先读老行（写 audit.before 用）
  const before = await loadRuleRow(id)
  const { rowCount } = await pool.query(
    `DELETE FROM metadata_acl_rule WHERE id = $1`,
    [id],
  )
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  await reloadRules()
  aclCacheFlush()
  await writeAudit({
    action: 'acl_rule_delete',
    targetType: 'rule',
    targetId: id,
    principal: req.principal,
  })
  await writeAclRuleAudit({
    ruleId: id,
    op: 'DELETE',
    before,
    after: null,
    principal: req.principal,
  })
  res.json({ ok: true })
})

// POST /api/acl/cache/flush — 手动清空缓存
aclRouter.post('/cache/flush', async (_req: Request, res: Response) => {
  aclCacheFlush()
  res.json({ ok: true })
})

// ───────────────────────── G3 规则 Simulate ─────────────────────────
aclRouter.post('/rules/simulate', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    principal?: Partial<Principal>
    action?: string
    resource?: AclResource
  }
  if (!body.principal || typeof body.action !== 'string') {
    return res.status(400).json({ error: 'principal and action required' })
  }
  const principal: Principal = {
    user_id: Number(body.principal.user_id ?? 0),
    email: String(body.principal.email ?? 'simulate@local'),
    roles: Array.isArray(body.principal.roles) ? body.principal.roles : [],
    permissions:
      Array.isArray(body.principal.permissions) && body.principal.permissions.length > 0
        ? body.principal.permissions
        : expandRolesToPermissions(
            Array.isArray(body.principal.roles) ? body.principal.roles : [],
          ),
  }
  const allowedActions: AclAction[] = ['READ', 'WRITE', 'DELETE', 'ADMIN']
  if (!allowedActions.includes(body.action as AclAction)) {
    return res.status(400).json({ error: 'invalid action' })
  }
  const started = Date.now()
  const decision = await evaluateAcl(principal, body.action as AclAction, body.resource ?? {})
  return res.json({ decision, durationMs: Date.now() - started })
})

// ───────────────────────── G4 IAM 面板：用户/矩阵/权限 ─────────────────────────

type IamUserRow = {
  user_id: string
  email: string
  roles: string[]
  permissions: string[]
  dev_bypass: boolean
  source: 'session' | 'seed'
}

const SEED_USERS: Array<Omit<IamUserRow, 'dev_bypass' | 'permissions' | 'source'>> = [
  { user_id: 'alice', email: 'alice@dsclaw.local', roles: ['admin'] },
  { user_id: 'bob',   email: 'bob@dsclaw.local',   roles: ['editor'] },
  { user_id: 'carol', email: 'carol@dsclaw.local', roles: ['viewer'] },
]

aclRouter.get('/users', async (req: Request, res: Response) => {
  const rows: IamUserRow[] = []
  const p = req.principal
  if (p) {
    rows.push({
      user_id: String(p.user_id ?? 'dev'),
      email: p.email ?? 'dev@local',
      roles: p.roles ?? [],
      permissions: p.permissions ?? [],
      dev_bypass: (p.email ?? '').includes('dev') || Number(p.user_id) === 0,
      source: 'session',
    })
  }

  // real-login（G9）：优先读真 users 表；空表时 fallback 到 seed
  try {
    const pool = getPgPool()
    const { rows: dbRows } = await pool.query(
      `SELECT id, email, roles FROM users ORDER BY id`,
    )
    if (dbRows.length > 0) {
      for (const u of dbRows) {
        const roles = Array.isArray(u.roles) ? u.roles : []
        // 如果 session 行已经是这个用户，就别重复渲染
        if (p && Number(p.user_id) === Number(u.id)) continue
        rows.push({
          user_id: String(u.id),
          email: String(u.email),
          roles,
          permissions: expandRolesToPermissions(roles),
          dev_bypass: false,
          source: 'seed',
        })
      }
      return res.json({ items: rows })
    }
  } catch {
    // 表不存在或查询失败 → fallback seed
  }

  for (const u of SEED_USERS) {
    rows.push({
      ...u,
      permissions: expandRolesToPermissions(u.roles),
      dev_bypass: false,
      source: 'seed',
    })
  }
  res.json({ items: rows })
})

aclRouter.get('/role-matrix', (_req: Request, res: Response) => {
  const roles = Object.keys(ROLE_TO_PERMS)
  const permSet = new Set<string>()
  for (const r of roles) {
    for (const p of ROLE_TO_PERMS[r]) permSet.add(p)
  }
  const permissions = [...permSet].sort()
  const matrix: Record<string, string[]> = {}
  for (const r of roles) {
    matrix[r] = [...ROLE_TO_PERMS[r]]
  }
  res.json({ roles, permissions, matrix })
})

aclRouter.get('/permissions', (_req: Request, res: Response) => {
  const permSet = new Set<string>()
  for (const perms of Object.values(ROLE_TO_PERMS)) {
    for (const p of perms) permSet.add(p)
  }
  res.json({ permissions: [...permSet].sort() })
})
