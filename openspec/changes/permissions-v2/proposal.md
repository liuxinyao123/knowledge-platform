# Proposal: permissions-v2 (团队 + 三层 ACL + Notebook 共享 + 审计 + Spaces/Assets 抽屉)

## 背景

ADR `2026-04-22-16-permissions-v2.md` 已经定下 V2 的选型（方案 C + G + 严格种子）并且核心代码已落地（两个 tsc 通过）。但到 Lock 为止仍然没有把已发生的行为冻结为契约，也留下两批 Followup 没有合入：

1. **行为契约缺失**：V2 在 `evaluateAcl` / `metadata_acl_rule` / `team` / `notebook_member` / `routes/{acl,teams,notebooks}.ts` / 前端 `Iam/*` + `Notebooks/*` 都改了，但没有 `specs/*-spec.md` 锁定行为。未来任何一次 refactor / DB 迁移 / UI 调整都可能悄悄改语义。
2. **严格种子语义分歧**：ADR 原文 "取消 V1 的 `* READ` 兜底"，代码 `ensureDefaultAclRules` 注释却说"旧库兼容不覆写老 `* READ`"。不写进契约，升级时会有人按 ADR 直读冲掉生产老库。
3. **F-2 Spaces/Assets 入口缺失**：当前必须去 `/iam?tab=rules` 加规则才能授权，源列表页 / 资产详情页没有快捷入口。
4. **F-3 审计缺失**：谁在何时改了哪条规则无迹可查。V2 已解锁的"临时 deny 一周"场景尤其需要事后追溯。

## 范围

### IN

**A. V2 行为契约冻结**（把已落地的 V2 代码写成 spec；不改代码，仅背书）
- `acl-v2-spec.md`：三类主体（role/user/team）、effect（allow/deny）+ deny 最高优、expires_at TTL、asset 继承 source 的 ACL、旧 `role` 字段回退语义
- `notebook-sharing-spec.md`：`notebook_member` 直授 + team 授；accessibility = owner ∪ 直授 ∪ 团队授；`GET /api/notebooks` 返回 `{items, shared}`；`members` CRUD
- R-1 双轨种子规则：新装机严格（只 admin 全权）；升级兼容（不覆写已存在的 `subject_id='*'` READ 行）

**B. F-3 ACL 审计**（新增能力）
- 新表 `acl_rule_audit(id, rule_id, actor_user_id, actor_email, op, before_json, after_json, at)`
- `routes/acl.ts` 的 CREATE / UPDATE / DELETE 三个写入分支（POST / PUT / DELETE）在**保留现有 `writeAudit` 调用**的基础上，**另写一条** `acl_rule_audit`；两套并行（见 design.md §2.2）
- 新端点 `GET /api/iam/acl/audit`（ADMIN 门）支持 `rule_id / actor / 时间窗` 过滤
- 前端 IAM 新增 Tab「审计」（也可以按需扩 AuditPanel 弹窗）

**C. F-2 Spaces/Assets 权限抽屉**（新增入口，不改后端）
- `SpaceTree` 列表行 + `Assets/Detail.tsx` 顶栏加「权限」按钮
- 点开弹 `PermissionsDrawer`：列出当前资源（source_id 或 asset_id）相关的 ACL 规则；支持"新增规则"快捷操作（内部调 `POST /api/acl/rules` 并预填 `source_id` / `asset_id`）
- 复用 RulesTab 已有的「主体选择器 + effect + expires_at」组件，避免 UX 分叉

### OUT（明确推到 V2.x / backlog）

- F-6 自定义角色（custom role）—— 后端 + 前端大改，分独立 change
- F-7 团队嵌套团队 —— 模型改动太大
- F-8 `evaluateAcl` 缓存（user_id → effective set）—— 等量级再做；现在加会掩盖语义错误
- VR-1 `/api/mcp/*` + `/api/graph/cypher` 加 `permission:manage` 门 —— 单路由打补丁，走工作流 C 单独立项
- VR-2 `governance/*` 迁 `requiredPermission` —— 同上

## 决策记录

- **D-001** R-1 双轨种子：`ensureDefaultAclRules` **新装 DB**（无 `metadata_acl_rule` 全空时）只下发 `admin` 的 READ/WRITE/ADMIN；**升级 DB**（已存在 `subject_id='*'` 且 `permission='READ'` 的行）保留不覆写，并在启动日志 WARN 一次提示 admin 去 `/iam` 手动收紧。
- **D-002** F-3 审计走新表 `acl_rule_audit`（**不**复用 `audit_log`）：字段天然带 `before/after` 结构化列，不用 JSON cast；与业务 audit 职责分离。
- **D-003** F-2 抽屉不引入新后端，复用 `POST /api/acl/rules`；抽屉只是 `source_id` / `asset_id` 的预填入口。
- **D-004** F-1 冒烟验证不在 Lock 阶段单独跑，而是写进 Execute 的 `tasks.md` 末尾作为**验证闸门**（走完 Execute 才算该 change 交付）。

## 验证

- `tsc --noEmit` 双 0（含新增 audit / drawer 代码）
- `pnpm -r test` 全绿；新增单测覆盖 audit 写入、抽屉预填、R-1 双轨种子两条路径
- 本机四步（从 ADR §验证）全部通过，**外加**：
  - `/iam?tab=audit` 看到规则变更流水
  - Spaces / Assets 页点「权限」抽屉，新增一条规则，去 `/iam?tab=rules` 能看见
  - 模拟老库升级（手工插入 `subject_type='role', subject_id='*', permission='READ'` 一行再重启）—— admin 日志 WARN，旧行保留
