# Explore Draft — RBAC 用户权限体系（Phase 1）

> 草稿。正式契约见 `openspec/changes/rbac-access-control/`。

## 读的代码

- 现有 Governance 成员管理用 localStorage 存角色，刷新即失
- BookStack `/api/users` 已能拉用户列表
- 没有 `knowledge_user_roles` / `knowledge_shelf_visibility` 表

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|---|---|---|---|
| A localStorage 不变 | 0 | 不持久不可控 | ✗ |
| B BookStack 自带 roles 单一权限源 | 中 | BookStack roles 过于粗 | ⚠️ |
| C 新建 qa-service MySQL 表 + 同步 BookStack（本 change 采用） | 中 | 需保持双向同步 | ✓ |

**选 C**：在 BookStack 同库新建 `knowledge_user_roles` + `knowledge_shelf_visibility`，
qa-service 用 mysql2 直连；写角色时 PUT BookStack `/api/users/:id` 同步内置 role。

## 风险

- BookStack OIDC 没启用前，权限源只在 qa-service（D-001 暂走 HS256）
- 空间可见性是 UI-only，没接 BookStack entity permissions（下一阶段补）
- 本 change 不实现 Login Hook（PHP functions.php，等 OIDC 联调）
