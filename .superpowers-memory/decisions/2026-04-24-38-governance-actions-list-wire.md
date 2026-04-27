# ADR 2026-04-24-38 — Governance/Actions UI 与 list runs 端点接通

> 工作流 C · `superpowers-feature-workflow`。设计 / 计划：
> `docs/superpowers/specs/governance-actions-list-wire-design.md` / `docs/superpowers/plans/governance-actions-list-wire-impl-plan.md`。

## 背景

ADR-35 `ontology-action-framework` 交付时，Governance/Actions UI 的 shell 已构建好（PendingQueue / RunHistory / RunDetail 三个子组件），但：

- 前端 `ActionsTab` 的 `useEffect` 是 stub：`setPendingRuns([])` / `setHistoryRuns([])` 硬编码空
- 后端只实现了 "list action **definitions**"（`GET /api/actions`），没实现 "list action **runs**"
- 结果：admin 打开 `/governance` "操作与审批" tab 永远空，无法从 UI 验证状态机运行情况

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | `actionEngine.listRuns(principal, opts)`：admin 看全量，非 admin 按 `actor_id` 过滤 | 不走行级 `evaluateAcl`（性能 + admin role 已是足够粒度）；ACR-aware filtering 留 OQ-ACT-1 |
| D-002 | `GET /api/actions/runs?state=&action_name=&limit=&offset=` **放在** `GET /runs/:run_id` **之前** 注册 | Express 顺序匹配，顺序颠倒会被吞到 `:run_id` 里；D-002 带显式注释 |
| D-003 | 前端 Promise.all 并发拉 pending + history 两个列表 | pending 独立走 `state=pending&limit=100`；history 走 `limit=50`，客户端再 `.filter(r => r.state !== 'pending')` 避免双显示 |
| D-004 | `useEffect` 加 `cancelled` flag + error state + 重试按钮 | 之前 `catch { /* handle error silently */ }` 是 MVP 偷懒，admin 定位不了故障；现在 error 可见 + 可重试 |
| D-005 | 不引入 react-query / SWR | 保持 `useEffect` 简单；项目其他地方混用，这块等下次统一 refactor |
| D-006 | 分页 API 参数已就位（`limit/offset`）但 UI 不渲染翻页器 | 真有翻页需求再做；当前 admin pending queue 不会爆 |

## 代码清单

### 新增
- 无新文件

### 修改

**后端**
- `apps/qa-service/src/services/actionEngine.ts`：追加 `ListRunsOptions` 接口 + `listRuns` 函数（~80 行，参数化 SQL + admin 分支）
- `apps/qa-service/src/routes/actions.ts`：追加 `import { listRuns }` + `GET /runs` 路由（放在 `GET /runs/:run_id` 之前）

**前端**
- `apps/web/src/api/actions.ts`：追加 `actionsApi.listRuns(opts)` 方法
- `apps/web/src/knowledge/Governance/Actions/index.tsx`：
  - `useEffect` 改为并发 Promise.all 两个 listRuns
  - 新增 `error` state + 渲染错误块 + 重试按钮
  - `cancelled` flag 防 unmount 警告
  - history 客户端再过滤 `!== 'pending'`

## 向后兼容

- `GET /api/actions/runs` 是新端点，不影响现有 6 个端点
- `actionEngine.ts` 新增导出，不修改任何现有函数
- 前端 UI 加载失败会显示错误块，但不会让 Governance 其它 tab 失效
- 如果 `action_run` 表为空（新装机），listRuns 正常返回 `{items:[], total:0}`

## 验证

- `npx tsc --noEmit` 三包清
- `node --experimental-strip-types -e "import('./src/services/actionEngine.ts')"` 在 qa-service 成功，listRuns 在导出列表里（符合 ADR-37 纪律：无 parameter property / enum / namespace）
- 用户本机期望：
  - `revoke_acl_rule`（high risk）curl 触发后访问 `/governance` "操作与审批" tab，pending 列表立即可见
  - 点"批准" / "拒绝"后 onRefresh 触发，pending 减一、history 加一
  - qa-service 关闭时 UI 显示 "加载运行记录失败：..." + 重试按钮

## 关联

- 上游：ADR-35 ontology-action-framework
- 未决：
  - OQ-ACT-1：行级 ACL（`READ {action_run_id}`）vs admin 粒度 —— 当前是 admin 全量 / 非 admin 自己的二选一；如果未来出现 "团队 lead 能看本队所有人的 runs" 这种需求，走新 change 加 `evaluateAcl` 过滤
  - OQ-ACT-2：实时刷新（WebSocket / SSE）vs 轮询 —— 当前手动 refresh 或 approve/reject 后触发

## Followup（不 block 本 ADR）

- 单测：`actionEngine.listRuns.test.ts`（admin 全量 vs 非 admin 仅自己；state/action_name 过滤；limit clamp）
- 单测：`routes/actions.test.ts` 追加 `GET /runs` 的 case
- 资产详情页 / KG 页加"触发 Action"按钮，直接 submitRun，不用走 curl
