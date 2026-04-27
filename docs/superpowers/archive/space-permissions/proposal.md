# Proposal — Space Permissions（空间 + 成员权限）

> 工作流 A · openspec-superpowers-workflow · 阶段 1 Clarify
> 产物不进主分支；Lock 后迁入 `openspec/changes/space-permissions/`

## 0. 背景

- 原型图（2026-04-23 review）展示 `/spaces` 页要有四块内容：空间列表 / 空间信息 / 成员与权限表 / 目录结构。
- 现状 `apps/web/src/knowledge/SpaceTree/index.tsx` 只有 `TreePane + PreviewPane`（source→asset 树 + 资产详情），没有：
  - "空间"这一聚合实体
  - 空间级成员（Owner / Admin / Editor / Viewer）
  - 空间信息卡（Owner、可见范围、文档数）
  - 目录结构分组视图
- Glossary `Space = BookStack Shelf` 的旧定义在 2026-04-22 BookStack 下线后已失真（见 SpaceTree/index.tsx 顶部注释）；本 feature 同步给 Space 换一个贴合现状的定义。

## 1. 目标

- 把"空间"重新确立为一级实体：**一组 `metadata_source` 的集合 + 一组成员 + 该集合内的权限策略**。
- 成员权限模型复用 permissions-v2（`subject_type` + `subject_id` + `effect` + `permission`），新增 `space_id` 作用域维度；不自己再发明一套 ACL。
- "目录结构"作为 source 列表的分组视图（按 tag / 用户分组字段），**不新增目录表**。
- 前后端一起实现；前端页面达到原型图 UI 完备度，后端暴露最小 API 支撑 UI。

## 2. Out of Scope

- 不改 `metadata_acl_rule` 的 V2 语义，只新增 `space_id` 可空列。
- 不做多层嵌套空间、不做跨空间联邦、不做空间归档 / 回收站。
- 不做空间级别的审批队列（Q-003 已推后，照旧）。
- 不触碰 BookStack 残留代码 / `knowledge_shelf_visibility` 旧表（标记为 legacy）。
- `RulesTab` 的 UI 短期不跟随改版，只在后端允许 `space_id` 维度；UI 改版单独排。

## 3. 成功标准

1. 数据库新增 `space` / `space_member` / `space_source` 三张表（迁移脚本走 `db.ts` 既有 IF NOT EXISTS 模式）。
2. `metadata_acl_rule` 新增可空列 `space_id`，迁移向后兼容；老规则 `space_id=NULL` 视为 "org 级"。
3. 新增 API：
   - `GET /api/spaces` / `GET /api/spaces/:id` / `POST /api/spaces` / `PATCH /api/spaces/:id`
   - `GET /api/spaces/:id/members` / `POST /api/spaces/:id/members` / `PATCH /api/spaces/:id/members/:uid` / `DELETE /api/spaces/:id/members/:uid`
   - `GET /api/spaces/:id/sources`（按空间列数据源 + 分组视图）
   - 所有写接口写 `acl_rule_audit` 或新增 `space_audit`（Lock 阶段决定）
4. 前端 `/spaces` 页按原型四块落地，mock 数据被真实 API 取代；旧 `TreePane` 降级到空间详情抽屉或单独入口。
5. `pnpm -r tsc --noEmit` 通过；关键 service 新增 unit test（policy 评估含 `space_id` 维度）。
6. 归档：`docs/superpowers/archive/space-permissions/`。

## 4. 待 Clarify 阶段确认的点（已有答复，待 Lock 复核）

| 编号 | 问题 | 用户答复 | 状态 |
|------|------|----------|------|
| C-1 | 范围：纯 UI / 还是前后端全做 | 前后端全做 | ✅ 已答 |
| C-2 | 目录结构：新表 vs source 分组视图 | source 分组视图，不新增目录表 | ✅ 已答 |
| C-3 | 权限粒度：硬编码四角色 vs 可配置 policy | 可配置 policy（沿用 permissions-v2） | ✅ 已答 |
| C-4 | 工作流选择 | A openspec-superpowers-workflow | ✅ 已答 |
| C-5 | 默认角色模板：Owner/Admin/Editor/Viewer 的默认 policy 集合由谁维护 | 待 Explore 决定 —— 提案：沿用 `ROLE_TO_PERMS` 风格，存 seed 文件 | ⏳ Explore |
| C-6 | 兼容旧 `/spaces` 路由：新页是 `/spaces/v2` 还是直接覆盖 `/spaces` | 待 Explore | ⏳ Explore |
| C-7 | `space_id` 是否也加在 `metadata_asset` 上（还是只在 source 上）| 待 Explore | ⏳ Explore |
| C-8 | Owner 转让是否本期做 | 待 Explore | ⏳ Explore |

## 5. 依赖

- ADR 2026-04-22-16-permissions-v2 / 2026-04-23-17-permissions-v2-lock：subject/effect/TTL/deny 规则不变
- `notebook` + `notebook_member` 表（pgDb.ts L252/L346）：成员模型直接参考
- `team` + `team_member`（pgDb.ts L301/L312）：subject_type=team 已可用，空间成员可以是 team
- `acl_rule_audit`（pgDb.ts L360）：ACL 变更已有审计，空间表写入走同一审计链或新增 `space_audit`

## 6. 风险

- Glossary 里 `Space = BookStack Shelf` 的旧定义，一定要在 ADR 里显式改写，避免下次会话误引用。
- `metadata_acl_rule` 加列不能阻塞现有 Rules UI；Lock 时要确认 `RulesTab` 不崩。
- 旧 `/spaces` 页当前是生产链路（`KnowledgeTabs` 入口），覆盖时必须保留"数据源 → 资产"访问路径，不然会把 ingest-UI 以外唯一的 asset 预览入口打掉。
- pgvector 检索侧不感知 `space_id` → 如果要做"按空间隔离检索"，要另起 feature，本期不做。
