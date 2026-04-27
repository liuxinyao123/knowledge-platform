# Design: Action Framework

## 状态机

```
       ┌───────────┐        (auto if risk_level=low)
       │   draft   │ ─────────────────────────────┐
       └─────┬─────┘                              │
             │ submit()                           │
             ▼                                    │
       ┌───────────┐                              │
       │  pending  │                              │
       └─────┬─────┘                              │
             │ approve()          reject()        │
             ├─────────────┐ ┌──────────────┐     │
             ▼             │ ▼              │     │
       ┌───────────┐       │ ┌──────────┐   │     │
       │ approved  │◄──────┘ │ rejected │   │     │
       └─────┬─────┘         └──────────┘   │     │
             │ run()                        │     │
             ▼                              │     │
       ┌───────────┐                        │     │
       │ executing │                        │     │
       └─┬─────────┘                        │     │
         │       \                          │     │
         │        \  cancel()               │     │
         ▼         ▼                        ▼     ▼
    ┌────────┐  ┌───────────┐      ┌────────┐   ┌────────────┐
    │success │  │ cancelled │      │ failed │   │  executing │
    └────────┘  └───────────┘      └────────┘   └────────────┘
```

终态：`succeeded` / `failed` / `cancelled` / `rejected`。进入终态后不可再转换。

---

## 表结构（migration 由执行方实施）

### action_definition

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | varchar(64) PK | Action 名（全局唯一） |
| `description` | text | 展示用 |
| `input_schema` | jsonb | JSON Schema，用于服务端校验 |
| `output_schema` | jsonb | JSON Schema |
| `risk_level` | varchar(8) | `low` / `medium` / `high` |
| `preconditions` | jsonb | 可为 `null`；下面详述格式 |
| `approval_policy` | jsonb | `{required: boolean, approver_roles: string[]}` |
| `webhook` | jsonb | 可为 `null`；`{url, events: string[], retry: 3}` |
| `enabled` | boolean | 禁用开关 |
| `created_at` / `updated_at` | timestamptz | |

### action_run

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | run_id |
| `action_name` | varchar(64) FK | |
| `actor_id` | varchar(64) | principal.id（发起人） |
| `actor_role` | varchar(16) | principal.role |
| `args` | jsonb | 输入参数（已通过 schema 校验） |
| `reason` | text | 可选理由 |
| `state` | varchar(16) | 状态机取值 |
| `attempts` | int | 执行尝试次数（失败可重试） |
| `result` | jsonb | 成功时的 output |
| `error` | jsonb | 失败时 `{code, message, stack_hash}` |
| `approver_id` | varchar(64) | 审批者（pending→approved/rejected 时写入） |
| `approval_note` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `completed_at` | timestamptz | 进入终态时写入 |

索引：`(state, created_at DESC)`（供审批队列分页）；`(actor_id, created_at DESC)`（用户历史）。

### action_audit

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `run_id` | uuid FK | 关联 run |
| `event` | varchar(24) | `state_change` / `webhook_sent` / `webhook_failed` |
| `before_json` | jsonb | state_change 时填 before state |
| `after_json` | jsonb | state_change 时填 after state |
| `actor_id` | varchar(64) | 触发该事件的 principal |
| `extra` | jsonb | 事件特有字段（webhook 的 response status 等） |
| `created_at` | timestamptz | |

索引：`(run_id, created_at)`。

---

## actionEngine.ts API

```ts
export interface ActionDefinition<I = unknown, O = unknown> {
  name: string
  description: string
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  riskLevel: 'low' | 'medium' | 'high'
  preconditions?: PreconditionExpr
  approvalPolicy: { required: boolean; approverRoles: string[] }
  webhook?: { url: string; events: ActionEvent[]; retry?: number }
  handler: (args: I, ctx: ActionContext) => Promise<O>
}

export interface ActionContext {
  runId: string
  principal: Principal
  reason?: string
  attempts: number
}

export type ActionEvent = 'submitted' | 'approved' | 'rejected' | 'started' | 'succeeded' | 'failed' | 'cancelled'

export function registerAction(def: ActionDefinition): void
export function listActions(principal: Principal): ActionDefinition[]
export async function submitRun(name: string, args: unknown, principal: Principal, reason?: string): Promise<{ run_id: string; state: string }>
export async function approveRun(runId: string, principal: Principal, note?: string): Promise<void>
export async function rejectRun(runId: string, principal: Principal, note?: string): Promise<void>
export async function cancelRun(runId: string, principal: Principal): Promise<void>
export async function getRun(runId: string, principal: Principal): Promise<ActionRun>
```

---

## PreconditionExpr 格式（最小子集）

```ts
type PreconditionExpr =
  | { op: 'asset_status_eq'; asset_id_arg: string; value: 'online' | 'offline' }
  | { op: 'principal_has_role'; roles: string[] }
  | { op: 'and'; all: PreconditionExpr[] }
  | { op: 'or'; any: PreconditionExpr[] }
```

- `asset_status_eq.asset_id_arg` 指向 `args` 中某个字段名（字符串），运行时用该字段值查 `metadata_asset`。
- **不支持**自定义表达式、SQL 注入风险字段。
- 违反 precondition → `submitRun` 返回 `{error: "precondition_failed", detail: {...}}`，不进入状态机。

---

## 执行流程

### submitRun(name, args, principal, reason)

1. 查 `action_definition`（不存在 → 404）
2. JSON Schema 校验 `args`（失败 → 400）
3. 校验 preconditions（失败 → 409 `precondition_failed`）
4. Permissions V2 检查：执行方是否有权限提交该 Action（见下）
5. 决定初始状态：
   - `risk_level === 'high'` 或 `approval_policy.required === true` → `pending`
   - 否则 → `approved`（跳过审批）
6. 写入 `action_run`（state=初始状态，attempts=0）
7. 写 `action_audit` 事件 `state_change` (null → pending/approved)
8. 发 webhook 事件 `submitted`（fire-and-forget）
9. 若初始状态为 `approved`，异步触发 `runApproved(runId)`
10. 返回 `{run_id, state}`

### runApproved(runId)

1. 读取 run，state 必须是 `approved`，否则跳过
2. 更新 state → `executing`；写 audit；发 webhook `started`
3. `attempts += 1`
4. 调 `definition.handler(args, ctx)`；成功 → state=`succeeded`, result=<output>；失败 → state=`failed`, error=<err>
5. 写 audit；发 webhook `succeeded` / `failed`
6. 写 `completed_at`

### approveRun / rejectRun

- 仅 `approval_policy.approverRoles` 内的 principal 可调用
- 仅 `state === 'pending'` 可转移；否则 409 `invalid_state_transition`
- `approveRun` → state=`approved`；随后调 `runApproved(runId)`
- `rejectRun` → state=`rejected`（终态），不再执行

### cancelRun

- 允许者：actor 本人 或 admin 角色
- 允许状态：`draft / pending / approved` 可直接 cancel；`executing` 设置 `cancel_requested` 标志但不保证中断（handler 自行检查 `ctx.cancelRequested`，本期不强制实现）

---

## 鉴权模型（复用 Permissions V2，不新增）

所有权限决策走 `apps/qa-service/src/auth/evaluateAcl.ts` 的 `evaluateAcl(principal, action, resource)`，返回 `Decision{allow, reason}`。本 change **不**新增 ACL 表或字段，只约定 `action` / `resource` 两个入参的命名。

- **提交 Action（`submitRun`）**：调 `evaluateAcl(principal, "EXECUTE", {action_name: name})`；`action_name` 作为 `AclResource` 的新可选字段由本 change 声明（类型层追加即可，V2 的 `resourceMatches` 在字段缺失时不命中，行为向后兼容）。默认种子：`admin` 角色 `allow EXECUTE` 所有 action。
- **审批（`approveRun/rejectRun`）**：`principal.role ∈ approvalPolicy.approverRoles`（通常 `admin`）；不走 `evaluateAcl`，直接比较 role，避免为"审批权"单独建规则。
- **查看（`getRun`）**：actor 本人可看；否则调 `evaluateAcl(principal, "READ", {action_run_id: run_id})` —— MVP 阶段该 resource 仅 `admin` 有 `allow`。

**不新增 ACL 表**。但会给 `AclResource` TypeScript 类型追加 `action_name?: string` 和 `action_run_id?: string` 两个可选字段。下游 `permissions-v2` 的 `resourceMatches` 逻辑保持不变（未命中的字段被忽略），向后兼容。

---

## Webhook

```ts
{ url: "https://ci.example.com/hooks/action",
  events: ["succeeded", "failed"],
  retry: 3 }
```

- URL 必须在 `ACTION_WEBHOOK_ALLOWLIST` 环境变量（逗号分隔前缀）内
- Payload：

```json
{
  "run_id": "...",
  "action": "rebuild_asset_index",
  "event": "succeeded",
  "actor_id": "u123",
  "args": {...},
  "result": {...},
  "occurred_at": "2026-04-24T12:34:56Z"
}
```

- 签名：`X-Action-Signature: sha256=<hmac>`，密钥 `ACTION_WEBHOOK_SECRET`
- 失败重试：指数退避（1s / 4s / 16s），3 次全失败 → `action_audit` 写 `webhook_failed`，但**不改变 run state**

---

## 五个内置 Action 契约

| Action | input（摘要） | output（摘要） | risk | 审批 | 预置条件 |
|--------|-------------|--------------|------|------|----------|
| `rebuild_asset_index` | `{asset_id}` | `{chunks, duration_ms}` | medium | 由配置决定 | asset 存在 |
| `offline_asset` | `{asset_id, reason?}` | `{ok: true}` | medium | 默认 required | `asset_status_eq(asset_id, 'online')` |
| `online_asset` | `{asset_id}` | `{ok: true}` | low | 否 | `asset_status_eq(asset_id, 'offline')` |
| `revoke_acl_rule` | `{rule_id}` | `{ok: true}` | high | **强制** | rule 存在 |
| `rebuild_kg_from_asset` | `{asset_id}` | `{nodes, edges, ms}` | low | 否 | asset 存在 |

每个 Action 的 handler 实现由执行方在契约合并后补齐；本 change 仅要求实现必须：
- 幂等（多次调用结果一致，或用 `run_id` 去重）；
- 不得直接 commit 前写 `action_audit`（框架统一处理）；
- 遇到不可恢复错误抛 `ActionFatalError`；可重试错误抛 `ActionRetryableError`（框架目前不自动重试，仅为未来扩展预留）。

---

## 可观测性

- 每个 run 全链路日志键 `action_run_id`
- Metrics（执行方接入已有 logging 即可，未强制接 Prometheus）：
  - `action_run_total{action, state}`
  - `action_run_duration_ms{action}`
- `/api/actions/runs/:run_id` 的响应含 `audit_log` 最后 5 条（便于前端 Governance UI 展示）

---

## 测试策略

- `actionEngine.test.ts`：状态机合法转移 / 非法转移
- `actionEngine.preconditions.test.ts`：precondition 失败
- `actionEngine.webhook.test.ts`：webhook 白名单 / 重试 / 签名
- `routes/actions.test.ts`：各端点鉴权 + 状态转移
- 每个内置 Action 一套集成测试（执行方补）
