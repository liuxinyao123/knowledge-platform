# Proposal: Action Framework · 写操作的状态机 / 审批 / Webhook 闭环

## Problem

PolarDB-PG Ontology 文章的第三块核心是 **Action 框架**：把写操作统一收敛到"预定义业务操作"，带 preconditions / pending 审批 / 执行效果 / webhook / 审计。

当前 `qa-service` 的写操作分散在各 route，缺乏统一治理：

- 无统一前置条件校验（比如"asset.offline=true 才能重建索引"这类规则靠调用方自觉）；
- 无 pending / 审批机制（Permissions V2 的 deny 规则只能拦截，无法"暂缓"）；
- 无状态机（"已提交—执行中—成功/失败"等状态散落在各业务日志里）；
- 无统一 webhook 出口（接 CI/CD、工单系统要每个 route 单独接）；
- 审计靠 `audit_log` 和 `acl_rule_audit` 两套表，粒度不一致；
- 声明式 Skill（`ontology-declarative-skills`）需要一个统一的"写操作代理端点"来暴露给 Agent，否则每个写操作都要暴露一条单独的 proxy。

## Scope（本 change）

1. **新建表**（migration 在执行阶段实施）：
   - `action_definition` — 注册表，声明可执行的 Action
   - `action_run` — 每次执行的运行记录（状态机）
   - `action_audit` — 审计日志（参考 `acl_rule_audit` 结构）
2. **新模块**：`apps/qa-service/src/services/actionEngine.ts`
3. **新路由**：`apps/qa-service/src/routes/actions.ts`，提供：
   - `GET /api/actions` — 列出已注册 Action
   - `POST /api/actions/:name/run` — 触发执行（返 run_id）
   - `GET /api/actions/runs/:run_id` — 查看运行状态
   - `POST /api/actions/runs/:run_id/approve` — 审批通过（admin）
   - `POST /api/actions/runs/:run_id/reject` — 审批拒绝（admin）
   - `POST /api/actions/runs/:run_id/cancel` — 取消（owner 或 admin）
4. **状态机**：`draft → pending → approved → executing → succeeded | failed | cancelled`，外加 `rejected` 分支。
5. **内置 Action（仅声明契约，本 change 不实现具体业务逻辑）**：
   - `rebuild_asset_index` — 重建单个 asset 的向量索引（risk_level=medium）
   - `offline_asset` — 软下架 asset（risk_level=medium）
   - `online_asset` — 上架 asset（risk_level=low）
   - `revoke_acl_rule` — 撤销一条 ACL 规则（risk_level=high → 强制审批）
   - `rebuild_kg_from_asset` — 重跑 KG upsert（risk_level=low）
   执行方在本 change 的 OpenSpec 合并后自行挑选落地顺序。
6. **Webhook**：`on_state_change` 配置，POST 到白名单 URL；重试 3 次，指数退避。
7. **鉴权**：`requireAuth` + Permissions V2 的 subject-based 检查；不新增权限模型。

## Out of Scope

- Governance UI（审批队列页面）—— 属于 UI 层，走单独 `superpowers-feature` workflow；
- 跨 Action 的组合（"先 offline 再 rebuild 再 online"）—— 本期每个 Action 独立；
- 分布式锁与多副本下的去重（本期 `qa-service` 仍是单实例部署）；
- 给老路由加兼容层（老路由保留原行为，逐步迁移）；
- Action 的定时触发（`node-cron` 继续服务 file-source，本期不复用）；
- Rollback / 补偿事务（Action 成功即视为幂等，失败靠执行方自行实现补偿逻辑）。

## Success Metrics

- 新增 Action 只需 1 次 `register({name, inputSchema, handler, risk_level, ...})` 调用；
- 高危 Action 无法绕过审批（spec scenario 覆盖）；
- 所有 Action 执行均有 `action_audit` 记录（before_json / after_json / actor / reason）；
- Webhook 外发地址全部在 `ACTION_WEBHOOK_ALLOWLIST` 内；
- 现有 `audit_log` 和 `acl_rule_audit` 两套表**不迁移、不改动**。
