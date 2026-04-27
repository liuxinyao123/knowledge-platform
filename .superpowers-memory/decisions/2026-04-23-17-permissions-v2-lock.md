# ADR 2026-04-23-17 · Permissions V2 Lock（OpenSpec 契约冻结 + 本轮 scope 决定）

## Context

`2026-04-22-16-permissions-v2.md` 把 V2 核心选型（三主体 / deny 最高优 / TTL / Notebook 共享 / 严格种子）定死并落了代码（两个 tsc 通过）。
在走完工作流 B 的 Explore 阶段后（`docs/superpowers/archive/permissions-v2/design.md`），我们发现：

1. **V2 已落地但无 OpenSpec 契约**，未来任何 refactor 都可能悄悄改语义。
2. **ADR 的 "取消 `* READ` 兜底" 与代码里 `ensureDefaultAclRules` 的"保留老行"描述不一致** —— 不是 bug，是两种都合理的读法没在一处说清楚。
3. ADR Followups + PROGRESS-SNAPSHOT §七 攒了一批 P1 待办（F-2 Spaces/Assets 抽屉 · F-3 审计日志 · F-4 /api/mcp 门 · F-5 governance 迁 requiredPermission · F-6/F-7/F-8 推到 V2.x）。

Lock 阶段必须一次性把"已发生的事实"冻结成 spec，并决定下一轮 Execute 能纳入哪些 Followup。

## Decision

本轮 change `openspec/changes/permissions-v2/` 的 4 条锁定决策：

### D-001 · R-1 双轨种子

`ensureDefaultAclRules` 按 DB 状态分两条路径：

- **新装 DB**（`metadata_acl_rule` 行数 = 0）：只下发 `admin` 的 READ/WRITE/ADMIN；**不**下发 `* READ`
- **升级 DB**（已有 `subject_id='*' AND permission='READ'` 的老行）：
  - 老行保留不覆写（升级不炸业务）
  - 启动日志通过模块级 `_warnedLegacyStarRead` flag **WARN 一次**（不刷屏），提醒 admin 去 `/iam?tab=rules` 手动收紧

原 ADR 的"取消 `* READ` 兜底"一句改写为上面两条，避免 operator 按字面意思在升级库里主动删老行。回滚开关保持不变。

### D-002 · F-3 审计走新表 `acl_rule_audit`

不复用 `audit_log`。理由：
- `acl_rule_audit` 的 `before_json` / `after_json` 是结构化 JSONB 列，IAM 审计视图直接可查；`audit_log.detail` 的 JSON cast 麻烦
- `audit_log` 的 `writeAudit(...)` 调用**保留不动**，与新表并行运行 —— `audit_log` 是跨业务操作流，`acl_rule_audit` 是 ACL 专表
- audit 写入失败 `try/catch + console.error`，不阻塞业务 2xx 返回

### D-003 · F-2 抽屉不引入新后端

Spaces/Assets 行内「🔒 权限…」按钮打开 `PermissionsDrawer`（`apps/web/src/knowledge/_shared/PermissionsDrawer.tsx`），完全走既有 `GET/POST/DELETE /api/acl/rules`，预填 `source_id` / `asset_id` 且 disabled。抽屉作用域仅限当前资源，不展示全局规则 —— 全局操作仍去 `/iam?tab=rules`。

### D-004 · F-1 冒烟验证放到 Execute 最后环节

不单独为 F-1 开一轮；作为 `tasks.md` 的 D 闸门（D-4 / D-5 / D-6）承担"V2 真装起来能跑"的收尾责任。双 DB 路径（新装 + 升级）都在验证 checklist 里。

## Consequences

**正面**
- V2 行为变为可回归的 BDD spec（4 份：acl-v2 / notebook-sharing / acl-audit / permissions-drawer），未来 refactor 有坐标
- 临时 deny 一周、审计追溯、从资源页快速授权三件事 UX 闭环
- Pre-existing drift（R-1 语义、PUT vs PATCH、notebook_member.role enum、POST upsert、DELETE 路径参数）都在 Lock 阶段对齐到代码事实

**负面 / 取舍**
- **两套 audit 路径并行**：`writeAudit → audit_log` 和新 `acl_rule_audit`。短期冗余；V2.x 可考虑统一
- **RulesTab 与 PermissionsDrawer 各有一份"新增规则"表单**：本轮 Drawer 是 self-contained 实现，C-FE-1/2/3（抽 `<RuleForm>` + `useRuleMutations`）推到下一轮独立 refactor change
- **`<div role="button">` 替换 `<button>`** in `SpaceTree/TreePane.tsx` 为了支持嵌套按钮。可访问性仍保留（`tabIndex` + Enter/Space keydown），但比原生 `<button>` 弱一点
- **Web tsc 有 5 处 pre-existing 错误**（RunDetail / ChatPanel，React 19 升级遗留），不在本 change scope，独立 `web-react19-typefix` 处理
- **`tagExtract.test.ts` 2 条 pre-existing fail**，本 change 未碰，独立 `tagextract-testfix` 处理

## 交付状态

**sandbox 内完成**
- qa-service `tsc --noEmit` EXIT=0
- 本 change 新增 6 测试文件用户本机 `pnpm test` 全 PASS（207/209 绿；2 fail 全在无关的 tagExtract）
- 代码：后端 4 文件、前端 7 文件新增/修改；契约：本 ADR + `integrations.md`

**用户本机已完成**
- qa-service vitest 2026-04-22 跑绿（本 change 新增 0 fail）

**用户本机待跑**
- web vitest
- Migration 双轨验证（新装 DB / 升级 DB + 老 `* READ` 行注入）
- 浏览器 6 步冒烟（ADR 4 步 + F-3 审计页 + F-2 两个入口）
- 步骤详见 `docs/verification/permissions-v2-verify.md` §5

## Follow-ups（推到独立 change，不阻塞本轮归档）

| 任务 | 工作流 | 备注 |
|---|---|---|
| RulesTab / Drawer 表单收敛到 `<RuleForm>` + `useRuleMutations` | C (feature refactor) | C-FE-1/2/3 本轮未做 |
| `web-react19-typefix`（5 处 pre-existing TS 错误） | C | RunDetail.tsx / ChatPanel.tsx |
| `tagextract-testfix`（测试对齐服务新 MAX_TAG_LEN=24 + 测试数据长度） | C | ~3 行改动 |
| F-4 · `/api/mcp/*` + `/api/graph/cypher` 加 `permission:manage` 门 (VR-1) | C | 单路由补丁 |
| F-5 · `governance/*` 迁 requiredPermission (VR-2) | C | 同上 |
| F-6 / F-7 / F-8 · 自定义角色 / 团队嵌套 / evaluateAcl 缓存 | A 或 B | V2.x |

## Links

- 上游：ADR `2026-04-22-16-permissions-v2.md`（V2 选型）
- 上游：ADR `2026-04-21-10-unified-auth-permissions.md`（V1 基线）
- OpenSpec change：`openspec/changes/permissions-v2/`
- 实施计划：`docs/superpowers/plans/permissions-v2-impl-plan.md`
- 验证日志：`docs/verification/permissions-v2-verify.md`
- 归档 Explore 设计：`docs/superpowers/archive/permissions-v2/design.md`
