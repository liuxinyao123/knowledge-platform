# Proposal: unified-auth permissions 升级（PRD §2）

## Problem

PRD §2 把权限模型设计为 `permissions` 字符串集（`knowledge:ops:manage`、`assets:view` 等），并要求：
- §2.5 token 同时含 `permissions` 与 `roles` 时，**permissions 优先**
- §17.4 UI 元素可通过 `data-requires="<permission>"` 自动管控可见性

当前 unified-auth 仅有 `roles: string[]`（'admin'/'editor'/'viewer'），ACL 规则按 role 过滤。整套 PRD 的细粒度权限**无法表达**。前端也没有"当前用户是谁/有哪些权限"的接口。

## Scope（本 Change）

1. **Principal 扩展**：`permissions: string[]`（与 roles 并存，向后兼容）
2. **role→permissions 映射** `auth/permissions.ts`：内置 PRD §2.3 表
   - `admin` → 14 权限全集
   - `editor` → 写权限子集
   - `viewer` → 仅读
3. **Token 解析升级** `verifyToken.ts`：claims 含 `permissions` 优先采用，否则展开 `roles`
4. **ACL 规则可选 permission 过滤**：`metadata_acl_rule` 加 `permission_required` 列；evaluate 时若设置则要求 principal 有该 permission
5. **新路由 `/api/auth/me`**：返当前 principal（user_id/email/roles/permissions），前端用作权限驱动 UI 的数据源
6. **`enforceAcl({ requiredPermission })` 选项**：route 可直接要求某个 permission（不依赖 ACL 规则）
7. **前端 hooks/components**：
   - `useAuth()` —— 拉 `/api/auth/me`，全局缓存
   - `<RequirePermission name="...">` —— 包裹元素；无权限不渲染
   - `usePermission(name)` —— 返 boolean，逻辑判断用

## Out of Scope

- IAM 5 Tab UI（属 G4）：本 change 仅暴露 API，不做配置面板
- OIDC/DSClaw token 实际接入（仍 DEV BYPASS / HS256 双栈）
- 历史 ACL 规则迁移（保留 role 字段；新规则可选 permission_required）
- DB 化 role→permissions 映射（本 change 内置；G4 IAM 再做可编辑）

## 决策记录

- D-001 Principal 加 `permissions` 字段；与 roles 并存；evaluate 优先 permissions
- D-002 role→permissions 内置常量（不入库）；G4 IAM 时再升级为 DB 配置
- D-003 ACL 规则的 `permission_required` 列默认 NULL，旧规则不受影响
- D-004 `/api/auth/me` 不要求 ACL（任何登录用户都能查自己的身份）；DEV BYPASS 时返 admin 全集
- D-005 前端 `<RequirePermission>` 用同步 cache（onMount 拉一次 me）；无权限默认隐藏（PRD §17.4）
