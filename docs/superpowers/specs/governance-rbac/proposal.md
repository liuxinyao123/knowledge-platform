# Proposal: 用户权限体系（独立 RBAC，Phase 1）

## Problem

当前 Governance 成员管理使用 localStorage 存储角色，没有服务端持久化，刷新即失，无法跨用户共享。`knowledge_user_roles` 表尚未创建。空间可见性 Tab 不存在。

## Scope（本 Phase）

1. **数据库**：在 BookStack 同一 MySQL 创建 `knowledge_user_roles` 和 `knowledge_shelf_visibility` 两张表
2. **qa-service**：新增 MySQL 连接 + `/api/governance/*` 路由，替代 localStorage
3. **Governance 成员 Tab**：从真实 API 读取用户+角色，角色更新持久化 + 同步 BookStack
4. **空间权限 Tab**：列出所有 Shelf，显示/编辑可见性（存本地 DB，不接入 BookStack 权限 API）

## Out of Scope（后续 Phase）

- Login Hook（PHP functions.php，等 OIDC 联调后实现）
- 空间可见性接入 BookStack entity permissions API
- 权限过滤验证测试（需要真实多用户 Token）

## 决策记录

- 数据库：BookStack MySQL 容器（同实例，mysql2 驱动）
- 服务：扩展 qa-service，添加 governance 路由
- 空间可见性：独立 `knowledge_shelf_visibility` 表，UI-only
