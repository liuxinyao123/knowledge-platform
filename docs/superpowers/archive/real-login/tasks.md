# Tasks: real-login (G9)

## 后端
- [x] BE-1: `services/pgDb.ts` —— users 表 DDL + seed admin（`ensureDefaultAdmin`）
- [x] BE-2: `services/passwordHash.ts` —— scrypt hash + verify（Node 内置 crypto）
- [x] BE-3: `auth/signToken.ts` —— HS256 sign（与 verifyToken 对称，零外部 JWT 库）
- [x] BE-4: `routes/auth.ts` —— POST /login
- [x] BE-5: `routes/auth.ts` —— POST /logout（stateless + audit）
- [x] BE-6: `routes/auth.ts` —— POST /register (ADMIN)
- [x] BE-7: `routes/auth.ts` —— POST /password (self)
- [x] BE-8: `routes/acl.ts` —— /users 读真表 fallback seed

## 前端
- [x] FE-1: `auth/tokenStorage.ts` —— localStorage 封装
- [x] FE-2: `api/client.ts` —— axios 全局拦截器（request Bearer + 401 redirect）
- [x] FE-3: `api/auth.ts` —— login / logout / register / changePassword
- [x] FE-4: `auth/AuthContext.tsx` —— login / logout actions + token 存取
- [x] FE-5: `auth/RequireAuth.tsx` —— 路由保护组件
- [x] FE-6: `knowledge/Login/index.tsx` —— 登录页（默认填 admin email）
- [x] FE-7: `App.tsx` —— /login 公开路由 + 其它路由 RequireAuth 包
- [x] FE-8: `components/Layout.tsx` —— UserArea 显 email / roles / 登出按钮
- [x] FE-9: `main.tsx` —— 挂全局 axios 拦截器

## 单测
- [x] TE-1: `passwordHash.test.ts` —— round-trip / 错密 / 不同 salt / 非法 stored / 空密
- [x] TE-2: `signToken.test.ts` —— sign→verify 圆 / 过期拒绝 / 不同 secret 拒绝
- [ ] TE-3: `auth.login.test.ts` —— 暂不在本 change；需要 mock PG 比较重，留 followup

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-14-real-login.md`

## 验证
- [x] VR-1: `tsc --noEmit` 双 0
- [ ] VR-2: `pnpm --filter qa-service test` 含新 2 个测试（本机跑）
- [ ] VR-3: 不设 AUTH_HS256_SECRET → 仍 DEV BYPASS（.env 里把它注释掉再启动）
- [ ] VR-4: 设 AUTH_HS256_SECRET → /login 登录 admin@dsclaw.local/admin123
- [ ] VR-5: 创 editor 身份（POST /api/auth/register ADMIN 调用） → 登录 → /iam 返 403
- [ ] VR-6: 让 token 过期（或 localStorage 手动清）→ 自动跳 /login
- [x] VR-7: 归档 —— docs/superpowers/archive/real-login/

## Followups
- FU-1: TE-3 login 路由测试（需要 supertest + mock pg pool）
- FU-2: httpOnly cookie 替代 localStorage（提升 XSS 防御）
- FU-3: refresh token（过期即强制重登 UX 一般）
- FU-4: 账号锁定 / 失败次数限制
- FU-5: 密码重置流程（邮件发送）
- FU-6: IAM 面板 UsersTab 加"新建用户"按钮（调 POST /register）
