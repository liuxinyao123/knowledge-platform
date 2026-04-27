# Design: unified-auth permissions 升级

## 核心类型

```ts
// auth/types.ts 扩展
export interface Principal {
  user_id: number
  email: string
  roles: string[]
  permissions: string[]      // NEW
}
```

## PRD §2.3 内置映射

```ts
// auth/permissions.ts —— NEW
export const USER_PERMS = [
  'knowledge:overview', 'knowledge:search', 'knowledge:spaces',
  'knowledge:ingest', 'knowledge:qa', 'knowledge:ops:read',
  'assets:view',
]

export const ADMIN_PERMS = [
  ...USER_PERMS,
  'knowledge:ops:manage', 'permission:manage', 'rule:edit',
  'audit:view', 'explain:view', 'iam:manage',
]

export const EDITOR_PERMS = [
  ...USER_PERMS,
  'knowledge:ops:manage',        // editor 可治理（标签/重复/质量）但无权管理 ACL 规则
]

export const ROLE_TO_PERMS: Record<string, string[]> = {
  admin: ADMIN_PERMS,
  editor: EDITOR_PERMS,
  viewer: USER_PERMS,             // viewer 与 user 同义
  user: USER_PERMS,
}

export function expandRolesToPermissions(roles: string[]): string[] {
  const set = new Set<string>()
  for (const r of roles) (ROLE_TO_PERMS[r] ?? []).forEach((p) => set.add(p))
  return [...set]
}

export function hasPermission(principal: Principal, name: string): boolean {
  return principal.permissions.includes(name)
}
```

## Token 解析

```ts
// verifyToken.ts 扩展返
export interface TokenPayload {
  user_id: number
  email: string
  permissions?: string[]      // NEW
  roles?: string[]            // NEW
}
```

`requireAuth` 合并逻辑：

```ts
const payload = await verifyToken(token)
const dbRoles = await loadRolesFromDb(payload.user_id)   // 保留旧行为
const tokenPerms = payload.permissions ?? []
let finalPerms: string[]
if (tokenPerms.length > 0) {
  finalPerms = tokenPerms                                // PRD §2.5：permissions 优先
} else {
  finalPerms = expandRolesToPermissions([...dbRoles, ...(payload.roles ?? [])])
}
req.principal = { user_id, email, roles: dbRoles, permissions: finalPerms }
```

DEV BYPASS principal = `{roles:['admin'], permissions: ADMIN_PERMS}`。

## enforceAcl 新选项

```ts
export interface EnforceAclOptions {
  action?: AclAction                 // 变可选
  resourceExtractor?: (req) => AclResource | Promise<AclResource>
  requiredPermission?: string        // NEW：直接要求某 permission（跳过 ACL 规则）
}
```

当 `requiredPermission` 设置：
- DEV BYPASS 仍放行
- 否则检查 `principal.permissions.includes(name)`；无则 403
- 若也设 `action`，两者都要通过

## /api/auth/me

```ts
// routes/auth.ts —— NEW
authRouter.get('/me', requireAuth(), (req, res) => {
  if (!req.principal) return res.status(401).end()
  const { user_id, email, roles, permissions } = req.principal
  res.json({ user_id, email, roles, permissions, dev_bypass: !isAuthConfigured() })
})
```

## DB schema 增量

```sql
ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS permission_required VARCHAR(64);
```

`evaluateAcl` 在 rule 匹配时若 `permission_required` 非 NULL，要求 `principal.permissions.includes(permission_required)`。

## 前端

```
apps/web/src/
  ├── api/auth.ts                    —— NEW: whoami()
  ├── auth/
  │   ├── AuthContext.tsx            —— React context + useAuth hook
  │   └── RequirePermission.tsx      —— 权限条件渲染
  └── main.tsx                       —— 挂 AuthProvider
```

### useAuth()

```ts
export function useAuth(): {
  user: Principal | null
  loading: boolean
  hasPermission(name: string): boolean
  reload(): Promise<void>
}
```

### <RequirePermission>

```tsx
<RequirePermission name="knowledge:ops:manage">
  <button>新建规则</button>
</RequirePermission>

<RequirePermission name="iam:manage" fallback={<div>无权</div>}>
  <IamPage />
</RequirePermission>
```

## 向后兼容

- 旧 `evaluateAcl(role-only)` 路径继续工作：permission_required 为 NULL 时回退旧逻辑
- 前端未用 AuthProvider 的部分不受影响
- DEV BYPASS principal 现在也有 permissions（全集），确保所有现有端点不被新的 permission 检查误伤

## 测试策略

- `permissions.test.ts` —— expandRolesToPermissions / hasPermission / PRD §2.3 常量
- `requireAuth.permissions.test.ts` —— token 带 permissions claim 优先 / 不带时从 roles 展开 / DEV BYPASS 全集
- `enforceAcl.permissions.test.ts` —— requiredPermission 通过 / 拒绝 / DEV BYPASS 放行
- `auth.me.route.test.ts` —— /api/auth/me 返 principal

## 风险

- 现有 ACL 规则若没有 permission_required 全为 NULL，行为不变——OK
- 前端 useAuth 初始 loading 期间，RequirePermission 默认**不渲染**（比错误渲染安全）
- DEV BYPASS 返所有 permission 可能在本地误判"我有权"；生产会被 fail-fast 拦
