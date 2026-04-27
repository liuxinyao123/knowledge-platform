# Design: user-admin

## 后端 `routes/auth.ts`

### PATCH /users/:id （ADMIN）

```ts
Body: { email?: string; roles?: string[] }

- 不允许改自己 roles（防自降权锁死）
- email 冲突 → 409
- 找不到 → 404
- 成功 → { ok: true } + audit 'user_updated'
```

### DELETE /users/:id （ADMIN）

```ts
- id === req.principal.user_id → 400 'cannot delete self'
- 找不到 → 404
- 成功 → { ok: true } + audit 'user_deleted'
```

### POST /users/:id/reset-password （ADMIN）

```ts
Body: { newPassword: string }
- newPassword < 8 → 400
- 找不到 → 404
- 成功 → { ok: true } + audit 'user_password_reset_by_admin'
```

## 前端 `knowledge/Iam/UsersTab.tsx` 重写

布局：
```
[+ 新建用户]                                       (顶栏)
┌ user_id │ email │ 角色 │ 权限数 │ 来源 │ 操作 ┐
│ 1       │ admin │ ... │ 8      │ db  │ 改角色 重置密码 [删除禁用=self] │
```

新建 Modal：email / password（≥8）/ roles 多选 checkbox
改角色 Modal：roles 多选
重置密码 Modal：newPassword 输入
删除：confirm 原生

## 前端 UserArea 加"修改密码"

点 UserArea 内一个小齿轮图标（或把 email 区变成可点击）→ 弹 ChangePasswordModal：oldPassword / newPassword → 调 `POST /api/auth/password`

## api/iam.ts 新增

```ts
export const userAdmin = {
  create(email, password, roles): Promise<{id}>
    → POST /api/auth/register
  update(id, patch: {email?, roles?}): Promise<void>
    → PATCH /api/auth/users/:id
  remove(id): Promise<void>
    → DELETE /api/auth/users/:id
  resetPassword(id, newPassword): Promise<void>
    → POST /api/auth/users/:id/reset-password
  changeOwnPassword(old, new_): Promise<void>
    → POST /api/auth/password
}
```

## 约束

- UsersTab 只对真 DB 行（source === 'seed' 且 user_id 是数字）可操作；session 行不可编辑
- 删除 / 改角色后刷新用户列表
