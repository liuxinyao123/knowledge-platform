# Spec: acl-audit（F-3 规则变更审计）

> **与现有 audit_log 的关系**：`routes/acl.ts` 保留既有 `writeAudit({action:'acl_rule_*', ...})`（写老的 `audit_log` 表）不动；F-3 新增的 `acl_rule_audit` 与其**并行**，职责互补（结构化 before/after vs 统一操作流）。本 spec 只冻结 acl_rule_audit 的行为，不重复描述 writeAudit。

## 表结构

**Scenario: acl_rule_audit 表存在且字段正确**
- When 服务启动
- Then 存在表 acl_rule_audit，字段含 `id / rule_id / actor_user_id / actor_email / op / before_json / after_json / at`
- And `at` 默认值为 `now()`
- And `op` 取值 ∈ {'CREATE','UPDATE','DELETE'}
- And 存在索引 `idx_acl_rule_audit_rule(rule_id)` 和 `idx_acl_rule_audit_at(at DESC)`

---

## 写入语义

**Scenario: 规则创建时写 audit**
- Given principal.email='admin@corp.com'
- When POST /api/acl/rules body 合法，返回新建 rule_id=42
- Then acl_rule_audit 新增一行 `{rule_id:42, op:'CREATE', before_json:NULL, after_json:<新规则 JSON>, actor_email:'admin@corp.com'}`

**Scenario: 规则更新时写 before/after**
- Given rule#42 原值 `{effect:'allow', expires_at:NULL}`
- When PUT /api/acl/rules/42 body `{effect:'deny', expires_at:'2026-05-01T00:00Z'}`
- Then acl_rule_audit 新增 `{rule_id:42, op:'UPDATE', before_json:{...allow, NULL...}, after_json:{...deny, 2026-05-01...}}`

**Scenario: 规则删除时 after 为 NULL**
- Given rule#42 存在
- When DELETE /api/acl/rules/42
- Then acl_rule_audit 新增 `{rule_id:42, op:'DELETE', before_json:<老规则>, after_json:NULL}`
- And rule_id 字段仍保留 42（已删除的规则依然可追溯）

**Scenario: audit 写入失败不影响业务**
- Given acl_rule_audit INSERT 抛异常（例如表暂不存在）
- When POST /api/acl/rules
- Then 业务仍返 200（新规则已落地）
- And server 日志 `console.error` 记录 audit 失败

---

## GET /api/iam/acl/audit

**Scenario: 需要 iam:manage 权限**
- Given principal 无 'iam:manage'
- When GET /api/iam/acl/audit
- Then 403

**Scenario: 无过滤返回最近 50 条**
- Given audit 表有 200 条
- When GET /api/iam/acl/audit
- Then 200，items.length ≤ 50（按 at DESC 排）
- And response.total === 200

**Scenario: 按 rule_id 过滤**
- Given audit 表有 rule_id=42 的 3 条 + rule_id=99 的 5 条
- When GET /api/iam/acl/audit?rule_id=42
- Then items 全部是 rule_id=42；total=3

**Scenario: 按 actor 过滤**
- Given 两个 admin 各改过规则
- When GET /api/iam/acl/audit?actor=admin@corp.com
- Then items 仅返 actor_email='admin@corp.com' 的行

**Scenario: 按时间窗过滤**
- Given audit 表横跨一个月
- When GET /api/iam/acl/audit?since=2026-04-20T00:00Z&until=2026-04-22T00:00Z
- Then items 全部 at ∈ [since, until)

**Scenario: limit 上限**
- Given GET /api/iam/acl/audit?limit=9999
- Then 实际返回 ≤ 500 条（服务端 clamp）

---

## 前端 AuditTab

**Scenario: 挂进 /iam 作为第 5 Tab**
- When 用户打开 /iam
- Then 侧 / 顶部 Tab 含「审计」

**Scenario: 表格展示**
- Given audit 行 `{at, actor_email, op, rule_id, before_json, after_json}`
- Then 表格按 at 降序，默认每页 50；显示 `at / actor / op / rule_id / diff`

**Scenario: diff 展示改动字段**
- Given op='UPDATE' + before `{effect:'allow', expires_at:NULL}` + after `{effect:'deny', expires_at:'2026-05-01T00:00Z'}`
- Then diff 列显示 `effect: allow → deny; expires_at: NULL → 2026-05-01T00:00Z`
- And 未改动的字段不显示

**Scenario: 过滤器**
- Given 表头有 rule_id 输入 / actor 输入 / 时间选择器
- When 输入 rule_id=42 触发
- Then 重新请求 GET /api/iam/acl/audit?rule_id=42 并更新列表
