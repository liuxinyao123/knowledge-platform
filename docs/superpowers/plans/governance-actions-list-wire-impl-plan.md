# Impl Plan · governance-actions-list-wire

> 工作流 C。设计：`docs/superpowers/specs/governance-actions-list-wire-design.md`。

## 改动清单

### 1. `apps/qa-service/src/services/actionEngine.ts`

- 追加 `export interface ListRunsOptions { state?, actionName?, limit?, offset? }`
- 追加 `export async function listRuns(principal, opts): Promise<{items, total}>`
  - admin 看全量；非 admin 按 `actor_id` 过滤
  - `state` / `action_name` 可选过滤
  - `limit` 默认 50 上限 200
  - ORDER BY created_at DESC
  - 不返回 `audit_log`（用 getRun 时才带）
- 参数化 query（避免注入）

### 2. `apps/qa-service/src/routes/actions.ts`

- 新增 `actionsRouter.get('/runs', ...)` **放在** `get('/runs/:run_id')` **之前**
- 入参 `state` / `action_name` / `limit` / `offset` 做 typeof string 校验
- 错误返 500 + `String(err)`；不拆详细 error code（admin only 操作，容错要求低）
- 响应 shape 匹配前端 `ActionRun` TypeScript type

### 3. `apps/qa-service/src/routes/actions.ts` import

- 从 `actionEngine.ts` import 新增 `listRuns`

### 4. `apps/web/src/api/actions.ts`

- 新增 `actionsApi.listRuns(opts)` 方法

### 5. `apps/web/src/knowledge/Governance/Actions/index.tsx`

- `useEffect` 改为 `Promise.all([listRuns({state:'pending'}), listRuns({})])`
- `cancelled` flag 防止 unmount 后 setState 警告
- 新增 `error` state + 渲染带"重试"按钮的错误块
- `history` 列表前端再过一次 `!== 'pending'` 避免 double-display

## 验证

- `npx tsc --noEmit` 三包清
- `node --experimental-strip-types -e "import('./src/services/actionEngine.ts')"` 在 qa-service 成功（确认 ADR-37 纪律）
- 用户本机：
  - curl 触发一个 `revoke_acl_rule`（high risk 强制 pending）后访问 `/governance` → "操作与审批"应看到待审批项
  - 点"批准"后刷新，pending 为空、history 多一条 succeeded/failed
  - 点"拒绝"后刷新，pending 为空、history 多一条 rejected

## 单测建议（本次未写，下次配上）

- `actionEngine.listRuns.test.ts` —— admin 全量 vs 非 admin 仅自己；state / action_name 过滤；limit/offset 边界
- `routes/actions.test.ts` 补 `GET /runs` 的 200 / 500 / limit 上限 clamp

## Out of Scope

- 翻页器 UI
- 过滤器 UI
- WebSocket 实时刷新
- action 触发入口（另开 change）
