# Design: 统一授权服务

## 总览

```
           ┌──── requireAuth ────┐   ┌──── enforceAcl ────┐
 Request ─►│ Bearer → Principal  │─►│ evaluateAcl(p,a,r)  │─►┐
           └─────────────────────┘   │ allow? filter? mask?│  │
                                     └─────────────────────┘  ▼
                                                         handler
                                                             │
                                                             ▼
                                                 shapeResultByAcl(mask)
                                                             │
                                                             ▼
                                                         response
```

## 类型

```ts
// apps/qa-service/src/auth/types.ts
export interface Principal {
  user_id: number
  email: string
  roles: string[]       // ['admin'] / ['editor','analyst']
}

export type AclAction = 'READ' | 'WRITE' | 'DELETE' | 'ADMIN'

export interface AclResource {
  source_id?: number
  asset_id?: number
  field_id?: number
}

export interface FieldMask {
  field: string              // metadata_field.field_name
  mode: 'hide' | 'star' | 'hash' | 'truncate'
}

export interface SqlFragment {
  where: string              // 参数化 where 片段
  params: unknown[]
}

export interface Decision {
  allow: boolean
  filter?: SqlFragment       // 行级过滤（注入到 search / list 查询）
  mask?: FieldMask[]         // 字段级掩码（后置整形）
  reason?: string            // 拒绝原因，仅日志用
}
```

## Principal 解析（requireAuth）

```ts
// apps/qa-service/src/auth/requireAuth.ts
export function requireAuth(): RequestHandler {
  return async (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '')
    if (!token) return res.status(401).json({ error: 'missing token' })
    try {
      const payload = await verifyToken(token)             // JWKS / HS256 env 二选一
      const roles = await loadRoles(payload.user_id)        // knowledge_user_roles
      req.principal = { user_id: payload.user_id, email: payload.email, roles }
      next()
    } catch (e: any) {
      return res.status(401).json({ error: 'invalid token', detail: e.message })
    }
  }
}
```

Token 验证规则本 change 不锁死（Q-001 未收敛）：支持两种 env 配置——

- `AUTH_JWKS_URL`：拉取 JWKS 验签（BookStack OIDC 场景）
- `AUTH_HS256_SECRET`：HS256 对称密钥（独立 JWT 场景）

二选一；都未配置时 `requireAuth` 进入 **DEV BYPASS** 模式，把所有请求认作
`{user_id: 0, email: 'dev@local', roles: ['admin']}` 并在日志打 WARN。

## ACL 规则引擎

### 规则匹配

1. 以 `(resource, principal.roles[])` 为输入，扫描 `metadata_acl_rule`
2. **具体度排序**：`field_id > asset_id > source_id`；每层各取所有匹配中的最具体一条
3. 匹配 `role IN principal.roles OR role IS NULL`（NULL = 对所有角色生效）
4. Action 匹配：`permission = action` 或 `permission = 'ADMIN'`（ADMIN 是超集）
5. `condition` JSONB 评估（见下节）
6. 任一匹配 allow → 最终 allow（D-003 union 语义）

### condition JSONB 支持的谓词

```json
{
  "op": "and" | "or",
  "args": [
    { "field": "principal.email", "op": "endsWith", "value": "@anthropic.com" },
    { "field": "resource.asset_id", "op": "in", "value": [10, 11, 12] }
  ]
}
```

叶子节点 op：`eq | neq | in | nin | gt | lt | startsWith | endsWith | regex`。
叶子中 `field` 从 `{principal, resource, now}` 取值。

### filter 派生

若 decision.allow 且规则只匹配 `source_id`（不到 asset 级），自动派生一个行级
filter：`WHERE source_id = $1` 或 `WHERE asset_id IN (subq)`，由调用方拼入自己的
SQL。

### mask 派生

规则 `condition.mask` 字段（数组）直接透传：
```json
{ "condition": { "mask": [{"field":"phone","mode":"star"}] } }
```

## 查询前 / 查询后中间件

```ts
// apps/qa-service/src/auth/enforceAcl.ts
export function enforceAcl(opts: {
  action: AclAction
  resourceExtractor: (req: Request) => AclResource | Promise<AclResource>
}): RequestHandler
```

挂载示例：

```ts
// /api/knowledge/search
knowledgeDocsRouter.post(
  '/search',
  requireAuth(),
  enforceAcl({
    action: 'READ',
    resourceExtractor: req => ({ source_id: req.body.source_id }),
  }),
  async (req, res) => {
    const rows = await searchKnowledgeChunks({
      query: req.body.query,
      top_k: req.body.top_k,
      aclFilter: req.aclFilter,           // 注入到 SQL WHERE
    })
    const shaped = shapeResultByAcl(req.aclDecision!, rows)
    res.json({ results: shaped })
  },
)
```

## Admin API

```
GET    /api/acl/rules          列出所有规则（分页）
POST   /api/acl/rules          新增规则
PUT    /api/acl/rules/:id      修改
DELETE /api/acl/rules/:id      删除
POST   /api/acl/cache/flush    清空进程内 LRU
```

所有 Admin API 本身也走 `requireAuth` + `enforceAcl({action:'ADMIN', resourceExtractor: () => ({})})`。

## 缓存（D-004）

- 键：`${user_id}|${roles.sort().join(',')}|${source_id||0}|${asset_id||0}|${field_id||0}|${action}`
- 值：`Decision`
- 实现：`lru-cache` npm 包，max=2000，ttl=10s

## 与现有 change 的联动

- `knowledge-qa`（正在 Lock）：`/api/qa/ask` 也加 `requireAuth + enforceAcl(READ, source_id=<固定默认 source>)`；
  trace.citations 经过 `shapeResultByAcl` 再 emit。
- `mcp-service`：当前无鉴权，下一步另立 change 对齐 MCP 层。
- `governance-rbac`：`knowledge_user_roles` 变为 Principal 的唯一角色源；Roles API
  保持不变。

## 测试策略

- `evaluateAcl` 纯函数单测：层次匹配、union 语义、condition 评估、mask 派生
- `requireAuth` middleware：缺 token / 非法 token / DEV BYPASS
- `enforceAcl` 集成测试：挂到 mock router，验证 403 / 200 / filter 注入
- `shapeResultByAcl`：四种 mode 的输出
- Admin API：CRUD + 非 ADMIN 调用返 403
- 缓存：同一请求两次只评估一次；flush 后重新评估

## 风险

- Token 签发方未定（Q-001）：本 change 通过两套 env 双栈兼容，解 token 策略先收敛再替换。
- `metadata_acl_rule` 规模预估：初期几十条，LRU 够用；上千条时需要加索引 `(source_id, asset_id, field_id, role)`。
- `condition.regex` 存在 ReDoS 风险：评估器加超时保护（50ms / 条）。
- DEV BYPASS 默认开启；**生产环境必须配置 JWKS 或 HS256**，启动时若都没配且 `NODE_ENV=production` 则 fail-fast。
