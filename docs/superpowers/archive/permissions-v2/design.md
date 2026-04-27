# Explore · Permissions V2

> 工作流：B — `superpowers-openspec-execution-workflow`
> 阶段：1. Superpowers Explore
> 生成时间：2026-04-22
> 输入：ADR `2026-04-22-16-permissions-v2.md`、V1 ADR 组、PROGRESS-SNAPSHOT §八、现网代码

## 1. TL;DR（Explore 的结论）

- **V2 核心已全量交付**：团队、三层主体（role/user/team）、deny 优先、TTL、Notebook 共享都在代码里（后端 evaluateAcl 的 `subjectMatches` / `notExpired` / denyMatched 分支、`routes/teams.ts`、`routes/notebooks.ts` 的 members + shared 段落、前端 TeamsTab/ShareModal/RulesTab 改版），双 tsc `--noEmit` EXIT=0 已在 ADR 里背书。
- **真正待做的不是 V2 的新一轮决策**，而是两类收尾：
  1. **冒烟验证**：`pnpm dev:up` 跑一次 V2 migration，在浏览器跑完 ADR §验证 的 4 条本机 follow-up，产出验证日志；
  2. **Followups 队列**：ADR 和 PROGRESS-SNAPSHOT §七都罗列了下一批要锁契约的增量。
- **当前没有 V2 范围内的未决问题**：`open-questions.md` 的"当前无未决问题"状态成立；Explore 不新增 Open Question。
- **唯一需要对齐的语义分歧**：ADR "取消 V1 的 `* READ` 兜底" vs. 代码 `ensureDefaultAclRules` 注释"保留老全局 READ 行不删"。不是 bug，是 ADR 和代码对"严格种子"的两种读法：ADR 说的是**新装机不再下发**，代码说的是**旧库不覆写以免升级炸业务**。需要显式记入决策，见 §5 R-1。

## 2. 上游依赖（启动条件检查 ✅）

工作流 B 规定"上游缺失不得开工"。三份上游 change 目录均存在，且 specs 已归档到 `docs/superpowers/archive/`，视为已合并：

| 上游 change | OpenSpec 目录 | 归档 | 备注 |
|---|---|---|---|
| unified-auth-permissions（V1 基线） | `openspec/changes/unified-auth-permissions/` | `docs/superpowers/archive/unified-auth-permissions/` | Principal.permissions、ROLE_TO_PERMS、enforceAcl、/api/auth/me、前端 RequirePermission |
| permissions-admin-ui（V1 IAM UI） | `openspec/changes/permissions-admin-ui/` | `docs/superpowers/archive/permissions-admin-ui/` | /iam 路由、Rules / Matrix / Users Tab、Simulate 接口 |
| user-admin（用户 CRUD） | `openspec/changes/user-admin/` | `docs/superpowers/archive/user-admin/` | users 表、admin 改角色 / 删用户 / 重置密码、ChangePasswordModal |

启动条件满足，可以进入 Lock 阶段。

## 3. V2 决策与交付对照（ADR ↔ 代码）

逐项核对 ADR "技术落地" 与现网代码，均存在且语义一致（除 §5 R-1 注记的"严格种子回退"）：

### 后端

| ADR 要求 | 文件 | 命中点 |
|---|---|---|
| V2 schema (team / team_member / notebook_member) + ALTER metadata_acl_rule | `apps/qa-service/src/services/pgDb.ts` | L301 `CREATE TABLE ... team`、L312 `team_member`、L321 idx、L346 `notebook_member`、L356 idx |
| `ensureDefaultAclRules` 改严格种子 | 同上 | L401 只下发 `admin` 的 READ/WRITE/ADMIN，过渡期兼容保留旧 `* READ`（见 §5 R-1） |
| `Principal.team_ids/team_names`；`AclRuleRow.subject_*/effect/expires_at` | `apps/qa-service/src/auth/types.ts` | 64 行类型定义齐全 |
| `loadUserTeams` 注入 principal | `apps/qa-service/src/auth/requireAuth.ts` | 存在 |
| `subjectMatches` + `notExpired` + deny 最高优 | `apps/qa-service/src/auth/evaluateAcl.ts` | L70 `subjectMatches`、L91 `notExpired`、L147/162/171 deny 分支 |
| `routes/teams.ts` CRUD + members；挂 `/api/iam/teams` | `apps/qa-service/src/routes/teams.ts` + `src/index.ts` | 151 行 router，已 mount |
| `routes/acl.ts` CRUD 接收 V2 字段 | `apps/qa-service/src/routes/acl.ts` | 312 行，处理 subject_type/subject_id/effect/expires_at |
| `routes/notebooks.ts` loadAccessibleNotebook + members + `GET / 返回 {items, shared}` | `apps/qa-service/src/routes/notebooks.ts` | 478 行，含 members 段 |

### 前端

| ADR 要求 | 文件 | 状态 |
|---|---|---|
| `/api/iam` 代理 | `apps/web/vite.config.ts` | 存在 |
| `api/teams.ts` 新建 | 对应文件 | 存在 |
| `api/notebooks.ts` 加 members / access | 对应文件 | 存在 |
| `api/iam.ts` 加 V2 字段 | 对应文件 | 存在 |
| 4 Tab：users / teams / rules / matrix | `src/knowledge/Iam/{index,UsersTab,TeamsTab,RulesTab,MatrixTab}.tsx` | 5 个文件齐 |
| `RulesTab` 加主体选择器 / effect / expires_at | `src/knowledge/Iam/RulesTab.tsx` | 存在 |
| Notebooks「我的 / 共享给我的」双区段 | `src/knowledge/Notebooks/index.tsx` | 存在 |
| Detail 加共享按钮 + `ShareModal` | `src/knowledge/Notebooks/{Detail,ShareModal}.tsx` | 存在（ShareModal 187 行） |

**结论**：ADR 描述的 V2 代码面已全部落地，无遗漏项；Lock 阶段只需把已发生的事实写成 OpenSpec 契约冻结。

## 4. 开放项（Followups triage）

合并 ADR §Followups 与 PROGRESS-SNAPSHOT §七，去重后按建议优先级排序：

| # | 题目 | 来源 | 优先级 | 与 V2 的关系 | 建议工作流 |
|---|---|---|---|---|---|
| F-1 | **冒烟验证 V2 本机四步（migration + /iam?tab=teams + rules 主体=team + /notebooks 共享）** | ADR §验证 + §八 follow-up | **P0 必做** | V2 出厂前置 | 用户本机手动 + 记 verification 日志 |
| F-2 | Spaces / Assets 页挂"权限"抽屉 | ADR Followups + §七 | P1 | UX 收口 | C `superpowers-feature`（只 UI 细节） |
| F-3 | 审计日志（`acl_rule_audit` 表：谁/何时/改了哪条） | ADR Followups + §七 | P1 | 合规 + 排障 | B（新表 + 路由 + UI 列表） |
| F-4 | `/api/mcp/*` + `/api/graph/cypher` 加 `permission:manage` 门 (VR-1) | §七 | P1 | 收紧 viewer | C（单路由打补丁） |
| F-5 | `governance/*` 从 `action+resource` 迁到 `requiredPermission` (VR-2) | §七 | P1 | 消 deny-by-default 死角 | C |
| F-6 | 自定义角色（custom role，放出 admin/editor/viewer/user 以外） | ADR Followups | P2（V2.x） | 后端+前端 | A `openspec-superpowers`（Explore 再谈） |
| F-7 | 团队嵌套团队 | ADR Followups + §七 | P2（V2.x） | 结构模型改 | A |
| F-8 | `evaluateAcl` 缓存（user_id → effective set） | ADR Followups | P3 | 性能优化 | C（等量级上来再做） |

**Explore 侧的明确建议**：F-1 必须先做（V2 还没被人手验过，直接开 F-2~F-5 有回归风险）。F-2 ~ F-5 可以排进下一轮 Lock；F-6 / F-7 留到 V2.x，现在只占位；F-8 留作性能 backlog。

## 5. 风险 / 取舍（Explore 需点名）

- **R-1 · "严格种子"语义分歧（P0，必须在 Lock 阶段落锤）**
  - ADR §Decision 说"种子模式 B（严格）：取消 V1 的 `* READ` 兜底"。
  - 代码 `ensureDefaultAclRules`（`pgDb.ts:395-425`）注释说"过渡期兼容：如果 DB 里已存在老的全局 READ 规则（role=NULL / '*'），保留不删"。
  - 两种读法都合理：前者是"新装机 deny-by-default"，后者是"旧库升级不炸业务"。Explore 建议：**在 Lock 阶段把它写成两条明确规则** ——「新装机：只下发 admin READ/WRITE/ADMIN」+「升级：不覆写旧的 `* READ`，仅向 admin 发警告建议去 IAM 手动收紧」。
  - 影响 F-1 的验证脚本：跑 migration 后要分别测"干净库"和"有老 seed 的库"两条路径。
- **R-2 · `subject_id` 字段 polymorphism**
  - 同列存三种取值（role 名 / user 邮箱 / team 数字字符串），靠 `subject_type` 分流（ADR 已点；`subjectMatches()` 已集中处理）。
  - Followup F-2（Spaces/Assets 抽屉）新增入口时，**必须走 `subjectMatches` 同一条路径**，不能另起 join，否则语义分叉。Lock 阶段写进 spec 作为约束。
- **R-3 · 审计日志缺失（F-3）**
  - 规则变更无留痕。V2 已解锁的"临时 deny 一周"场景尤其依赖事后追溯。建议与 F-3 绑定到 Lock 阶段的 scope。
- **R-4 · `/api/mcp/*` + `/api/graph/cypher` 当前对 viewer 开放（F-4 / VR-1）**
  - 严格种子上线后 viewer 默认无读权，但 `mcp` / `graph/cypher` 路由可能走的是 `requiredPermission` 绕过 ACL 规则的路径。验证时必须确认：viewer 在严格种子下访问 `/api/mcp/*` 是 403。否则 F-4 提级为 P0。
- **R-5 · `notebook_member` 的 role 字段与 ACL 的 role 不是同一个语义**
  - `notebook_member.role` 是 owner/editor/viewer **on the notebook**（类似协作角色），和 principal.roles（系统角色）共用了名字但含义不同。ShareModal/TeamsTab UI 文案要避免混淆，Lock 阶段 spec 显式写出 enum 与对应权限。
- **R-6 · 回滚开关**
  - ADR §Consequences 已写：如果严格种子误锁，往 `ensureDefaultAclRules` 加一条 `subject_type=role, subject_id=*, permission=READ`。F-1 验证脚本里要把这条回滚路径也走一遍。

## 6. 下一步（Explore → Lock 的交接）

1. **本阶段产物**：本文件 + 上表。**不写 OpenSpec，不改代码**。
2. **建议 Lock 阶段的 scope**（交给 OpenSpec Lock 阶段决策）：
   - 范围最小收敛：把 F-1 的验证步骤 + R-1 的两条语义规则冻结为 `openspec/changes/permissions-v2/specs/*-spec.md`；
   - 范围中等：同时把 F-3（审计日志）和 F-2（Spaces/Assets 权限抽屉）写进 proposal，作为下一轮 Execute 的主线；
   - 范围激进：把 F-2 ~ F-5 一起打包进一个 change（不建议，容易大而全）。
3. **不纳入本 change 的事项**：F-6 / F-7 / F-8 明确 "Out of Scope"，转 V2.x backlog。

## 7. 待用户确认点（Lock 之前）

以下问题需要用户点头后才能进入 Lock 阶段：

- [ ] F-1 冒烟验证谁跑（用户本机 or 放在 Execute 阶段最后环节）？
- [ ] R-1 严格种子语义按"新装机严格 / 旧库兼容"双轨这个读法是否正确？
- [ ] 下一轮 Lock 的 scope 选 §6 的哪一档（最小 / 中等 / 激进）？
- [ ] F-3 审计日志如果进本轮，是走新表 `acl_rule_audit` 还是复用 `audit_log`（后者已存在于 `pgDb.ts:134`）？

## 附录 A · 文件清单（核对索引）

- ADR：`.superpowers-memory/decisions/2026-04-22-16-permissions-v2.md`
- 上游 ADR：`.superpowers-memory/decisions/2026-04-21-{10,12,15}-*.md`
- 进度快照（§八）：`.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-22.md:186-246`
- 未决：`.superpowers-memory/open-questions.md`（当前空）
- 关键代码：
  - `apps/qa-service/src/auth/evaluateAcl.ts`（subjectMatches/notExpired/deny）
  - `apps/qa-service/src/auth/types.ts`（Principal/AclRuleRow V2 字段）
  - `apps/qa-service/src/services/pgDb.ts:301-356, 395-426`（schema + seed）
  - `apps/qa-service/src/routes/{teams,acl,notebooks}.ts`
  - `apps/web/src/knowledge/Iam/{TeamsTab,RulesTab}.tsx`
  - `apps/web/src/knowledge/Notebooks/{index,Detail,ShareModal}.tsx`
