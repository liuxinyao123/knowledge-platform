# Spec: Action Engine 状态机与鉴权

## submitRun

**Scenario: low 风险 + 无需审批 → 直接 approved**
- Given Action `online_asset`，`risk_level=low`，`approval_policy.required=false`
- And `evaluateAcl(principal, "EXECUTE", {action_name:"online_asset"}) → {allow:true}`
- When `POST /api/actions/online_asset/run` body `{args:{asset_id:"a1"}}`
- Then 响应 `{run_id:<uuid>, state:"approved"}`
- And `action_run` 表新增一行，state=`approved`
- And `action_audit` 表新增一行 `event=state_change, before=null, after="approved"`

**Scenario: high 风险强制进入 pending**
- Given Action `revoke_acl_rule`，`risk_level=high`
- When principal 调 `POST /api/actions/revoke_acl_rule/run`
- Then 响应 state=`"pending"`，即使 `approval_policy.required=false` 也强制 pending
- And 发 webhook 事件 `submitted`（若配置）

**Scenario: Schema 校验失败返回 400**
- Given Action input 要求 `{asset_id: string}`
- When 提交 `{args: {asset_id: 42}}`
- Then 响应 400，body `{error:"invalid_args", detail:[...]}`
- And 不写入 `action_run`

**Scenario: Precondition 失败返回 409**
- Given Action `offline_asset` 的 precondition 要求 `asset.status === "online"`
- And asset a1 当前 `status="offline"`
- When 提交 `{args:{asset_id:"a1"}}`
- Then 响应 409，body `{error:"precondition_failed", detail:{op:"asset_status_eq", expected:"online"}}`

**Scenario: 未鉴权 401**
- When 无 JWT 调 `POST /api/actions/online_asset/run`
- Then 响应 401

**Scenario: Permissions V2 拒绝 403**
- Given `evaluateAcl(principal, "EXECUTE", {action_name:"offline_asset"}) → {allow:false}`（无匹配规则或显式 deny）
- When 提交
- Then 响应 403

**Scenario: Action 不存在 404**
- When 提交 `POST /api/actions/nope/run`
- Then 响应 404，body `{error:"action_not_found"}`

---

## approveRun / rejectRun

**Scenario: admin 审批通过触发执行**
- Given run `r1` state=`pending`
- And principal.role === "admin" 且在 approverRoles
- When `POST /api/actions/runs/r1/approve` body `{note:"ok"}`
- Then 响应 200
- And `action_run` 更新：approver_id=admin, approval_note="ok", state 转为 `approved` 然后进入 `executing`
- And handler 被调用，结果落 `result` 字段
- And 发 webhook 事件 `approved` 和 `started`、最终 `succeeded`

**Scenario: 非 approver 审批 403**
- Given principal.role === "dev"
- And approverRoles = ["admin"]
- When `POST /api/actions/runs/r1/approve`
- Then 响应 403

**Scenario: 非 pending 状态审批 409**
- Given run `r1` state=`succeeded`
- When `POST /api/actions/runs/r1/approve`
- Then 响应 409，body `{error:"invalid_state_transition"}`

**Scenario: reject 进入终态**
- Given run `r1` state=`pending`
- When admin `POST /api/actions/runs/r1/reject` body `{note:"无必要"}`
- Then run.state=`rejected`，completed_at 写入
- And 不再调 handler
- And 发 webhook 事件 `rejected`

---

## runApproved → handler

**Scenario: handler 成功**
- Given `online_asset` handler 返回 `{ok: true}`
- When run 从 approved → executing → 执行 handler
- Then state=`succeeded`, result=`{ok:true}`, attempts=1, completed_at set
- And webhook 事件 `started` 和 `succeeded` 被尝试发送

**Scenario: handler 抛 ActionFatalError**
- Given handler 抛 `new ActionFatalError("disk_full")`
- When runApproved 执行
- Then state=`failed`, error.code="disk_full", attempts=1
- And webhook 事件 `failed`

**Scenario: handler 抛普通 Error 也视为 failed**
- Given handler 抛 `new Error("oops")`
- Then state=`failed`, error.message 含 "oops"

---

## cancelRun

**Scenario: 发起人 cancel pending**
- Given run `r1` actor_id="u1" state=`pending`
- When principal u1 调 cancel
- Then state=`cancelled`, completed_at set

**Scenario: 他人 cancel 403**
- Given run actor_id="u1" state=`pending`
- When principal u2 (非 admin) 调 cancel
- Then 403

**Scenario: executing 状态仅设 cancel_requested**
- Given run state=`executing`
- When admin 调 cancel
- Then 响应 202，body `{cancel_requested:true}`
- And state 保持 `executing`（由 handler 自行检查 ctx.cancelRequested；MVP 不强制中断）

---

## Webhook

**Scenario: 白名单外 URL 拒绝注册**
- Given `ACTION_WEBHOOK_ALLOWLIST="https://ci.example.com"`
- When 注册 Action 含 `webhook.url = "https://evil.com/hook"`
- Then `registerAction` 抛错，进程启动失败

**Scenario: Webhook 3 次重试后 fail 不改 run state**
- Given webhook URL 返回 500
- When run 触发事件 `succeeded`
- Then webhook 被调 3 次（1s / 4s / 16s 退避）
- And 最终 `action_audit` 写 `event=webhook_failed, extra:{status:500,attempts:3}`
- And `action_run.state` 仍为 `succeeded`（未被污染）

**Scenario: Webhook 签名头**
- When 发送 webhook
- Then HTTP 请求头含 `X-Action-Signature: sha256=<hex>`
- And hex = HMAC-SHA256(ACTION_WEBHOOK_SECRET, payload_json)

---

## GET /api/actions/runs/:run_id

**Scenario: actor 本人查询成功**
- Given run r1 actor_id="u1"
- When principal u1 调 `GET /api/actions/runs/r1`
- Then 响应 200，body 含 run 全字段 + `audit_log` 最后 5 条

**Scenario: 他人查询 403**
- When principal u2 (非 admin) 查询 u1 的 run
- Then 403

**Scenario: admin 查询任意 run**
- When principal admin 查询任意 run_id
- Then 200

**Scenario: run 不存在 404**
- When `GET /api/actions/runs/no-such-id`
- Then 404

---

## GET /api/actions

**Scenario: 列出 enabled 的 Action**
- Given action_definition 有 5 行，3 行 enabled=true
- When principal 调 `GET /api/actions`
- Then 响应 `{items: [...]}` 长度 === 3
- And 每个 item 含 `name/description/riskLevel/inputSchema/approvalPolicy.required`
- And **不**含 `handler` / 数据库原始 jsonb 的内部字段

**Scenario: 按 V2 过滤不可提交的 Action**
- Given `evaluateAcl(principal, "EXECUTE", {action_name:"revoke_acl_rule"}) → {allow:false}`
- When `GET /api/actions`
- Then 响应 items 不含 `revoke_acl_rule`（或含但 `can_submit:false`，执行方二选一；spec 固定为"过滤掉"）
- And 返回列表中每个 action 的 `can_submit` 字段均为 true
