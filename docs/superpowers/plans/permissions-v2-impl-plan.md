# Impl Plan: permissions-v2

> 工作流：B · Execute 阶段产物
> 对应 change: `openspec/changes/permissions-v2/`
> 日期：2026-04-22

## 0. 环境说明与门槛降级

本次 Execute 在 Cowork sandbox 内进行，有两个能力缺口：

| 工具 | 状态 | 影响 | 应对 |
|---|---|---|---|
| `tsc --noEmit` | ✅ 可跑（Node v22 + typescript 自带） | 类型检查全程在 sandbox 内完成 | Execute 结束时两包都 EXIT=0 |
| `vitest` | ❌ 缺 `@rollup/rollup-linux-x64-gnu` 且 npm registry 403 | 新增单测无法在 sandbox 跑 | **交付给用户本机跑**（`cd apps/qa-service && pnpm test`） |
| `psql` / postgres | ❌ sandbox 无 | migration / 真实 DB 冒烟做不了 | **交付给用户本机跑**（tasks.md D-4 / D-5 / D-6） |

实施时代码一律写到业务模块本体；测试写到 `__tests__/` 目录，使用 `vitest` 语法（和现有测试一致）。

## 1. 实施顺序

按 `tasks.md` A → B → C → D → E 走。每段结束前检查：

1. `apps/qa-service && ./node_modules/.bin/tsc --noEmit` EXIT=0
2. `apps/web && ./node_modules/.bin/tsc -b --noEmit` EXIT=0（`-b` 因为 web 用 project references）
3. 新增测试文件出现在 `__tests__/` 且语法无明显错误（肉眼 review）

## 2. 关键实施决策

### D-E-001 · 测试 mock 策略

后端测试不能跑真 DB。用两种策略：
- **纯函数类**（`subjectMatches`、`notExpired`、`ensureDefaultAclRules` 的逻辑分支）→ 直接单测函数；`pg.Pool` 用 `vitest` 的 `vi.fn()` mock 成返回固定 rows
- **集成类**（`routes/acl.ts` 写入审计 → `acl_rule_audit`）→ 用 `supertest` 打路由，在 `beforeAll` 里用 `pg-mem` 启一个内存 PG（如果已存在），否则完全 mock `getPgPool()`

先看一下仓库里是否已有 mock 基础设施，没有就全部用 `vi.fn()` mock。

### D-E-002 · acl_rule_audit 写入原子性

决定：**不做事务**。理由：
- 主业务写入（INSERT/UPDATE/DELETE metadata_acl_rule）已经在 handler 里独立；
- `acl_rule_audit` 失败只是丢一条审计，业务不应回滚；
- spec acl-audit-spec 第三段"写入失败不影响业务"已经写明这个预期；
- 加事务会让 audit 异常阻塞业务，与决策相反。

实现：在每个分支的业务 INSERT/UPDATE/DELETE 成功之后、response 返回之前，`try { await pool.query('INSERT INTO acl_rule_audit ...') } catch (e) { console.error(...) }`。

### D-E-003 · routes/acl.ts PUT/DELETE 读老行

PUT/DELETE 需要 before，要在操作前先 SELECT 一次老行。实现为 `loadOldRule(ruleId)` helper，避免在三处重复 SELECT 模板。

### D-E-004 · F-2 抽屉的位置

`PermissionsDrawer.tsx` 放到 `apps/web/src/knowledge/_shared/`（新建 `_shared` 目录，按 repo 惯例 `_` 前缀表示共用）。

`RuleForm` / `SubjectBadge` / `useRuleMutations` 放到 `apps/web/src/knowledge/Iam/_shared/`（IAM 内共用，不跨模块；抽屉通过 `import` 跨过来）。

### D-E-005 · TreePane 的 kebab 菜单

TreePane 目前没有 kebab；调研后选方案：
- 方案 A：每行最右侧加一个 `⋯` 按钮，点开 popover 显示"权限…"
- 方案 B：直接把"权限…"作为新的行内按钮

采用 **方案 A**（popover），给后面其它行级操作留扩展点。用户态通过 `<RequirePermission name="iam:manage">` 包裹。

### D-E-006 · AuditTab 的 diff 渲染

`before_json / after_json` 都是 JSONB，可能包含 `subject_type / subject_id / permission / effect / expires_at / source_id / asset_id / role / condition` 共 9 个字段。渲染 diff 时：
- 遍历所有 before/after 的 key 集合
- 每个 key：before 和 after 值不同则显示 `key: before → after`（`NULL` 用字符串 'NULL' 表示，JSON 对象 JSON.stringify）
- 不同则跳过
- CREATE 时 before = NULL → 全部字段显示 `key: (new)`
- DELETE 时 after = NULL → 全部字段显示 `key: (deleted)`

抽成 `diffJson(before, after): string[]` 函数放到 `apps/web/src/knowledge/Iam/_shared/diffJson.ts` 方便单测。

### D-E-007 · 升级 DB 的 WARN 一次

`ensureDefaultAclRules` 加一个模块级 `let warnedLegacyStarRead = false`；只在首次检测到老 `subject_id='*'` AND `permission='READ'` 行时 `console.warn` 并置 true。多次调用幂等不重复 WARN。

### D-E-008 · 前端 `listAclAudit(filters)` 的返回

按 spec：`{ items: AuditRow[], total: number }`。前端定义 `AuditRow`：

```ts
type AuditRow = {
  id: number
  rule_id: number | null
  actor_user_id: number | null
  actor_email: string | null
  op: 'CREATE' | 'UPDATE' | 'DELETE'
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  at: string  // ISO
}
```

## 3. 风险

- **R-3 · web project references**：`apps/web/tsconfig.json` 可能是 `composite` 模式，`tsc -b` 做增量。新文件加到主 include 下面就行；无需改 tsconfig。
- **R-4 · 已有 writeAudit 调用**：必须**不**破坏 `routes/acl.ts` 现有的 `await writeAudit(...)`；我只在它之后追加。
- **R-5 · ShareModal 现状**：spec 假设 ShareModal 支持 user + team 两类主体；要核对真实代码，避免我写的测试基于不准确假设。若代码目前只支持 user，那就成了 A-FE-2 需要验证的失败点 —— 交给用户本机 vitest 时会暴露。

## 4. 不在本轮 Execute 的事项

- 归档（`docs/superpowers/specs/permissions-v2/` → `archive/`）放到 E 阶段，等 D 全部 PASS
- 新 ADR `permissions-v2-lock.md` 也在 E 阶段写
- VR-1 / VR-2 / F-6 / F-7 / F-8 明确在 Lock 的 proposal.md 里 OUT OF SCOPE，不做
