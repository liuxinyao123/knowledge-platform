# Tasks — space-permissions

> Execute 阶段执行顺序；完成打勾即可进入 Verify。

## 后端

- [x] T-B1 pgDb.ts 新增 `space` / `space_member` / `space_source` 建表 + `metadata_acl_rule.space_id` ALTER + 索引
- [x] T-B2 `services/governance/spaceRoleSeed.ts` 导出 `SPACE_ROLE_DEFAULT_RULES` + `projectMemberRules(tx, spaceId, member)` + `clearMemberProjection(tx, spaceId, subject_type, subject_id)`
- [x] T-B3 `routes/spaces.ts` 实现 12 个端点；每个写接口写 `acl_rule_audit`
- [x] T-B4 `enforceAcl` 评估链新增 `resolveSpaceOf(resource)`；`SPACE_PERMS_ENABLED` flag 默认 on，off 时等价老逻辑
- [x] T-B5 `index.ts` 挂载 `spacesRouter` 到 `/api/spaces`
- [x] T-B6 `__tests__/acl.space.spec.ts` 新增 5 条单测（space-scoped allow / space-scoped deny / 双空间合并 / 空 space_source 等价老行为 / 投影规则与成员同步）

## 前端

- [x] T-F1 `api/spaces.ts` 新模块，导出 13 个 fn
- [x] T-F2 组件拆分：`SpaceListPane`, `SpaceDetailPane`, `SpaceInfoCard`, `SpaceMembersTable`, `SpaceDirectoryList`, `SpaceSourceTreePage`
- [x] T-F3 `SpaceTree/index.tsx` 重写，实现原型图 4 块
- [x] T-F4 `App.tsx` 路由新增 `/spaces/:id`、`/spaces/:id/tree`
- [x] T-F5 `Iam/RulesTab` 新增 scope 列（`space_id`→空间名）+ 投影规则只读 pill
- [x] T-F6 `api/iam.ts` `AclRule` 加 `space_id?: number | null`；类型补齐

## 文档 / 记忆

- [x] T-D1 `.superpowers-memory/glossary.md` 重写 Space 条目（保留 "BookStack Shelf" 作为 alias）
- [x] T-D2 `.superpowers-memory/decisions/2026-04-23-26-space-permissions-lock.md` 新 ADR
- [x] T-D3 `.superpowers-memory/MEMORY.md` 索引追加
- [x] T-D4 `integrations.md` 追加 `SPACE_PERMS_ENABLED` flag

## Verify

- [x] V-1 `pnpm -r tsc --noEmit` 通过
- [ ] V-2 `pnpm -r test` — 用户本机跑，累计 80 case 新增 5 case 无 regression
- [ ] V-3 手动烟雾：`/spaces` 四块渲染 OK；新建/邀请/转让/删成员/删空间闭环
- [ ] V-4 归档：`docs/superpowers/specs/space-permissions/` → `archive/`

## Known Limits

- V-2 依赖用户机器（sandbox 无 registry/rollup binary）；改动行为边界已由 V-1 + spec 合并兜住
- `enforceAcl` 里 `resolveSpaceOf` 读 `space_source` 不走 cache —— 若压测出瓶颈，下个 feature 加 LRU
