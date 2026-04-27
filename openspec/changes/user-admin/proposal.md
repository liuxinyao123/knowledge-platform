# Proposal: user-admin (G10, FU-6 补)

## 背景

G9 把登录做齐了，但 IAM UsersTab 只能看；POST /register 只能 curl 调。管理员改角色、删用户、重置他人密码还没有 UI；自己改密码也没地方点。

## 范围

### IN

- 后端补 3 个端点（全挂 ADMIN 门）：
  - `PATCH /api/auth/users/:id` —— 改 email / roles
  - `DELETE /api/auth/users/:id` —— 删用户；禁自删
  - `POST /api/auth/users/:id/reset-password` —— 管理员强制设他人新密
- 前端 IAM UsersTab 改造：
  - 顶栏 "+ 新建用户" 按钮 → 弹 Modal（email / password / roles）
  - 每行加 "改角色" / "重置密码" / "删除" 三按钮；当前登录用户自己那行的"删除"禁用
- UserArea 加"修改密码"入口（自助改密 Modal，调已存在的 `POST /api/auth/password`）
- API 层 `api/iam.ts` 补 5 个方法

### OUT

- 邮箱变更强制二次验证 / 密码重置邮件 —— 都是长链路，本 change 先不做
- 软删（设 deleted_at） —— MVP 硬删

## 验证

- TS 双 0
- 本机：admin 登录 → 创个 editor → 改成 viewer → 删除 → 自己改密 → 登出再用新密登
