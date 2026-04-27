# Design: 用户权限体系

## 数据库层

### 表：knowledge_user_roles
```sql
CREATE TABLE IF NOT EXISTS knowledge_user_roles (
  user_id     INT          NOT NULL,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL DEFAULT '',
  role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
);
```

- `user_id`：BookStack 用户 ID（与 `/api/users` 返回的 id 一致）
- 角色映射 BookStack 内置 Role：admin→1, editor→2, viewer→3

### 表：knowledge_shelf_visibility
```sql
CREATE TABLE IF NOT EXISTS knowledge_shelf_visibility (
  shelf_id    INT          NOT NULL,
  shelf_name  VARCHAR(255) NOT NULL DEFAULT '',
  visibility  ENUM('public','team','private') NOT NULL DEFAULT 'public',
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shelf_id)
);
```

### 迁移策略
- qa-service 启动时自动执行 `CREATE TABLE IF NOT EXISTS`（轻量迁移，适合单实例）

---

## 后端：qa-service 扩展

### 新文件
```
apps/qa-service/src/
  services/
    db.ts              # MySQL 连接池（mysql2/promise）
  routes/
    governance.ts      # /api/governance/* 路由
```

### 环境变量（.env）
```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=bookstack
DB_USER=bookstack
DB_PASS=bookstack_secret
```

### API 设计

#### GET /api/governance/users
- 并发调用 BookStack `GET /api/users`（最多 50 条）+ 查 `knowledge_user_roles`
- 合并：以 BookStack users 为主，role 取 knowledge_user_roles，无记录则返回 `'viewer'`
- 响应：`{ users: Array<{ id, name, email, role, avatar_url? }> }`

#### PUT /api/governance/users/:id/role
- Body：`{ role: 'admin' | 'editor' | 'viewer' }`
- UPSERT knowledge_user_roles（INSERT … ON DUPLICATE KEY UPDATE）
- 同步 BookStack：调用 `PUT /api/users/:id`，body `{ roles: [bookstackRoleId] }`
  - bookstackRoleId 映射：admin→1, editor→2, viewer→3
- 响应：`{ ok: true }`

#### GET /api/governance/shelf-visibility
- 并发调用 BookStack `GET /api/shelves` + 查 `knowledge_shelf_visibility`
- 合并：以 shelves 为主，visibility 取本地 DB，无记录则返回 `'public'`
- 响应：`{ shelves: Array<{ id, name, visibility }> }`

#### PUT /api/governance/shelf-visibility/:id
- Body：`{ visibility: 'public' | 'team' | 'private' }`
- UPSERT knowledge_shelf_visibility
- 响应：`{ ok: true }`

### 角色→BookStack Role ID 映射
```ts
const ROLE_MAP: Record<string, number> = {
  admin: 1,
  editor: 2,
  viewer: 3,
}
```

---

## 前端：Governance 页面更新

### bsApi 变更
前端不再直接调用 `bsApi.getUsers()` / `bsApi.updateUserRoles()` 做角色管理。
改为调用 governance API（同样通过 Vite proxy `/api/governance` → `localhost:3001`）：

```ts
// apps/web/src/api/governance.ts（NEW）
const govClient = axios.create({ baseURL: '/api/governance' })

export const govApi = {
  getUsers: () => govClient.get('/users').then(r => r.data),
  updateUserRole: (id: number, role: string) =>
    govClient.put(`/users/${id}/role`, { role }).then(r => r.data),
  getShelfVisibility: () => govClient.get('/shelf-visibility').then(r => r.data),
  updateShelfVisibility: (id: number, visibility: string) =>
    govClient.put(`/shelf-visibility/${id}`, { visibility }).then(r => r.data),
}
```

### Vite proxy 新增
```ts
'/api/governance': { target: 'http://localhost:3001', changeOrigin: true }
```
（注：/api/qa 已代理，/api/governance 是新增路径）

### MembersTab 重构
- 去除 localStorage，改为调用 `govApi.getUsers()`
- 角色改为三档下拉：admin / editor / viewer（中文标签）
- 「保存」按钮 → 调用 `govApi.updateUserRole(id, role)`，成功提示
- 去除「同步至 BookStack」按钮（服务端 PUT role 时已自动同步）

### 新 Tab：空间权限
- subtab id: `'spaces'`，label: `'空间权限'`
- 调用 `govApi.getShelfVisibility()` 列出所有 Shelf
- 每行：Shelf 名称 + 可见性下拉（公开/团队/私密）+ 「保存」按钮
- 保存调用 `govApi.updateShelfVisibility(id, visibility)`

---

## 测试策略

### 后端（qa-service）
- Mock mysql2 pool，测试 governance routes
- 测试：GET /users 合并逻辑（DB 有记录用 DB role，无记录用 viewer）
- 测试：PUT /users/:id/role UPSERT + BookStack 同步调用
- 测试：GET /shelf-visibility 合并逻辑
- 测试：PUT /shelf-visibility/:id UPSERT

### 前端（Governance）
- Mock govApi，测试 MembersTab 渲染 + 角色更新
- 测试：空间权限 Tab 渲染 + 可见性更新
