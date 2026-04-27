# 端到端权限验证矩阵 · 2026-04-22

> 配套 `scripts/verify-permissions.mjs` 自动化脚本。本文件说明每个端点的预期、
> 当前实现的"门"是什么、以及测试时该断言哪个状态码。
>
> 角色 → 权限源代码：`apps/qa-service/src/auth/permissions.ts`
>
> | 角色 | 权限集合 |
> |---|---|
> | `viewer` / `user` | `knowledge:overview`, `knowledge:search`, `knowledge:spaces`, `knowledge:ingest`, `knowledge:qa`, `knowledge:ops:read`, `assets:view` |
> | `editor` | viewer 全部 + `knowledge:ops:manage` |
> | `admin` | editor 全部 + `permission:manage`, `rule:edit`, `audit:view`, `explain:view`, `iam:manage` |

---

## 一、门类型说明

代码里有 **两种门**，行为差异极大：

### 1. `requiredPermission` 门（PRD §17.4 路径）
- 直接查 `principal.permissions` 是否包含指定 permission
- 不读 `metadata_acl_rule` 表，**不会因为表空被自锁**
- 现状：`/api/auth/*` 写操作、`/api/acl/*` 全部走这条
- 预期：admin = 200，editor / viewer = 403

### 2. `action + resourceExtractor` 门（旧 ACL 路径）
- 走 `evaluateAcl()` → 查 `metadata_acl_rule` 表 → 按 role/permission/condition 过滤
- **deny by default**：表里没有匹配规则就返 403（包括 admin）
- 现状：`/api/qa/*`, `/api/agent/*`, `/api/knowledge/docs/*`, `/api/ingest/scan-folder`, `/api/governance/*` 都走这条
- 预期：取决于 `metadata_acl_rule` 是否有种子；空表时所有人都被拒

> ⚠️ **重要**：测试这条路径前必须先确认表里有合理的兜底规则，否则你会看到 admin 也 403。
> 兜底规则示意（INSERT 语句见本文档底部 §四）。

### 3. DEV BYPASS
- `apps/qa-service/src/auth/requireAuth.ts` 在 `NODE_ENV !== 'production'` 且 `AUTH_HS256_SECRET` 未配置时，**所有请求都被注入 admin principal + ADMIN_PERMS**
- 跑权限测试**必须先把 `AUTH_HS256_SECRET` 配上**，否则 editor / viewer 也能访问 admin 端点（DEV BYPASS 一开就全部 200，403 路径完全失效）

---

## 二、端点 × 角色 期望矩阵

### 2.1 `/api/auth/*` — `requiredPermission` 门

| Method | Path | Required | admin | editor | viewer | 未带 token |
|---|---|---|---|---|---|---|
| GET    | `/api/auth/me`                          | login only | 200 | 200 | 200 | 401 |
| POST   | `/api/auth/login`                       | (公开)     | 200 | 200 | 200 | 200 |
| POST   | `/api/auth/logout`                      | login only | 200 | 200 | 200 | 401 |
| POST   | `/api/auth/password`                    | self only  | 200 | 200 | 200 | 401 |
| POST   | `/api/auth/register`                    | `permission:manage` | 201 | **403** | **403** | 401 |
| PATCH  | `/api/auth/users/:id`                   | `permission:manage` | 200/400 | **403** | **403** | 401 |
| DELETE | `/api/auth/users/:id`                   | `permission:manage` | 200 | **403** | **403** | 401 |
| POST   | `/api/auth/users/:id/reset-password`    | `permission:manage` | 200 | **403** | **403** | 401 |

### 2.2 `/api/acl/*` — `requiredPermission` 门

| Method | Path | Required | admin | editor | viewer | 未带 token |
|---|---|---|---|---|---|---|
| GET    | `/api/acl/rules`           | `permission:manage` | 200 | **403** | **403** | 401 |
| POST   | `/api/acl/rules`           | `permission:manage` | 201/400 | **403** | **403** | 401 |
| PUT    | `/api/acl/rules/:id`       | `permission:manage` | 200/404 | **403** | **403** | 401 |
| DELETE | `/api/acl/rules/:id`       | `permission:manage` | 200/404 | **403** | **403** | 401 |
| POST   | `/api/acl/cache/flush`     | `permission:manage` | 200 | **403** | **403** | 401 |
| POST   | `/api/acl/rules/simulate`  | `permission:manage` | 200/400 | **403** | **403** | 401 |
| GET    | `/api/acl/users`           | `permission:manage` | 200 | **403** | **403** | 401 |
| GET    | `/api/acl/role-matrix`     | `permission:manage` | 200 | **403** | **403** | 401 |
| GET    | `/api/acl/permissions`     | `permission:manage` | 200 | **403** | **403** | 401 |

### 2.3 `/api/governance/*` — `action + resource` 门（deny-by-default 风险）

| Method | Path | Action | admin | editor | viewer | 未带 token |
|---|---|---|---|---|---|---|
| GET    | `/api/governance/tags`               | READ  | 200* | 200* | 200* | 401 |
| POST   | `/api/governance/tags/merge`         | WRITE | 200* | 200* | **403** | 401 |
| POST   | `/api/governance/tags/rename`        | WRITE | 200* | 200* | **403** | 401 |
| GET    | `/api/governance/duplicates`         | READ  | 200* | 200* | 200* | 401 |
| POST   | `/api/governance/duplicates/merge`   | WRITE | 200* | 200* | **403** | 401 |
| POST   | `/api/governance/duplicates/ignore`  | WRITE | 200* | 200* | **403** | 401 |
| GET    | `/api/governance/quality`            | READ  | 200* | 200* | 200* | 401 |
| GET    | `/api/governance/quality/:kind`      | READ  | 200* | 200* | 200* | 401 |
| POST   | `/api/governance/quality/:kind/ignore` | WRITE | 200* | 200* | **403** | 401 |
| GET    | `/api/governance/audit-log`          | READ  | 200* | 200* | 200* | 401 |
| GET    | `/api/governance/audit-log/export`   | READ  | 200* | 200* | 200* | 401 |

\* "200*" 表示**前提是 `metadata_acl_rule` 表里有匹配规则**。空表时全部 403。

> 注意：当前 `evaluateAcl` 用的是 rule.permission（`READ` / `WRITE` / `ADMIN`）匹配 action，
> 不是 principal.permissions。所以即便 viewer 没有 `knowledge:ops:manage`，只要表里有
> `permission='WRITE', role=NULL` 的开放规则，他依然能 WRITE。这是**当前实现的语义缺口**，
> 表里建议拆 role：viewer 给 READ-only 规则，editor/admin 给 WRITE 规则。

### 2.4 `/api/qa/*`, `/api/agent/*`, `/api/knowledge/docs/*`, `/api/ingest/*` — `action + resource` 门

| Method | Path | Action | 关键点 |
|---|---|---|---|
| POST | `/api/qa/ask`              | READ on body.source_id | 同上 deny-by-default |
| POST | `/api/agent/ask`           | READ on body.source_id | 同上 |
| POST | `/api/knowledge/docs/...`  | WRITE/READ on body.source_id(s) | 同上 |
| POST | `/api/ingest/scan-folder`  | WRITE on body.source_id | 同上 |
| GET  | `/api/ingest/recent`       | (仅 requireAuth)      | admin/editor/viewer 都 200 |

### 2.5 `/api/mcp/*`, `/api/graph/*` — 仅 `requireAuth`

| Method | Path | admin | editor | viewer | 未带 token |
|---|---|---|---|---|---|
| GET  | `/api/mcp/stats`        | 200 | 200 | 200 | 401 |
| POST | `/api/mcp/debug-query`  | 200 | 200 | 200 | 401 |
| POST | `/api/graph/cypher`     | 200 | 200 | 200 | 401 |

> 这三个端点目前**没有 enforceAcl 门**，任何登录用户都可访问。是否要加 `requiredPermission: 'permission:manage'`
> 是个 followup（建议加，调试 PG 不该让 viewer 看到）。

---

## 三、前端 RequirePermission 期望

| 路由 / 区域 | 守卫 | admin | editor | viewer |
|---|---|---|---|---|
| Layout 侧栏「管理」分组 + `/iam` 入口 | `name="permission:manage"` | 显示 | 隐藏 | 隐藏 |
| `/iam` 页面整体              | `name="permission:manage"` | 显示 3 Tab | 显示锁屏 fallback | 显示锁屏 fallback |
| `/governance` → 数据权限 Tab | `name="permission:manage"` | 显示 DataPermTab | 显示锁屏 | 显示锁屏 |
| `/governance` → 知识治理/成员/空间 Tab | (无守卫，API 端 403) | 正常 | 正常但写操作 403 | 正常但写操作 403 |
| 其它页（overview/spaces/search/ingest/qa/assets/mcp） | (无守卫) | 正常 | 正常 | 正常 |

**手动验证清单**（用浏览器开 3 个无痕窗口分别登 admin / editor / viewer）：

1. 侧栏「管理 / IAM · 权限」入口：admin 可见，其它两人不可见
2. 直接敲 URL `/iam`：admin 进得去；editor / viewer 看到 `🔒 需要 permission:manage 权限` 锁屏
3. `/governance` → 切到「数据权限」Tab：admin 看到列表；其它两人看到锁屏
4. `/iam` 用户列表里能看到 alice/bob/carol seed 数据（如果 `users` 表为空才出现）
5. 顶栏点 admin 的"修改密码"能成功；editor / viewer 也能改自己的（`/api/auth/password` 不需要 admin 权限）

---

## 四、跑测前的环境准备

### 4.1 关掉 DEV BYPASS（必须）

```bash
# qa-service/.env 或仓库根 .env
AUTH_HS256_SECRET=local-dev-secret-please-change   # 任何长度 ≥16 的字符串
```

如果不配，所有请求都被注入 admin principal，403 路径完全无法测。

### 4.2 准备 3 个真用户

最快路径：admin 已经被 `ensureDefaultAdmin()` seed 了（`admin@dsclaw.local / admin123`），
然后用 admin 调 `/api/auth/register` 创 editor + viewer：

```bash
# 1) admin 登录
ADMIN_TOKEN=$(curl -s http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@dsclaw.local","password":"admin123"}' \
  | jq -r .token)

# 2) 创 editor
curl -s http://localhost:3001/api/auth/register \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"editor@dsclaw.local","password":"editor1234","roles":["editor"]}'

# 3) 创 viewer
curl -s http://localhost:3001/api/auth/register \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"viewer@dsclaw.local","password":"viewer1234","roles":["viewer"]}'
```

或者直接跑配套脚本 `scripts/verify-permissions.mjs`，它内置 `--seed` 子命令。

### 4.3 （可选）兜底 `metadata_acl_rule` 规则

如果你只想测 §2.1 / §2.2 的 `requiredPermission` 路径，可以跳过这步。
但要测 §2.3 / §2.4 的 `action+resource` 路径，需要先 seed 至少一条匹配规则，否则 admin 也 403。

```sql
-- 给所有人 READ 全资源
INSERT INTO metadata_acl_rule (source_id, asset_id, role, permission, condition)
VALUES (NULL, NULL, NULL, 'READ', NULL);

-- 给 editor + admin WRITE 全资源
INSERT INTO metadata_acl_rule (source_id, asset_id, role, permission, condition)
VALUES
  (NULL, NULL, 'editor', 'WRITE', NULL),
  (NULL, NULL, 'admin',  'WRITE', NULL);

-- 让 admin 走 ADMIN 超集
INSERT INTO metadata_acl_rule (source_id, asset_id, role, permission, condition)
VALUES (NULL, NULL, 'admin', 'ADMIN', NULL);
```

插完后调一次 `POST /api/acl/cache/flush` 让规则缓存重载。

---

## 五、运行验证

```bash
# 默认假定 qa-service 在 http://localhost:3001
node scripts/verify-permissions.mjs --seed   # 创 editor+viewer 用户（幂等：409 视为已存在）
node scripts/verify-permissions.mjs          # 跑全部断言

# 只跑 requiredPermission 部分（不依赖 metadata_acl_rule）
node scripts/verify-permissions.mjs --only required-perm

# 自定义 base
QA_BASE=http://localhost:3001 ADMIN_EMAIL=admin@dsclaw.local ADMIN_PASSWORD=admin123 \
  node scripts/verify-permissions.mjs
```

输出格式：每个断言一行 `[PASS|FAIL] METHOD path → expected=X actual=Y`，
末尾 `N/M passed` 汇总；任意 FAIL 退出码非 0。

---

## 六、followups（跑完后视情况开）

- [ ] **VR-1**：`/api/mcp/stats`, `/api/mcp/debug-query`, `/api/graph/cypher` 加 `requiredPermission: 'permission:manage'`
- [ ] **VR-2**：governance/tags/duplicates/quality/auditLog 这一批从 `action+resource` 迁到 `requiredPermission`（用 `knowledge:ops:read` / `knowledge:ops:manage` 区分），把 deny-by-default 风险消掉
- [ ] **VR-3**：把 `metadata_acl_rule` 的 seed 规则写进 `runPgMigrations()`，保证 fresh 环境下不会全员 403
- [ ] **VR-4**：补 supertest 集成测试覆盖这份矩阵（与本脚本互补：脚本测 live server，supertest 测纯路由层）
