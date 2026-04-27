# ADR 2026-04-21-10 · unified-auth 扩展 permissions 模型（PRD §2）

## Context

PRD §2 把权限模型定义为 `permissions` 字符串集（`knowledge:ops:manage` 等）。
现有 unified-auth 仅 `roles: string[]`，ACL 规则按 role 过滤——无法表达 PRD 的细粒度权限。

## Decision

1. Principal 增 `permissions: string[]` 字段；与 roles 并存
2. Token 解析 PRD §2.5：permissions claim 优先，否则从 roles 展开（ROLE_TO_PERMS 内置）
3. `enforceAcl` 新选项 `requiredPermission`（直接要求 permission，绕过 ACL 规则）
4. ACL 规则新列 `permission_required`（可选）；匹配时额外要求 principal 有该 permission
5. 新 `/api/auth/me` 端点；前端 AuthProvider/useAuth/<RequirePermission> 实现 PRD §17.4
6. DEV BYPASS 注入 ADMIN_PERMS 全集
7. ROLE_TO_PERMS 暂内置常量；G4 IAM 升级为 DB 可编辑

## Consequences

**正面**
- PRD §2 的权限模型真实落地
- 前端权限驱动 UI 实现（§17.4）
- 旧 role-based ACL 规则 0 迁移成本

**负面 / 取舍**
- 双轨期（role + permissions）可能让 ACL 规则评估心智负担略增
- DEV BYPASS 给全集 → 本地可能误判；生产 fail-fast 兜底
- 内置 ROLE_TO_PERMS 与未来 IAM DB 配置未合并

## Links

- openspec/changes/unified-auth-permissions/
- PRD §2.3 角色→权限映射表
- PRD §2.5 permissions 优先策略
- PRD §17.4 data-requires 权限驱动 UI
