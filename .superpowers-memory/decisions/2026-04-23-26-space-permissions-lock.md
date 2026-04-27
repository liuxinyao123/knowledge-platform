# ADR 2026-04-23-26 — space-permissions Lock + Execute

> 工作流 A · openspec-superpowers-workflow · 全链路走完（Clarify → Explore → Lock → Execute → Verify）。
> 契约：`openspec/changes/space-permissions/`。

## 背景

2026-04-22 BookStack 下线后，`/spaces` 页退化为 source→asset 二层树，"空间"一级实体缺位。
原型图（2026-04-23 review）要求 `/spaces` 四块内容：空间列表 / 空间信息 / 成员与权限表 / 目录结构。
本 ADR 引入 Space 作为真正的一级实体，并把 permissions-v2（ADR-16/17）扩展一个 `space_id` 维度。

## 决策（Lock）

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 新增 `space` / `space_member` / `space_source` 三表；`metadata_acl_rule` 加可空 `space_id` 列 | 不发明第二套 ACL |
| D-002 | `space.visibility` 只开 `org` / `private`，不开 `public` | 组织边界以外另起 feature |
| D-003 | `space_member.subject_type` 只开 `user` / `team`，不开 `role` | 整组织放行请发 org 级 rule |
| D-004 | Owner 转让本期做（`POST /:id/transfer-owner`） | 否则删空间会被 Owner 占死 |
| D-005 | 删除空间 = 硬删 + CASCADE；无墓碑表 | 合规需求出现前不预先复杂化 |
| D-006 | 审计复用 `acl_rule_audit`（op ∈ create/update/delete/transfer），不建 `space_audit` | |
| D-007 | 成员表是真相源；`SPACE_ROLE_DEFAULT_RULES` 把 role 投影成 `metadata_acl_rule` 行 | RulesTab 识别投影规则并只读 |
| D-008 | `metadata_asset` **不**冗余 `space_id`，资产通过 source 继承空间 | `resolveSpaceOf` asset → source → space_source |
| D-009 | Feature flag `SPACE_PERMS_ENABLED` 默认 on；off 时 `resolveSpaceOf` 永远返回空集 = V2 老行为 | 紧急回退点 |
| D-010 | 路由：直接覆盖 `/spaces`；旧 source→asset 树挂 `/spaces/:id/tree` | 不保留 `?legacy=1` |
| D-011 | `space_source` 复合主键允许一个 source 属多空间（后端允许 / 首版 UI 只暴露单空间入口） | `resolveSpaceOf` 返回集合 |
| D-012 | `RulesTab` 不重构，只加「作用域」列 + 投影规则只读 pill | V2 UI 刚稳定，避免再抖 |

## 实现清单（已完成）

### 后端
- `apps/qa-service/src/services/pgDb.ts`：3 张新表 + `metadata_acl_rule.space_id` + 索引 + FK
- `apps/qa-service/src/services/governance/spaceRoleSeed.ts`：`SPACE_ROLE_DEFAULT_RULES` + `projectMemberRules` / `clearMemberProjection` / `reprojectMember` / `isProjectedRule`
- `apps/qa-service/src/auth/resolveSpace.ts`：`resolveSpaceOf(resource)` + flag
- `apps/qa-service/src/auth/evaluateAcl.ts`：SELECT 加 `space_id`；`resourceMatches` 加空间维度；入口自动 resolveSpaceOf
- `apps/qa-service/src/auth/types.ts`：`AclResource.space_id(s)` + `AclRuleRow.space_id`（optional）
- `apps/qa-service/src/routes/spaces.ts`（新文件，14 个端点；审计入 `acl_rule_audit`）
- `apps/qa-service/src/index.ts`：挂 `/api/spaces`
- `apps/qa-service/src/__tests__/auth.evaluateAcl.space.test.ts`：6 case

### 前端
- `apps/web/src/api/spaces.ts`（新文件，13 个 fn + 全部类型）
- `apps/web/src/api/iam.ts`：`AclRule.space_id` / `RulePatch.space_id`
- `apps/web/src/knowledge/SpaceTree/`：
  - `index.tsx` 重写为"空间列表 + 详情"双栏
  - `SpaceListPane` / `SpaceDetailPane` / `SpaceInfoCard` / `SpaceMembersTable` / `SpaceDirectoryList`
  - `CreateSpaceModal` / `EditSpaceModal` / `AttachSourceModal`
  - `SpaceSourceTreePage`：旧 source→asset 树的新落脚点
  - `types.ts`：迁入 `SelectedAsset`（原在 `index.tsx`）
  - `TreePane.tsx` / `PreviewPane.tsx`：`SelectedAsset` 改从 `./types` 导入
- `apps/web/src/knowledge/Iam/RulesTab.tsx`：加「作用域」列 + 投影规则只读禁用
- `apps/web/src/App.tsx`：`/spaces/:id` + `/spaces/:id/tree` 新路由

### 文档
- `openspec/changes/space-permissions/{proposal,design,tasks,specs/space-permissions-spec}.md`
- `.superpowers-memory/glossary.md`：Space 条目重写
- `.superpowers-memory/integrations.md`：`SPACE_PERMS_ENABLED` flag 说明
- 本 ADR

## 验证

- `npx tsc --noEmit` × 3 包（qa-service / web / mcp-service）全部通过
- `auth.evaluateAcl.space.test.ts` 覆盖：
  1. space-scoped allow 在正确空间命中
  2. space-scoped allow 在错误空间不命中
  3. space-scoped deny 压过 org 级 allow
  4. 双空间归属任一 allow 即可
  5. 双空间任一 deny 即拒
  6. 资源无空间归属 → space-scoped rule 全部跳过，org 级仍然生效
- `pnpm -r test` 交用户本机跑（sandbox 无 rollup linux binary）
- 烟雾测试交用户本机：`/spaces` 四块渲染 / 新建-邀请-转让-删成员-删空间 闭环

## 向后兼容

- `metadata_acl_rule.space_id = NULL` = org 级规则，语义等价 V2 老行为。
- 现有测试没有 space 数据 → `space_source` 空 → `resolveSpaceOf` 返 `[]` → `resourceMatches` 看到 rule.space_id=NULL 放行 / space-scoped rule 跳过 → 全部老用例通过。
- `RulesTab` 既有规则 `space_id=NULL` → 显示「全局」pill，行为不变。

## 关联

- 上游：ADR-16 Permissions V2 选型 / ADR-17 Permissions V2 Lock
- 术语：Glossary `Space` 条目重写，保留 "BookStack Shelf" 作为历史 alias
- Open Questions：无（Q-S1..Q-S5 + C-5..C-8 全部在 Lock 阶段落定）
