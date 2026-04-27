# Tasks: user-admin (G10 / FU-6)

## 后端
- [x] BE-1: PATCH /api/auth/users/:id（ADMIN，禁改自己 roles）
- [x] BE-2: DELETE /api/auth/users/:id（ADMIN，禁删自己）
- [x] BE-3: POST /api/auth/users/:id/reset-password（ADMIN）

## 前端
- [x] FE-1: api/iam.ts 加 userAdmin（create/update/remove/resetPassword/changeOwnPassword）
- [x] FE-2: UsersTab 重写 —— + 新建用户 / 改角色 / 重置密码 / 删除，session/seed/db 来源区分
- [x] FE-3: ChangePasswordModal 新文件
- [x] FE-4: Layout UserArea 加"改密"按钮（DEV 下禁用）

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-15-user-admin.md`

## 验证
- [x] VR-1: TS 双 0
- [ ] VR-2: 本机 admin 登录 → 新建 bob → 改角色 editor → 重置密码 → 删 bob
- [ ] VR-3: 自己点 UserArea 改密 → 登出 → 用新密登
- [ ] VR-4: 试 DELETE 自己 → 400 'cannot delete self'
- [x] VR-5: 归档
