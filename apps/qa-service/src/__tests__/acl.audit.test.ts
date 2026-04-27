/**
 * F-3 · ACL 规则审计（acl_rule_audit）
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-audit-spec.md
 *
 * 验证点：
 *   - CREATE / UPDATE / DELETE 三个分支都写了 acl_rule_audit
 *   - 写入失败（抛异常）不阻塞业务 200 返回
 *   - GET /api/iam/acl/audit：rule_id / actor / since / until / limit 过滤；total 与 limit 独立
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// principal 注入控制
let currentPrincipal: {
  user_id: number; email: string; roles: string[]; permissions: string[];
  team_ids?: string[]; team_names?: string[]
} = {
  user_id: 1, email: 'admin@corp.com', roles: ['admin'],
  permissions: ['iam:manage', 'permission:manage'],
  team_ids: [], team_names: [],
}
function setPrincipal(p: typeof currentPrincipal) { currentPrincipal = p }

// Pool mock
type QueryFn = (sql: string, params: unknown[]) =>
  { rows: unknown[]; rowCount?: number } | Promise<{ rows: unknown[]; rowCount?: number }>
let handler: QueryFn = () => ({ rows: [] })
function setHandler(h: QueryFn) { handler = h }

vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const r = await handler(sql, params ?? [])
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }
    }),
  }),
}))

// 其它依赖短路
vi.mock('../services/audit.ts', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../auth/evaluateAcl.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/evaluateAcl.ts')
  return { ...actual, reloadRules: vi.fn().mockResolvedValue([]) }
})
vi.mock('../auth/aclCache.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/aclCache.ts')
  return { ...actual, aclCacheFlush: vi.fn() }
})

// requireAuth / enforceAcl pass-through
vi.mock('../auth/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../auth/index.ts')
  return {
    ...actual,
    requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      ;(req as unknown as { principal: typeof currentPrincipal }).principal = currentPrincipal
      next()
    },
    enforceAcl: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  }
})

async function buildApp() {
  const { aclRouter } = await import('../routes/acl.ts')
  const { iamAclRouter } = await import('../routes/iamAcl.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/acl', aclRouter)
  app.use('/api/iam/acl', iamAclRouter)
  return app
}

beforeEach(() => {
  handler = () => ({ rows: [] })
  currentPrincipal = {
    user_id: 1, email: 'admin@corp.com', roles: ['admin'],
    permissions: ['iam:manage', 'permission:manage'],
    team_ids: [], team_names: [],
  }
})

describe('acl_rule_audit · 写入点', () => {
  it('POST /api/acl/rules 成功 → 同时写入 acl_rule_audit', async () => {
    let sawAcrAudit = false
    handler = (sql) => {
      if (/INSERT INTO metadata_acl_rule/.test(sql)) {
        return { rows: [{ id: 42 }] }
      }
      if (/INSERT INTO acl_rule_audit/.test(sql)) {
        sawAcrAudit = true
        return { rows: [] }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app)
      .post('/api/acl/rules')
      .send({
        permission: 'READ',
        subject_type: 'role', subject_id: 'editor',
      })
    expect(res.status).toBe(201)
    expect(sawAcrAudit).toBe(true)
  })

  it('PUT /api/acl/rules/:id 成功 → 读老行 + 读新行 + 写 audit(UPDATE)', async () => {
    let selectCount = 0
    let auditParams: unknown[] | null = null
    handler = (sql, params) => {
      if (/SELECT id, source_id, asset_id, role/.test(sql)) {
        selectCount++
        return { rows: [{
          id: 5, source_id: null, asset_id: null, role: null,
          permission: 'READ', condition: null,
          subject_type: 'role', subject_id: 'editor',
          effect: 'allow', expires_at: null, permission_required: null,
        }] }
      }
      if (/UPDATE metadata_acl_rule/.test(sql)) {
        return { rows: [{ id: 5 }], rowCount: 1 }
      }
      if (/INSERT INTO acl_rule_audit/.test(sql)) {
        auditParams = params
        return { rows: [] }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app)
      .put('/api/acl/rules/5')
      .send({ effect: 'deny' })
    expect(res.status).toBe(200)
    // 读老行 + 读新行 = 2 次 SELECT
    expect(selectCount).toBe(2)
    expect(auditParams).not.toBeNull()
    // params: [ruleId, actor_user_id, actor_email, op, before_json, after_json]
    expect(auditParams![0]).toBe(5)
    expect(auditParams![3]).toBe('UPDATE')
    expect(auditParams![4]).toContain('"subject_type":"role"')
    expect(auditParams![5]).toContain('"subject_type":"role"')
  })

  it('DELETE /api/acl/rules/:id 成功 → after_json 为 NULL', async () => {
    let auditParams: unknown[] | null = null
    handler = (sql, params) => {
      if (/SELECT id, source_id, asset_id, role/.test(sql)) {
        return { rows: [{
          id: 7, source_id: 3, asset_id: null, role: null,
          permission: 'READ', condition: null,
          subject_type: 'team', subject_id: '3',
          effect: 'allow', expires_at: null, permission_required: null,
        }] }
      }
      if (/DELETE FROM metadata_acl_rule/.test(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (/INSERT INTO acl_rule_audit/.test(sql)) {
        auditParams = params
        return { rows: [] }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app).delete('/api/acl/rules/7')
    expect(res.status).toBe(200)
    expect(auditParams).not.toBeNull()
    expect(auditParams![0]).toBe(7)
    expect(auditParams![3]).toBe('DELETE')
    expect(auditParams![4]).toContain('"subject_type":"team"')   // before
    expect(auditParams![5]).toBeNull()                           // after = NULL
  })

  it('audit INSERT 抛异常 → 业务仍 201/200；错误被 console.error 吞掉', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    handler = (sql) => {
      if (/INSERT INTO metadata_acl_rule/.test(sql)) {
        return { rows: [{ id: 100 }] }
      }
      if (/INSERT INTO acl_rule_audit/.test(sql)) {
        throw new Error('audit table missing')
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app)
      .post('/api/acl/rules')
      .send({ permission: 'READ', subject_type: 'role', subject_id: 'editor' })
    expect(res.status).toBe(201)
    expect(err).toHaveBeenCalled()
  })
})

describe('GET /api/iam/acl/audit', () => {
  it('无过滤 → 返回 { items, total }；items.length ≤ limit', async () => {
    handler = (sql) => {
      if (/COUNT\(\*\)::int AS total/.test(sql)) {
        return { rows: [{ total: 200 }] }
      }
      if (/FROM acl_rule_audit/.test(sql)) {
        return { rows: Array.from({ length: 50 }).map((_, i) => ({
          id: i + 1, rule_id: 42, actor_user_id: 1, actor_email: 'a@b.com',
          op: 'CREATE', before_json: null, after_json: { permission: 'READ' },
          at_ms: Date.now(),
        })) }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app).get('/api/iam/acl/audit')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.items.length).toBe(50)
  })

  it('按 rule_id 过滤', async () => {
    let whereClause = ''
    handler = (sql) => {
      whereClause = sql
      if (/COUNT\(\*\)::int AS total/.test(sql)) {
        return { rows: [{ total: 3 }] }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    const res = await request(app).get('/api/iam/acl/audit?rule_id=42')
    expect(res.status).toBe(200)
    expect(whereClause).toMatch(/rule_id = \$1/)
  })

  it('按 actor 过滤', async () => {
    let whereClause = ''
    handler = (sql) => {
      whereClause = sql
      if (/COUNT/.test(sql)) return { rows: [{ total: 0 }] }
      return { rows: [] }
    }
    const app = await buildApp()
    await request(app).get('/api/iam/acl/audit?actor=bob@corp.com')
    expect(whereClause).toMatch(/actor_email = \$1/)
  })

  it('按时间窗过滤', async () => {
    let whereClause = ''
    handler = (sql) => {
      whereClause = sql
      if (/COUNT/.test(sql)) return { rows: [{ total: 0 }] }
      return { rows: [] }
    }
    const app = await buildApp()
    await request(app).get('/api/iam/acl/audit?since=2026-04-20T00:00:00Z&until=2026-04-22T00:00:00Z')
    expect(whereClause).toMatch(/at >= /)
    expect(whereClause).toMatch(/at < /)
  })

  it('limit 上限 500', async () => {
    let passedLimit: unknown = null
    handler = (sql, params) => {
      if (/COUNT/.test(sql)) return { rows: [{ total: 10000 }] }
      if (/FROM acl_rule_audit/.test(sql) && /LIMIT/.test(sql)) {
        passedLimit = params[params.length - 1]
        return { rows: [] }
      }
      return { rows: [] }
    }
    const app = await buildApp()
    await request(app).get('/api/iam/acl/audit?limit=9999')
    expect(passedLimit).toBe(500)   // clamp 到 500
  })
})
