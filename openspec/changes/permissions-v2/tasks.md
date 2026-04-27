# Tasks: permissions-v2

> 顺序：A 冻结 → B 审计 → C 抽屉 → D 验证闸门。A 是背书型任务（代码已在，只补测试 + 文档），B/C 是新增能力。

## A · V2 行为冻结（背书现有代码）

- [ ] A-BE-1: `auth/evaluateAcl.ts` —— 补单元测试覆盖 acl-v2-spec 全部 Scenario（subjectMatches × 8 / notExpired × 4 / deny × 4 / asset 继承 × 2）
- [ ] A-BE-2: `services/pgDb.ts ensureDefaultAclRules` —— 补单元测试覆盖 R-1 四条 Scenario（新装空库 / 旧 * READ 保留 + WARN / 无老 * READ 不 WARN / 幂等）
- [ ] A-BE-3: `routes/notebooks.ts loadAccessibleNotebook` —— 补测试覆盖 notebook-sharing-spec 的 accessibility 四条
- [ ] A-BE-4: `routes/notebooks.ts GET /api/notebooks` —— 补测试覆盖分段返回三条 + 去重一条
- [ ] A-BE-5: `routes/notebooks.ts members CRUD` —— 补测试覆盖 6 条 + notebook_member.role 校验
- [ ] A-FE-1: `apps/web/src/knowledge/Notebooks/index.tsx` —— 快照测试「我的 / 共享给我的」两段布局；access 徽标
- [ ] A-FE-2: `ShareModal.tsx` —— 测试主体选择器含 user / team
- [ ] A-CT-1: 把 ADR `2026-04-22-16-permissions-v2.md` 的 "取消 V1 * READ 兜底" 段改写为双轨描述（或追加补丁段 "R-1 澄清"）
- [ ] A-CT-2: `.superpowers-memory/integrations.md` 追加 "Permissions V2 主体/效果/TTL/双轨种子" 段

## B · F-3 ACL 审计

- [ ] B-BE-1: `pgDb.ts` —— CREATE TABLE IF NOT EXISTS `acl_rule_audit` + 两个索引
- [ ] B-BE-2: `routes/acl.ts` —— CREATE 分支在现有 `writeAudit` 调用之后**加**一条 `acl_rule_audit` INSERT（op=CREATE, before=NULL, after=new）；不改动 writeAudit 调用
- [ ] B-BE-3: `routes/acl.ts` —— PUT 分支**读取老行**（DB SELECT 一次）后写 `acl_rule_audit`（before=old, after=new）
- [ ] B-BE-4: `routes/acl.ts` —— DELETE 分支**读取老行**后写 `acl_rule_audit`（before=old, after=NULL）
- [ ] B-BE-5: `routes/acl.ts` —— `acl_rule_audit` 写入失败只 `console.error`，业务继续成功返回（`writeAudit` 和 acl_rule_audit 任一失败都不回滚业务）
- [ ] B-BE-6: `routes/iamAcl.ts`（新文件或复用）—— `GET /api/iam/acl/audit`；`enforceAcl({requiredPermission:'iam:manage'})`；query 支持 rule_id / actor / since / until / limit（默认 50，上限 500）
- [ ] B-BE-7: `index.ts` —— 如为新文件则挂载路由
- [ ] B-TE-1: `acl.audit.route.test.ts` —— CREATE/UPDATE/DELETE 三路径 + 写入失败降级 + ADMIN 门
- [ ] B-FE-1: `apps/web/src/api/iam.ts` —— `listAclAudit(filters)`
- [ ] B-FE-2: `apps/web/src/knowledge/Iam/AuditTab.tsx` —— 新建
- [ ] B-FE-3: `apps/web/src/knowledge/Iam/index.tsx` —— Tabs 加「审计」为第 5 项
- [ ] B-FE-4: diff 列渲染器（公共函数）—— 只展示 before→after 有变化的字段

## C · F-2 Spaces/Assets 权限抽屉

- [ ] C-FE-1: `apps/web/src/knowledge/Iam/RulesTab.tsx` —— 把「主体选择器 + effect + expires_at + 主体字段展示」抽成组件 `<RuleForm>` + `<SubjectBadge>`（放 `apps/web/src/knowledge/Iam/_shared/`）
- [ ] C-FE-2: `apps/web/src/knowledge/Iam/_shared/useRuleMutations.ts` —— 把 RulesTab 的 create/update/delete 抽成 hook
- [ ] C-FE-3: `RulesTab.tsx` 改造为消费上面两者，不改行为
- [ ] C-FE-4: `apps/web/src/knowledge/_shared/PermissionsDrawer.tsx` —— 新建（props `{resourceKind, resourceId, open, onClose}`）；拉规则、展示、新增表单预填 source_id/asset_id 且 disabled
- [ ] C-FE-5: `apps/web/src/knowledge/SpaceTree/TreePane.tsx` —— kebab 菜单加「权限…」；用 `<RequirePermission name="iam:manage">` 包
- [ ] C-FE-6: `apps/web/src/knowledge/Assets/Detail.tsx` —— 顶栏按钮「权限…」；同上 RequirePermission
- [ ] C-TE-1: `PermissionsDrawer.test.tsx` —— 预填 source_id / 预填 asset_id / 列表刷新 / 删除刷新 / 全局规则不展示
- [ ] C-TE-2: `RulesTab.test.tsx` —— 回归：抽取后行为等价
- [ ] C-CT-1: 更新 `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-22.md` §八「已知 follow-up」把"Spaces/Assets 权限抽屉"状态标为已做

## D · 验证闸门（F-1 冒烟 + 回归）

- [ ] D-1: `tsc --noEmit` —— `apps/qa-service` EXIT=0
- [ ] D-2: `tsc --noEmit` —— `apps/web` EXIT=0
- [ ] D-3: `pnpm -r test` —— 全绿；新增 A/B/C 测试全部覆盖
- [ ] D-4: 本机跑 **新装 DB** 路径：`docker compose down -v && pnpm dev:up` → 确认启动日志只见 `admin READ/WRITE/ADMIN` seed；**不见** `* READ`
- [ ] D-5: 本机跑 **升级 DB** 路径：
  1. 先只用 V1 seed 起服务
  2. `psql -c "INSERT INTO metadata_acl_rule (role, subject_type, subject_id, permission, effect) VALUES (NULL, 'role', '*', 'READ', 'allow');"`
  3. 重启服务 → 启动日志出现 WARN；`psql -c "SELECT COUNT(*) FROM metadata_acl_rule WHERE subject_id='*' AND permission='READ';"` === 1
- [ ] D-6: 浏览器手验（按 ADR §验证 四步 + 本 change 新增两步）：
  1. `/iam?tab=teams` 新建团队「市场组」→ 加成员
  2. `/iam?tab=rules` 新规则主体=team 市场组，permission=READ，expires_at=7d 后
  3. `/notebooks` Detail → 共享 → 邀请市场组 → 切组员账号 → 「共享给我的」看到
  4. 回到 admin → `/iam?tab=audit` 看到前几步的 CREATE / DELETE 流水
  5. `/space-tree` 某个 source 行 kebab → 「权限…」→ 弹抽屉 → 加一条 allow READ → 去 `/iam?tab=rules` 对齐
  6. `/assets/<id>` 顶栏「权限…」→ 同 5
- [ ] D-7: **回滚演练**：手动删 admin READ 规则，验证 `/api/acl/rules` 仍返 200（DB 直操作）；然后 `INSERT subject_id='*' READ` 临时救援 → 验证 viewer 又能读 → 救援后再删除 `*` 恢复严格
- [ ] D-8: 写验证日志到 `docs/verification/permissions-v2-verify.md`：日期 + 6 条手验结果 + 任意截图路径

## E · 归档（走完 D 之后）

- [ ] E-1: 把 `docs/superpowers/specs/permissions-v2/` 整个移到 `docs/superpowers/archive/permissions-v2/`
- [ ] E-2: 更新看板任务状态为 Done；同步 PROGRESS-SNAPSHOT（新增一节）
- [ ] E-3: 写新 ADR `.superpowers-memory/decisions/YYYY-MM-DD-NN-permissions-v2-lock.md` 记录 D-001 ~ D-004 四条决定
