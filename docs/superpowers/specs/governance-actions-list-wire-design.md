# Explore · governance-actions-list-wire

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec，UI 数据接通）。
> 起因：ADR-35 `ontology-action-framework` 交付时 Governance/Actions UI shell 已就绪，但
> `useEffect` 是 `setPendingRuns([])` / `setHistoryRuns([])` 硬编码空，且后端没有
> `GET /api/actions/runs` 列表端点。结果：admin 打开 `/governance` "操作与审批" tab
> 永远看到空，无法验证 Action 状态机的真实运行情况。

## 现状

- 后端 `routes/actions.ts` 6 端点：list 定义 / submit / get one run / approve / reject / cancel
- 前端 `actionsApi`：listActions / submitRun / getRun / approveRun / rejectRun / cancelRun
- 缺：list **runs**（不是 list 定义）

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 新增 `listRuns(principal, opts)` 在 `actionEngine.ts`，admin 看全量 / 非 admin 看 `actor_id = principal.user_id` | 不走 `evaluateAcl` 做行级 ACL —— admin role 是足够粒度，runs 表行多查询慢；ACR-aware filtering 留 OQ |
| D-002 | 新增 `GET /api/actions/runs?state=&action_name=&limit=&offset=` 路由 | 必须在 `GET /runs/:run_id` **之前**注册（Express 顺序匹配） |
| D-003 | 前端 `actionsApi.listRuns(opts)` 走 query params，PendingQueue 只显示 `state=pending`，RunHistory 显示其它状态 | 两个并行 fetch；history 端口拉 50 条做最近活动概览 |
| D-004 | 增加 error state UI（带"重试"按钮）—— 不再 silently 吞错 | 之前 `} catch { /* handle error silently */ }` 是 MVP 偷懒，admin 没法定位 |
| D-005 | 不做 `useQuery` / `react-query` 接入 —— 保持 `useEffect` 简单 | 项目其他地方已经混用 `useQuery` 和 `useEffect`，这块不增加迁移成本；下次 refactor 再统一 |
| D-006 | limit 默认 50（history）/ 100（pending），上限 200，分页参数 (limit/offset) 已就位但 UI 不渲染分页器 | 等真有翻页需求再做；当前 admin 的 pending queue 不会爆 |

## Out of Scope

- `RunHistory` 的 filter 控件（按 action / state 筛选）—— 后端参数已支持，前端 UI 不渲染过滤器
- 翻页器 UI
- Action 触发 UI（admin 主动从 UI 点 "下架资产" / "重建索引"）—— 应该挂在资产详情页 / KG 页的 action 按钮，不在 Governance 中心
- WebSocket / SSE 实时刷新（当前需点 "重试" 或 PendingQueue approve/reject 后 onRefresh 触发）

## 风险

| # | 风险 | 缓解 |
|---|------|------|
| R-1 | `GET /runs` 路由声明顺序错把 `runs/:run_id` 优先匹配 | 显式注释 + 集成测试覆盖 |
| R-2 | admin 角色字符串没统一（`'admin'` vs `'ADMIN'`） | 沿用 `principal.roles?.includes('admin')`，与 `routes/iamAcl.ts` 一致 |
| R-3 | 大 args/result jsonb 列拉回前端造成 payload 膨胀 | listRuns 不带 `audit_log`（用 getRun 详情才带）；上限 limit=200 兜底 |
