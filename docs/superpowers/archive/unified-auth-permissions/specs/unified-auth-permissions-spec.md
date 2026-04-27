# Spec: unified-auth permissions 升级

## permissions 模块

**Scenario: ROLE_TO_PERMS 内置 PRD §2.3 表**
- Given import { ROLE_TO_PERMS } from auth/permissions
- Then ROLE_TO_PERMS.viewer 等于 USER_PERMS（7 条）
- And ROLE_TO_PERMS.admin 包含 'iam:manage' 'permission:manage' 等管理权限

**Scenario: expandRolesToPermissions 去重合并**
- Given roles = ['viewer', 'editor']
- Then 返回值是一个数组，包含 viewer + editor 各自权限并去重

**Scenario: hasPermission 简单判断**
- Given principal.permissions = ['knowledge:qa']
- Then hasPermission(p, 'knowledge:qa') === true
- And hasPermission(p, 'iam:manage') === false

---

## requireAuth 升级

**Scenario: token 携带 permissions claim → 优先**
- Given JWT payload `{sub:5, email:'a@b', permissions:['custom:foo']}`
- And knowledge_user_roles 中 user_id=5 role='admin'
- When 请求进入
- Then req.principal.permissions === ['custom:foo']
- And req.principal.roles === ['admin']（仍从 DB 读，供旧 ACL 使用）

**Scenario: token 仅有 roles → 展开**
- Given JWT payload `{sub:5, email:'a@b', roles:['editor']}`
- And DB 无该用户 → dbRoles=['viewer'] 默认
- Then req.principal.permissions = expand([viewer, editor])

**Scenario: DEV BYPASS 注入全集**
- Given AUTH_* 全空 + 非生产
- Then req.principal.permissions === ADMIN_PERMS

---

## enforceAcl({ requiredPermission })

**Scenario: 通过**
- Given principal.permissions 含 'knowledge:ops:manage'
- When middleware enforceAcl({ requiredPermission: 'knowledge:ops:manage' })
- Then next() 调用；req.aclDecision = { allow: true }

**Scenario: 拒绝**
- Given principal.permissions 不含 'iam:manage'
- When enforceAcl({ requiredPermission: 'iam:manage' })
- Then 403 reason='missing permission iam:manage'

**Scenario: DEV BYPASS 放行**
- Given AUTH 未配 + 非生产
- Then enforceAcl 任意 requiredPermission 都放行

**Scenario: 同时设 action + requiredPermission**
- Given 两者都设
- Then 两者都通过才放行；任一拒绝即 403

---

## /api/auth/me

**Scenario: 已登录返 principal**
- Given DEV BYPASS
- When GET /api/auth/me
- Then 200, body `{user_id:0, email:'dev@local', roles:['admin'], permissions:[...全集...], dev_bypass:true}`

**Scenario: 未登录（生产模式）**
- Given AUTH 配置且无 token
- Then 401

---

## ACL rule.permission_required 列

**Scenario: rule 设了 permission_required 时强制要求**
- Given metadata_acl_rule 有一行 `{role:'editor', permission:'READ', permission_required:'audit:view'}`
- And principal roles=['editor'], permissions 含 'audit:view'
- Then evaluateAcl 命中此 rule 视为 allow

**Scenario: principal 缺该 permission 即不命中**
- Given 同上 rule
- And principal permissions 不含 'audit:view'
- Then 该 rule 不被算入 matched

**Scenario: rule 不设 permission_required 行为不变**
- Given 旧 rule permission_required IS NULL
- Then 行为同当前（仅按 role 匹配）

---

## 前端 useAuth + RequirePermission

**Scenario: 初始加载隐藏 children**
- Given AuthProvider mount
- And /api/auth/me 还未返
- Then `<RequirePermission name='x'>` 不渲染 children

**Scenario: 有权限渲染**
- Given useAuth 拉到 permissions 含 'iam:manage'
- Then `<RequirePermission name='iam:manage'>` 渲染 children

**Scenario: 无权限 fallback**
- Given permissions 不含
- Then 渲染 fallback prop（默认 null）
