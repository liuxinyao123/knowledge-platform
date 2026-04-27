/**
 * notebooks · accessibility + GET 分段 + members CRUD
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/notebook-sharing-spec.md
 *
 * 策略：vi.mock pgDb + auth/index（替换 requireAuth 为 pass-through 注入 principal），
 * 然后用 supertest 打 router。覆盖的 Scenario：
 *   - accessibility: owner / user 直授 / team 授 / 403
 *   - GET / 返回 { items, shared }：双分区；空态双 key 都在
 *   - POST /:id/members: subject_id 校验 / 邮箱格式 / upsert
 *   - DELETE /:id/members/:type/:sid: 路径参数
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// principal 注入控制
let currentPrincipal: {
  user_id: number; email: string; roles: string[]; permissions: string[];
  team_ids?: string[]; team_names?: string[]
} = {
  user_id: 0, email: 'nobody@x.com', roles: [], permissions: [],
  team_ids: [], team_names: [],
}
function setPrincipal(p: typeof currentPrincipal) { currentPrincipal = p }

// Pool mock：允许每条 SQL 通过 rowsFor 动态返回
type SqlHandler = (sql: string, params: unknown[]) => unknown[] | undefined
let sqlHandler: SqlHandler = () => []
function setSqlHandler(h: SqlHandler) { sqlHandler = h }

vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const rows = sqlHandler(sql, params ?? []) ?? []
      return { rows, rowCount: rows.length }
    }),
  }),
}))

// requireAuth：pass-through，把 currentPrincipal 注入到 req
vi.mock('../auth/index.ts', async () => {
  // 其它 auth exports 不需要在这里 mock；只替换 requireAuth
  const actual = await vi.importActual<Record<string, unknown>>('../auth/index.ts')
  return {
    ...actual,
    requireAuth: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      ;(req as unknown as { principal: typeof currentPrincipal }).principal = currentPrincipal
      next()
    },
  }
})

// 业务依赖：streamNotebookChat / artifactGenerator 不触发，只为模块导入
vi.mock('../services/notebookChat.ts', () => ({ streamNotebookChat: vi.fn() }))
vi.mock('../services/artifactGenerator.ts', () => ({
  executeArtifact: vi.fn(),
}))

async function buildApp() {
  const { notebooksRouter } = await import('../routes/notebooks.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/notebooks', notebooksRouter)
  return app
}

beforeEach(() => {
  sqlHandler = () => []
  currentPrincipal = {
    user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
    team_ids: [], team_names: [],
  }
})

describe('accessibility · loadAccessibleNotebook (通过 GET /:id 间接测试)', () => {
  it('owner 恒可访问', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/FROM notebook_source/.test(sql)) return []       // sources
      if (/FROM notebook_chat_message/.test(sql)) return [] // messages
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks/10')
    // 只要不是 403/404 就说明 access 通过；详情的 shape 不在本 spec 范围
    expect([200, 500]).toContain(res.status) // 500 可能来自后续 SQL，但至少不是 403
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(404)
  })

  it('user 直授（notebook_member 命中 user 行）', async () => {
    setPrincipal({
      user_id: 2, email: 'bob@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/FROM notebook_member/.test(sql)) return [{ role: 'reader' }]
      if (/FROM notebook_source/.test(sql)) return []
      if (/FROM notebook_chat_message/.test(sql)) return []
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks/10')
    expect(res.status).not.toBe(403)
  })

  it('team 授（principal.team_ids 匹配 notebook_member team 行）', async () => {
    setPrincipal({
      user_id: 3, email: 'carol@corp.com', roles: ['viewer'], permissions: [],
      team_ids: ['7'], team_names: ['market'],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/FROM notebook_member/.test(sql)) return [{ role: 'editor' }]
      if (/FROM notebook_source/.test(sql)) return []
      if (/FROM notebook_chat_message/.test(sql)) return []
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks/10')
    expect(res.status).not.toBe(403)
  })

  it('既非 owner 也未受任何授权 → 403', async () => {
    setPrincipal({
      user_id: 9, email: 'eve@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/FROM notebook_member/.test(sql)) return []
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks/10')
    expect(res.status).toBe(403)
  })

  it('notebook 不存在 → 404', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) return []
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks/999')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/notebooks · 分段返回 { items, shared }', () => {
  it('owner + shared 分别落在 items / shared', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: ['3'], team_names: ['market'],
    })
    setSqlHandler((sql) => {
      if (/owner_email = \$1/.test(sql)) {
        // 我的
        return [
          { id: 1, name: 'A', description: null, owner_email: 'alice@corp.com',
            access: 'owner', created_at_ms: 1, updated_at_ms: 1,
            source_count: 0, message_count: 0 },
        ]
      }
      if (/JOIN notebook_member nm/.test(sql)) {
        return [
          { id: 2, name: 'B', description: null, owner_email: 'bob@corp.com',
            access: 'shared-direct', created_at_ms: 1, updated_at_ms: 1,
            source_count: 0, message_count: 0 },
          { id: 3, name: 'C', description: null, owner_email: 'bob@corp.com',
            access: 'shared-team', created_at_ms: 1, updated_at_ms: 1,
            source_count: 0, message_count: 0 },
        ]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(Array.isArray(res.body.shared)).toBe(true)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.shared).toHaveLength(2)
  })

  it('空态：items 和 shared 两个 key 都在，都是空数组', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler(() => [])
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('items')
    expect(res.body).toHaveProperty('shared')
    expect(res.body.items).toEqual([])
    expect(res.body.shared).toEqual([])
  })

  it('未登录 → 401', async () => {
    setPrincipal({
      user_id: 0, email: '', roles: [], permissions: [],
      team_ids: [], team_names: [],
    })
    const app = await buildApp()
    const res = await request(app).get('/api/notebooks')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/notebooks/:id/members', () => {
  it('缺 subject_id → 400', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .post('/api/notebooks/10/members')
      .send({ subject_type: 'user' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/subject_id/)
  })

  it('subject_type=user 但 subject_id 不是邮箱 → 400', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .post('/api/notebooks/10/members')
      .send({ subject_type: 'user', subject_id: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/email/)
  })

  it('owner 合法添加 user 成员 → 201（upsert 语义）', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    let sawInsert = false
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/INSERT INTO notebook_member/.test(sql)) {
        sawInsert = true
        // upsert 语义在 SQL 里；返回空行 OK
        expect(sql).toMatch(/ON CONFLICT/)
        return []
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .post('/api/notebooks/10/members')
      .send({ subject_type: 'user', subject_id: 'bob@corp.com', role: 'editor' })
    expect(res.status).toBe(201)
    expect(sawInsert).toBe(true)
  })

  it('非 owner 添加成员 → 403', async () => {
    setPrincipal({
      user_id: 9, email: 'eve@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .post('/api/notebooks/10/members')
      .send({ subject_type: 'user', subject_id: 'bob@corp.com' })
    expect(res.status).toBe(403)
  })

  it('owner 添加 team 成员（subject_type=team 不要求邮箱格式）→ 201', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .post('/api/notebooks/10/members')
      .send({ subject_type: 'team', subject_id: '3', role: 'reader' })
    expect(res.status).toBe(201)
  })
})

describe('DELETE /api/notebooks/:id/members/:type/:sid', () => {
  it('owner 删除成员 → 200 { ok:true, removed:N }', async () => {
    setPrincipal({
      user_id: 1, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    let sawDelete = false
    setSqlHandler((sql, params) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      if (/DELETE FROM notebook_member/.test(sql)) {
        sawDelete = true
        // params 应当是 [notebook_id, subject_type, subject_id]
        expect(params[1]).toBe('user')
        expect(params[2]).toBe('bob@corp.com')
        // 模拟实际删除了 1 行
        return [{ dummy: 1 }]  // rowCount 基于 rows.length
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .delete('/api/notebooks/10/members/user/bob@corp.com')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.removed).toBe(1)
    expect(sawDelete).toBe(true)
  })

  it('非 owner 删除 → 403', async () => {
    setPrincipal({
      user_id: 9, email: 'eve@corp.com', roles: ['viewer'], permissions: [],
      team_ids: [], team_names: [],
    })
    setSqlHandler((sql) => {
      if (/FROM notebook WHERE id/.test(sql)) {
        return [{ id: 10, owner_email: 'alice@corp.com', name: 'My Book' }]
      }
      return []
    })
    const app = await buildApp()
    const res = await request(app)
      .delete('/api/notebooks/10/members/user/bob@corp.com')
    expect(res.status).toBe(403)
  })
})
