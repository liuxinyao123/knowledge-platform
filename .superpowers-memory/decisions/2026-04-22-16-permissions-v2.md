# ADR 2026-04-22-16 · Permissions V2（团队 + 三层 ACL + Notebook 共享）

## Context

V1 ACL 只有 `role × permission × (source/asset)` 三元组，且默认 seed 给 `* READ`。
真实使用中暴露三个问题：

1. **缺主体维度** —— 想给"某个用户"或"市场组那 5 个人"单独授权，只能新建一个角色，膨胀很快
2. **缺 deny / 缺 TTL** —— 想做"某 viewer 临时禁止读 source#7 一周"做不到
3. **Notebook 不可共享** —— 当前只有 owner 能看，违反 NotebookLM 心智

并且 V1 的 `* READ` 默认 seed 与"deny-by-default"愿景冲突 —— 任何资源默认所有人都能读。

## Decision

采纳方案 **C + G + 严格种子**：

- **主体维度**：`subject_type ∈ {role, user, team}` + `subject_id`（含通配 `*`）
  - `role` 字段保留 NULLABLE 仅做向下兼容；新规则一律走 `subject_*`
- **效果**：`effect ∈ {allow, deny}`，**deny 优先**；同一个 (主体, 资源, 操作) 上 deny 命中即拒
- **过期**：`expires_at TIMESTAMPTZ NULL` —— 命中规则前先 `notExpired()` 过滤
- **资源**：`source_id` / `asset_id`；asset 隐式继承所属 source 的 ACL（`OR (source_id=$src AND asset_id IS NULL)`）
- **团队**：新建 `team` + `team_member`；`requireAuth` 注入 `principal.team_ids/team_names`
- **Notebook 共享**：新建 `notebook_member (notebook_id, subject_type, subject_id, role)`；
  accessibility = owner ∪ user 直授 ∪ 用户所属团队授；`GET /api/notebooks` 返回 `{ items, shared }`
- **种子模式 B**（严格 · 双轨 · R-1 澄清 2026-04-22）：
  - **新装 DB**（`metadata_acl_rule` 行数 = 0）：`ensureDefaultAclRules` 只下发 `admin` 的 READ/WRITE/ADMIN；不下发 `* READ`
  - **升级 DB**（已有老的 `subject_id='*' AND permission='READ'` 行）：保留老行不覆写（升级不炸业务），并在启动日志 WARN 一次提醒 admin 去 `/iam?tab=rules` 手动收紧
  - 实现见 `apps/qa-service/src/services/pgDb.ts::ensureDefaultAclRules`（模块级 `_warnedLegacyStarRead` 保证只 WARN 一次）
  - 原 ADR 表述"取消 V1 的 `* READ` 兜底"改写为上面两条，以避免 operator 按字面意思主动删除升级库里的老行
  - 回滚开关保持不变：`INSERT INTO metadata_acl_rule (subject_type, subject_id, permission, effect) VALUES ('role', '*', 'READ', 'allow');`
- **新角色不在 V1 引入** —— 自定义角色推迟到 V2.x

## Consequences

**正面**

- 一条规则可表达 "team#3 的 editor 角色对 source#7 的所有 asset READ，过期 7 天后失效"
- deny 优先 + TTL 让"临时回收权限"成为一行 SQL 的事
- Notebook 共享解锁多人协作场景，与 NotebookLM 心智对齐
- 严格种子让"deny-by-default"真正生效（V1 名义有但被 `* READ` 抵消）

**负面 / 取舍**

- **重启后老库默认行为变了** —— viewer/editor 不再自动有读权；用户需要在 `/iam?tab=rules` 手动加 allow 规则。回滚开关：往 `ensureDefaultAclRules` 加一条 `subject_type=role, subject_id=*, permission=READ`
- **migration 风险** —— 旧 `metadata_acl_rule` 行用 backfill：`role NOT NULL → subject_type='role', subject_id=role`；`role NULL → subject_id='*'`。已在 pgDb migration 验证幂等
- **团队层级未支持** —— team 是扁平结构，团队嵌套团队推到 V2.x
- **Spaces / Assets 页面未挂"权限"抽屉** —— 当前授权统一去 /iam 加规则；列入 V1.5 followup
- **审计日志缺失** —— 谁在何时改了哪条规则没记；列入 V1.5 followup
- **subject_id 字段 polymorphism** —— `team` 存数字字符串、`user` 存邮箱、`role` 存角色名；查询/索引时要靠 `subject_type` 分流。已在 evaluateAcl `subjectMatches()` 集中处理

## 技术落地

### 后端
```
apps/qa-service/src/services/pgDb.ts        + V2 schema (team / team_member / notebook_member) + ALTER metadata_acl_rule
                                            + ensureDefaultAclRules 改严格种子
apps/qa-service/src/auth/types.ts           + Principal.team_ids/team_names; AclRuleRow.subject_*/effect/expires_at
apps/qa-service/src/auth/requireAuth.ts     + loadUserTeams 注入 principal
apps/qa-service/src/auth/evaluateAcl.ts     + subjectMatches + notExpired + deny 最高优
apps/qa-service/src/routes/teams.ts         新 (CRUD + members)；挂 /api/iam/teams
apps/qa-service/src/routes/acl.ts           + rules CRUD 接收/校验 V2 字段
apps/qa-service/src/routes/notebooks.ts     + loadAccessibleNotebook + members 端点 + GET / 返回 {items, shared}
apps/qa-service/src/index.ts                + mount teamsRouter
```

### 前端
```
apps/web/vite.config.ts                                + /api/iam 代理
apps/web/src/api/teams.ts                              新
apps/web/src/api/notebooks.ts                          + NotebookMember + listMembers/addMember/removeMember + access?
apps/web/src/api/iam.ts                                + AclRule.subject_type/subject_id/effect/expires_at + ListRulesParams
apps/web/src/knowledge/Iam/index.tsx                   4 Tab：用户 / 团队 / 权限规则 / 角色矩阵；默认 users
apps/web/src/knowledge/Iam/TeamsTab.tsx                新 (列表 / 创建 / 展开看成员 / 加移除成员)
apps/web/src/knowledge/Iam/RulesTab.tsx                + 主体类型选择器 + team 下拉 + effect + expires_at + SubjectBadge
apps/web/src/knowledge/Notebooks/index.tsx             分「我的 / 共享给我的」两区段；access 徽标
apps/web/src/knowledge/Notebooks/Detail.tsx            + 共享按钮 + ShareModal
apps/web/src/knowledge/Notebooks/ShareModal.tsx        新 (列成员 + 添加 user/team 成员 + 角色)
```

### 验证
- `apps/web` `tsc --noEmit` ✅ EXIT=0
- `apps/qa-service` `tsc --noEmit` ✅ EXIT=0
- 用户本机 follow-up（待跑）：
  1. `pnpm dev:down && pnpm dev:up` 让 V2 migration 跑一次
  2. `/iam?tab=teams` 新建团队 → 加成员
  3. `/iam?tab=rules` 新规则主体选 team
  4. `/notebooks` Detail → 共享 → 邀请 team → 切团队成员账号验证「共享给我的」

## Followups（V1.5 / V2.x）

| 项 | 优先级 | 备注 |
|---|---|---|
| Spaces / Assets 页直接挂"权限"抽屉 | 中 | 现在必须去 /iam 加规则 |
| 自定义角色 (custom role) | 中 | V2.x；V1 只 admin/editor/viewer/user 四个 |
| 团队嵌套团队 | 低 | 当前扁平 |
| 审计日志（acl_rule_audit 表） | 中 | 谁在何时改了哪条规则 |
| evaluateAcl 缓存（user_id → effective set） | 低 | 性能优化，等量级再做 |

## Links

- PROGRESS-SNAPSHOT-2026-04-22.md §八（详细文件清单 + 验证步骤）
- 上游：ADR 2026-04-21-10 unified-auth-permissions（V1 基线）
- 上游：ADR 2026-04-21-12 permissions-admin-ui（V1 IAM UI）
- 关联：ADR 2026-04-21-15 user-admin（用户 CRUD，团队成员邮箱来自这里）
