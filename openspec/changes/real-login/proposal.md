# Proposal: real-login (G9)

## 背景

G2 做了 permissions 模型 + 前端 hook + DEV BYPASS。G3/G4 做了 IAM UI。
但实际登录 UI / 用户表 / 密码哈希 / 401 跳转 —— 全部缺失。
这意味着 `RequirePermission` 的隐藏分支、`enforceAcl` 的 403 分支从未真正被触发过。

Q4=b 决策现在覆盖：由用户显式要求走完整登录路线 B。

## 动机

- 生产上线前必须有真用户隔离；DEV BYPASS 是开发兜底，不是产品
- IAM 面板的 seed 用户要真起来才能做 RBAC 端到端测试
- 前端 401 目前无任何处理 —— token 过期用户看到的是神秘的请求失败

## 范围

### IN（后端）

- 新表 `users (id, email UNIQUE, password_hash, roles JSONB, created_at, updated_at)`
- 启动时 seed 默认 admin：`admin@dsclaw.local` / 初始密码 `admin123`（控制台打印 + 要求生产改）
- `services/passwordHash.ts` —— 用 Node 内置 `crypto.scrypt`（不引 bcrypt）
- `auth/signToken.ts` —— HS256 sign（与现有 verifyToken 对称）
- `routes/auth.ts` 新增：
  - `POST /api/auth/login` —— email+password → { token, user }
  - `POST /api/auth/logout` —— 客户端丢 token（stateless，server 端只回 200）
  - `POST /api/auth/register` —— ADMIN 专用，创建新用户
  - `POST /api/auth/password` —— self 改密
- `routes/acl.ts` —— `GET /users` 从真 users 表读；表空时 fallback seed
- `requireAuth.ts` —— DEV BYPASS 继续存在，但**仅在 `AUTH_HS256_SECRET` 未设**时激活（产品上线必设该 env）

### IN（前端）

- `/login` 页面（email + password + 错误提示）
- `api/client.ts` —— axios 实例，请求自动加 `Authorization: Bearer`；响应 401 → 清 token + 跳 `/login`
- `auth/tokenStorage.ts` —— localStorage 封装（key 常量 + 读写清）
- `AuthContext` —— token 状态 + login() / logout() actions
- `auth/RequireAuth.tsx` —— 路由保护组件，未登录跳 `/login`
- `App.tsx` —— 公开 `/login`；其它路由用 `RequireAuth` 包
- `Layout.tsx` —— 底部用户区显示真 email + 登出按钮

### OUT

- 自注册（register 仅 ADMIN 可用）
- OAuth / SSO（留 JWKS 的旧通道作接入点）
- 双因素 / 记住我 / 会话续签
- 密码强度强校验（仅最小长度 ≥ 8）
- 账号锁定 / 失败次数限制

## 决策点

| Q | 选择 | 备注 |
|---|---|---|
| token 存储 | localStorage | XSS 自担；后续可迁 httpOnly cookie |
| 自注册 | 关 | 内部知识中台，ADMIN 管用户 |
| DEV BYPASS 保留 | 是，但 AUTH_HS256_SECRET 一旦设即关闭 | 零配置开发仍可用 |
| 哈希 | Node `crypto.scrypt` | 避免 bcryptjs 引入 |
| JWT 签发 | Node `crypto.createHmac` | 与 verifyToken.ts 对称 |
| Token TTL | 24h | 无 refresh token |

## 验证

- `tsc --noEmit` 双 0
- 单测：password round-trip / signToken+verifyToken / login 路由
- 手动：
  - 不设 `AUTH_HS256_SECRET` → DEV 仍走 BYPASS
  - 设 `AUTH_HS256_SECRET=xxx` + 重启 → `/login` 登录 admin → 进入 `/overview`
  - 登录 editor 身份 → `/iam` 返 403 提示 / 侧边栏管理组不显示
  - 401 → 自动跳 `/login`
