# Spec: 统一授权服务

## requireAuth 中间件

**Scenario: 缺少 Authorization 头返 401**
- When 请求无 `Authorization` 头
- Then 响应 401 `{ error: "missing token" }`

**Scenario: Bearer 格式非法返 401**
- When `Authorization: "Token abc"`（非 Bearer）
- Then 响应 401

**Scenario: JWT 签名验证失败返 401**
- Given `AUTH_HS256_SECRET=secret`
- When 传入用错密钥签的 JWT
- Then 响应 401 `{ error: "invalid token", detail: string }`

**Scenario: 合法 token 注入 principal**
- Given 合法 JWT payload `{ sub: 5, email: "a@b.com" }`
- And `knowledge_user_roles` 中 user_id=5 role='editor'
- When 请求进入 handler
- Then `req.principal = { user_id: 5, email: "a@b.com", roles: ["editor"] }`

**Scenario: DEV BYPASS 模式**
- Given 既没配 `AUTH_JWKS_URL` 也没配 `AUTH_HS256_SECRET`
- And `NODE_ENV !== 'production'`
- When 任意请求进入
- Then `req.principal = { user_id: 0, email: "dev@local", roles: ["admin"] }`
- And 日志输出 `WARN: AUTH DEV BYPASS enabled`

**Scenario: 生产模式缺 Auth 配置 fail-fast**
- Given `NODE_ENV=production` 且两个 AUTH 配置都缺失
- When 服务启动
- Then 进程退出，日志 `FATAL: no AUTH_JWKS_URL or AUTH_HS256_SECRET in production`

---

## evaluateAcl 规则引擎

**Scenario: 无匹配规则 → deny**
- Given `metadata_acl_rule` 为空
- When `evaluateAcl(principal, 'READ', { source_id: 1 })`
- Then 返回 `{ allow: false, reason: "no matching rule" }`

**Scenario: role=NULL 规则对所有角色生效**
- Given 规则 `{ source_id: 1, role: null, permission: 'READ' }`
- When `evaluateAcl({roles:['editor']}, 'READ', {source_id:1})`
- Then `allow = true`

**Scenario: 多条规则 union 语义**
- Given 规则 A `{asset_id:10, role:'viewer', permission:'READ'}`
- And   规则 B `{asset_id:10, role:'editor', permission:'WRITE'}`
- When principal `roles=['viewer']` 请求 READ asset_id=10
- Then `allow = true`（A 命中）

**Scenario: 具体度优先**
- Given 规则 A `{source_id:1, permission:'READ'}` 对所有生效
- And   规则 B `{asset_id:10, role:'blocked', permission:'ADMIN'}` （即 READ 也允许）
- When principal `roles=['blocked']` READ asset_id=10
- Then `allow = true`（B 更具体并含 READ）

**Scenario: ADMIN 权限是超集**
- Given 规则 `{source_id:1, role:'admin', permission:'ADMIN'}`
- When principal `roles=['admin']` 请求 READ/WRITE/DELETE source_id=1
- Then 三者都 `allow = true`

**Scenario: condition 命中才生效**
- Given 规则 condition = `{op:'eq', field:'principal.email', value:'a@b.com'}`
- When 一个 email='a@b.com' 的 principal 匹配此规则
- Then `allow = true`
- When 另一个 email='x@y.com' 的 principal 匹配时
- Then `allow = false`（条件不满足，跳过此规则）

**Scenario: 仅 source 级规则派生行级 filter**
- Given 仅 `{source_id: 1, role: 'analyst', permission:'READ'}`
- When `evaluateAcl({roles:['analyst']}, 'READ', {})`
- Then `decision.filter.where` 含 `source_id = $1`
- And `decision.filter.params = [1]`

**Scenario: mask 字段从 condition 透传**
- Given 规则 condition.mask = `[{field:'phone', mode:'star'}]`
- Then decision.mask 包含同样内容

---

## enforceAcl 中间件

**Scenario: deny 返 403**
- Given `evaluateAcl` 返回 `allow=false`
- When 请求命中此中间件
- Then 响应 403 `{ error: "forbidden", reason: string }`

**Scenario: allow 注入 aclFilter / aclDecision**
- Given decision `{allow:true, filter:{where:"source_id=$1", params:[1]}}`
- Then handler 里 `req.aclFilter = decision.filter`
- And `req.aclDecision = decision`

**Scenario: 缓存命中不重复评估**
- Given 同一 principal + resource 10 秒内第二次请求
- Then `evaluateAcl` 不再被调用
- And `req.aclDecision` 与第一次相同

**Scenario: flush 后重新评估**
- Given 第一次请求后 `POST /api/acl/cache/flush`
- When 第二次同样请求进入
- Then `evaluateAcl` 再次被调用

---

## shapeResultByAcl

**Scenario: hide 删除字段**
- Given 行 `{id:1, name:"A", phone:"138..."}`，mask `[{field:'phone', mode:'hide'}]`
- Then 输出 `{id:1, name:"A"}`（phone 键不存在）

**Scenario: star 掩码**
- Given phone="13800138000", mode='star'
- Then 输出字段值 `"***"`

**Scenario: hash SHA1 前 8 位**
- Given email="a@b.com", mode='hash'
- Then 输出字段值为 8 位 hex

**Scenario: truncate 前 4 字符**
- Given content="长文本内容...", mode='truncate'
- Then 输出 `"长文本内..."`（或统一规则）

---

## Admin API

**Scenario: 非 ADMIN 列规则返 403**
- Given principal roles=['editor']
- When GET /api/acl/rules
- Then 403

**Scenario: ADMIN 创建规则**
- Given principal roles=['admin']
- When POST /api/acl/rules body `{source_id:1, role:'analyst', permission:'READ'}`
- Then `metadata_acl_rule` 插入一行
- And 响应 201 `{id: number}`

**Scenario: 删除规则后缓存失效**
- Given 已缓存 decision
- When DELETE /api/acl/rules/:id
- Then 对应缓存被清；下次请求重新 evaluateAcl
