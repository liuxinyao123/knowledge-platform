# OpenSpec Change — space-permissions

> Lock 阶段（工作流 A · Stage 3）：把 Explore 阶段结论迁入可冻结契约。
> Source specs: `docs/superpowers/specs/space-permissions/`（将在 Verify 后归档）。

## 背景

原型图（2026-04-23）给 `/spaces` 页定义了四块内容：空间列表、空间信息卡、成员与权限表、目录结构。
现状 `apps/web/src/knowledge/SpaceTree` 只剩 source→asset 二层树（2026-04-22 BookStack 下线后的瘦身版），
空间作为一级实体缺位；Glossary 里 `Space = BookStack Shelf` 的旧定义已失真。

## 目标

1. 引入 `space` 一级实体（= 一组 `metadata_source` + 一组成员 + 该集合内的 scoped ACL）。
2. 沿用 permissions-v2 的 policy 模型，`metadata_acl_rule` 加可空列 `space_id`，**不发明第二套 ACL**。
3. 成员表（Owner/Admin/Editor/Viewer）通过 `spaceRoleSeed.ts` 投影成 `metadata_acl_rule` 行；
   成员表是真相源，投影规则在 RulesTab 显示只读。
4. 前端原型四块全部落地，旧 TreePane 降级到 `/spaces/:id/tree` 抽屉/子路由。

## 锁定决策

| 键 | 值 | 备注 |
|----|----|------|
| `space.visibility` 枚举 | `org` / `private` | 不开 `public` |
| `space_member.subject_type` | `user` / `team` | 不开 `role`；想整组织放行请发 org 级 rule |
| Owner 转让 | 本期做 | 否则删空间会被 Owner 占死 |
| 删除空间 | 硬删 + 级联 ACL | 不建墓碑表；合规需求出现前不预先复杂化 |
| 审计 | 复用 `acl_rule_audit` | 不新建 `space_audit` 表 |
| `space_id` 出现位置 | 仅 `metadata_source` 侧（通过 `space_source` 外连）+ `metadata_acl_rule.space_id` | `metadata_asset` 不冗余，asset 通过 source 继承空间 |
| `metadata_asset.space_id` | 不加列 | |
| 路由 | 直接覆盖 `/spaces` | 旧 tree 挂 `/spaces/:id/tree` |
| 默认角色模板 | `spaceRoleSeed.SPACE_ROLE_DEFAULT_RULES` | 投影到 `metadata_acl_rule` |
| 多空间归属 | 后端允许，首版 UI 单空间 | `space_source` 复合主键已允许 |
| 评估向后兼容 | `space_id IS NULL` = org 级，与现状同义 | |

## 下游影响

- `/api/acl/rules` 列表新增 `space_id` 字段；`RulesTab` 新增 scope 列（Execute 阶段小改）。
- `enforceAcl` 评估流新增 `resolveSpaceOf(resource)` 一步，走 `space_source` 表。
- `KnowledgeTabs` 的 "空间" 入口仍指向 `/spaces`，内容换；无外部 URL 断链。
- Glossary `Space` 术语重写；不改 BookStack 历史 ADR，只在新 ADR 引用旧编号。

## 非目标（明确 Out of Scope）

- 嵌套空间；跨空间联邦；空间归档/回收站。
- pgvector 检索侧按 `space_id` 隔离（另起 feature）。
- 空间级审批队列（Q-003 照旧推后）。
- BookStack 残留表 `knowledge_shelf_visibility` 的迁移。
- `RulesTab` UI 大改（只加 scope 列，不重构）。
