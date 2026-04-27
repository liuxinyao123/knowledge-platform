# ADR 2026-04-24-35 — Action Framework · 写操作状态机 + 审批 + Webhook + Governance UI

> 工作流 B。OpenSpec 契约：`openspec/changes/ontology-action-framework/`。

## 背景

平台的写操作（offline asset / rebuild index / revoke ACL rule …）散落在各 route，缺乏：统一前置条件、pending 审批、Webhook 出口、状态机审计。Ontology 平台需要一个统一入口供 Skill 层调用。

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 状态机：`draft → pending → approved → executing → {succeeded\|failed\|cancelled}`；旁分支 `rejected`；终态不可回转 | 所有转移经 `transitionState` 单函数，PG 事务内写 `action_audit` |
| D-002 | 三张新表：`action_definition` / `action_run` / `action_audit` | 迁移 SQL 内联到 `services/pgDb.ts:runPgMigrations`（项目约定，不用独立 migration 文件）|
| D-003 | `risk_level='high'` 强制 pending，忽略 `approval_policy.required` | 高危路径硬闸 |
| D-004 | 鉴权复用 Permissions V2：`evaluateAcl(principal, 'EXECUTE', {action_name})` 与 `evaluateAcl(principal, 'READ', {action_run_id})` | 不新增 ACL 表 |
| D-005 | `AclResource` 类型追加 `action_name?` 和 `action_run_id?` 两个可选字段；`AclAction` 追加 `'EXECUTE'` | 加法修改，V2 的 `resourceMatches` 对缺字段天然忽略，向后兼容 |
| D-006 | Webhook：URL 白名单（`ACTION_WEBHOOK_ALLOWLIST` 前缀）在 `registerAction` 时 fail-fast；HMAC-SHA256 签名 `X-Action-Signature` 头；重试 3 次指数退避 1s/4s/16s；最终失败写 `action_audit.event='webhook_failed'` 但不改 `run.state` | Webhook 是旁路，不污染主状态 |
| D-007 | 五个内置 Action：`rebuild_asset_index` / `offline_asset` / `online_asset` / `revoke_acl_rule` / `rebuild_kg_from_asset` | 每个都幂等；`revoke_acl_rule` 风险级 high，强制审批 |
| D-008 | Governance UI：新增"操作与审批"tab；`PendingQueue / RunHistory / RunDetail` 三个子组件；复用 react-query + Tailwind 原有范式 | 审批人可在前端一键 approve / reject / cancel |
| D-009 | `cancelRun` 对 `executing` 状态仅设 `cancel_requested=true`；MVP 不保证中断（handler 自觉 check ctx.cancelRequested） | 文档留作 TODO |
| D-010 | `submitRun` schema 校验走 `ajv@8.x` | sandbox 用 symlink 方式接 ajv；用户 Mac 上 `pnpm install` 后自动就绪 |

## 代码清单

### 新增（后端）
- `services/actionEngine.ts` — 注册表 + 状态机 + 执行流
- `services/actionWebhook.ts` — HMAC 签名 + 重试
- `services/actionPreconditions.ts` — 递归评估 `asset_status_eq / principal_has_role / and / or`
- `routes/actions.ts` — 6 个端点（GET list / POST run / GET run / POST approve / POST reject / POST cancel）
- `actions/index.ts` — bootstrap 注册 5 个内置 Action
- `actions/rebuildAssetIndex.ts / offlineAsset.ts / onlineAsset.ts / revokeAclRule.ts / rebuildKgFromAsset.ts`
- 测试：`__tests__/actionEngine.state.test.ts` / `preconditions.test.ts` / `webhook.test.ts` / `routes/actions.test.ts`

### 新增（前端）
- `apps/web/src/api/actions.ts` — 类型化 axios client
- `apps/web/src/knowledge/Governance/Actions/` 四个组件 + 各自 test

### 修改
- `apps/qa-service/src/auth/types.ts` — `AclResource` 加两个可选字段；`AclAction` 加 `'EXECUTE'`
- `apps/qa-service/src/services/pgDb.ts:runPgMigrations` — 内联 `action_definition / action_run / action_audit` 三张表 + 三个索引
- `apps/qa-service/src/index.ts` — mount `/api/actions` + `bootstrapActions()` 启动调用
- `apps/web/src/knowledge/Governance/index.tsx` — 新增 "操作与审批" tab 注册

## 本次执行中的型修复

初次生成的 Action 代码有 17 个 tsc 错误（handler 泛型赋值、`req.query` 联合类型、`evaluateAcl` 未 await、`principal.user_id: number` 传给 string 参数、`def.webhook.url` 窄化穿透回调）。全部修掉后三包 `tsc --noEmit` 清。

## 向后兼容

- `AclResource` 和 `AclAction` 只做加法，不删改；所有老 V2 规则评估行为不变
- 老的 `acl_rule_audit` 写入路径保持（见 permissions-v2）；`action_audit` 是新表，和 `acl_rule_audit` 并行
- 老 Governance tabs（`KnowledgeOps`）未动

## 新增环境变量

```bash
# Webhook（可选，未配置则关闭出口）
ACTION_WEBHOOK_ALLOWLIST=https://ci.example.com,https://incident.example.com
ACTION_WEBHOOK_SECRET=<32+ hex>
```

## 验证

- `npx tsc --noEmit` × 3 包清
- vitest 沙箱不能跑（rollup darwin native 限制）；回用户 Mac 跑 `pnpm -r test`
- 端到端：`pnpm dev:up` 后访问 `/governance` 新 tab 应出现"操作与审批"
- 手工触发：`curl -X POST http://localhost:3001/api/actions/online_asset/run -d '{"args":{"asset_id":"a1"}}' -H "Authorization: Bearer $JWT"`

## 关联

- 上游：permissions-v2（复用 `evaluateAcl`）
- 上游：ADR-27 knowledge-graph-age（`rebuild_kg_from_asset` 调现有 upsert 函数）
- 下游：ADR-34 ontology-declarative-skills（`action.execute` / `action.status` Skill 消费本 API）
- 未决（OQ-ONT-3）：executing 状态的真实中断机制（MVP 只设 flag）
