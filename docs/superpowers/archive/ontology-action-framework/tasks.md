# Tasks: Action Framework

> 工作流 D 仅产契约。执行阶段由下游 B 流程承接。

## 执行阶段（契约合并后由执行方勾选）

### Migration

- [x] 新增 migration `apps/qa-service/src/migrations/<seq>-action-framework.sql`
  - [x] 建表 `action_definition`
  - [x] 建表 `action_run`（含索引 `(state, created_at DESC)`、`(actor_id, created_at DESC)`）
  - [x] 建表 `action_audit`（含索引 `(run_id, created_at)`）

### 核心框架

- [x] 新增 `apps/qa-service/src/services/actionEngine.ts`
  - [x] `registerAction(def)` / `listActions(principal)`
  - [x] `submitRun(name, args, principal, reason?)`（含 schema 校验 / precondition / V2 鉴权）
  - [x] `approveRun / rejectRun / cancelRun / getRun`
  - [x] 状态机转移函数 + 写 `action_audit`
  - [x] 错误类型 `ActionFatalError` / `ActionRetryableError`
- [x] 新增 `apps/qa-service/src/services/actionWebhook.ts`
  - [x] URL 白名单校验
  - [x] HMAC 签名
  - [x] 指数退避重试
- [x] 新增 `apps/qa-service/src/services/actionPreconditions.ts`
  - [x] 实现 `asset_status_eq` / `principal_has_role` / `and` / `or`

### 路由

- [x] 新增 `apps/qa-service/src/routes/actions.ts`
  - [x] `GET /api/actions`
  - [x] `POST /api/actions/:name/run`
  - [x] `GET /api/actions/runs/:run_id`
  - [x] `POST /api/actions/runs/:run_id/approve`
  - [x] `POST /api/actions/runs/:run_id/reject`
  - [x] `POST /api/actions/runs/:run_id/cancel`
- [x] 挂载到 `apps/qa-service/src/index.ts`

### 内置 Action 实现（各自按需排期）

- [x] `actions/rebuild_asset_index.ts`
- [x] `actions/offline_asset.ts`
- [x] `actions/online_asset.ts`
- [x] `actions/revoke_acl_rule.ts`
- [x] `actions/rebuild_kg_from_asset.ts`
- [x] 在 qa-service 启动时逐个 `registerAction`

### 测试

- [x] `actionEngine.state.test.ts`（合法 / 非法状态转移）
- [x] `actionEngine.preconditions.test.ts`
- [x] `actionEngine.webhook.test.ts`（白名单、签名、重试）
- [x] `routes/actions.test.ts`（鉴权、状态转移、全端点）
- [x] 至少 2 个内置 Action 的 happy-path 集成测试
- [x] `pnpm --filter qa-service test` 全 GREEN

### 验证

- [x] `npx tsc --noEmit` 通过
- [x] 端到端：`revoke_acl_rule` 必须走 pending → admin approve → executing → succeeded
- [x] 端到端：webhook 白名单外 URL 启动即失败
- [x] 审计可追溯：任选一个 run，`action_audit` 至少含 `state_change*N + webhook_sent/failed*K`

### 文档

- [x] 补 `.superpowers-memory/integrations.md`：新增 `action_*` 表与 `ACTION_WEBHOOK_*` 环境变量
- [x] 补 `.superpowers-memory/glossary.md`：`ActionDefinition / ActionRun / Precondition`
- [x] 新增 ADR `.superpowers-memory/decisions/<date>-<seq>-action-framework.md`

### 归档

- [x] 归档到 `docs/superpowers/archive/ontology-action-framework/`

---

## 依赖

- **强依赖**：Permissions V2（已合并）— `apps/qa-service/src/auth/evaluateAcl.ts`
- **类型扩展**：给 `AclResource` 追加 `action_name?: string` 和 `action_run_id?: string` 两个可选字段，不改 `resourceMatches` 逻辑
- **软依赖**：`ontology-declarative-skills` 会消费 `/api/actions/*`；该 change 可独立合并上线
- **可选**：Governance UI（另走 workflow C）
