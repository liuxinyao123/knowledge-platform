# Design: real-login

## 后端

### 1. users 表 & 迁移

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(128) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
```

启动 seed（`runPgMigrations` 末尾）：
```
IF NOT EXISTS (SELECT 1 FROM users) THEN
  INSERT admin@dsclaw.local / admin123 / roles=['admin']
  console.warn('DEFAULT ADMIN CREATED — CHANGE PASSWORD ON PRODUCTION')
END IF
```

### 2. passwordHash.ts（Node crypto.scrypt）

格式 `scrypt$<salt-hex>$<hash-hex>`：
- `hashPassword(pw)` → salt(16B rand) + scrypt(pw, salt, 64B) → format
- `verifyPassword(pw, stored)` → re-derive → `timingSafeEqual`

### 3. signToken.ts

```ts
export function signHS256(payload, secret, ttlSec = 86400): string {
  const iat = Math.floor(Date.now() / 1000)
  const p = { ...payload, iat, exp: iat + ttlSec }
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const body = b64url(p)
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest()
  return `${header}.${body}.${b64url(sig)}`
}
```

### 4. routes/auth.ts 新增

- `POST /login`
  - 输入：`{ email, password }`
  - 查 users → 验 password → 签 token `{sub:id, email, roles}`
  - 返 `{ token, user: {user_id, email, roles, permissions} }`
  - 无 AUTH_HS256_SECRET 时 500（必须配）

- `POST /logout`
  - stateless，server 返 `{ok:true}`；客户端自己丢 token

- `POST /register`（enforceAcl ADMIN）
  - `{ email, password, roles[] }`
  - 写 users 表，返 `{id}`

- `POST /password`（requireAuth）
  - `{ oldPassword, newPassword }`
  - 查当前用户 → 验旧密 → 写新 hash

### 5. requireAuth.ts 行为

现有：
- 有 token → verify → 注 principal
- 无 token + `AUTH_HS256_SECRET` 未设 + 非 prod → DEV BYPASS 注 admin

改动：极小 —— 只需确保 `AUTH_HS256_SECRET` 设了之后 `isAuthConfigured()` 返 true，DEV BYPASS 自动关。现有 `authMode()` 已实现。

### 6. /api/acl/users 行为

```ts
const { rows } = pool.query('SELECT id,email,roles FROM users ORDER BY id')
if (rows.length === 0) return fallbackSeedUsers()
return rows.map(r => ({
  user_id: r.id.toString(),
  email: r.email,
  roles: r.roles,
  permissions: expandRolesToPermissions(r.roles),
  dev_bypass: false,
  source: 'db',
}))
```

## 前端

### 1. tokenStorage.ts

```ts
const KEY = 'dsclaw.auth.token'
export const tokenStorage = {
  get: () => localStorage.getItem(KEY),
  set: (t: string) => localStorage.setItem(KEY, t),
  clear: () => localStorage.removeItem(KEY),
}
```

### 2. api/client.ts

axios instance + interceptors：
- request: 加 `Authorization: Bearer ${token}` 如果有
- response: 401 → clear token → `window.location.href = '/login'`（或 React Router navigate，但拦截器拿不到 hook，location.href 简单粗暴）

**重要**：所有现有 `api/*.ts` 的 `axios.create({baseURL})` 都改用这个 client 作 basis，或换成单例 + 附加 baseURL。方案：保留现有代码结构，在顶层 `main.tsx` 装 axios 全局拦截器（`axios.interceptors.request.use` 直接挂 axios 模块）。

### 3. AuthContext 扩展

```ts
interface AuthState {
  user, loading, error, hasPermission, reload,
  login(email, password): Promise<void>
  logout(): void
}
```

`login()` → `authApi.login()` → 存 token → reload() → 跳首页
`logout()` → clear token → setUser(null) → 跳 /login

首次 mount 时如果 localStorage 有 token → reload() 验之；无 token → 不跳转（如果当前不在 /login）

### 4. RequireAuth.tsx

```tsx
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}
```

### 5. App.tsx 改造

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
    <Route index element={<Navigate to="/overview" replace />} />
    ...existing...
  </Route>
</Routes>
```

### 6. Layout 用户区

```tsx
<div>
  <div>{user?.email ?? '—'}</div>
  <button onClick={logout}>登出</button>
</div>
```

## 行为矩阵

| AUTH_HS256_SECRET | 有 token? | 结果 |
|---|---|---|
| 未设 | — | DEV BYPASS 注入 admin（开发兜底） |
| 已设 | 无 | /login 登录 |
| 已设 | 有效 | 正常路由 |
| 已设 | 过期/伪造 | 401 → 清 token → /login |

## 风险

- localStorage 存 token → XSS 可盗。缓解：CSP、不在非受信域渲染用户输入。ADR 记录后续迁 httpOnly cookie。
- DEV BYPASS 若误部署（未设 AUTH_HS256_SECRET 的 prod）会直接 admin 放行。缓解：生产 fail-fast —— `index.ts` 启动时 `NODE_ENV=prod && !isAuthConfigured()` 已 process.exit(1)。
