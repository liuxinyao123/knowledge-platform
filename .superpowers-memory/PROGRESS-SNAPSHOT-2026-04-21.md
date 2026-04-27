# 知识中台开发进度快照 · 2026-04-21 收工

> 明早打开仓库直接看这份；更细的放在 `decisions/2026-04-21-XX-*.md` ADR 和 `openspec/changes/` 各 change 的 proposal/design/spec/tasks。

---

## 一、整体状态

- **TS 编译**：`apps/web` + `apps/qa-service` 双 `tsc --noEmit` EXIT=0 ✅
- **OpenSpec change 归档**：15 个全归档 ✅
- **ADR**：01 ~ 15 十五条齐全 ✅
- **PRD 功能覆盖**：§2 / §5-6 / §7 / §8-9 / §10 / §11-13 / §14 / §15 全部落地
- **唯一功能缺口**：§16 DSClaw 任务知识抽屉（G8）—— 🅿 PARKED，需先重读 PRD §16 原文
- **UI 还原度**：10 个主要页按 `uploads/dsclaw-knowledge-prototype-*.html` 对齐 ✅
- **登录链路**：已经真的跑起来（admin@dsclaw.local / admin123）

---

## 二、已归档的 15 个 OpenSpec change

按时间先后：

| # | change | PRD 覆盖 | ADR | 备注 |
|---|---|---|---|---|
| 1 | unified-auth | §2 身份/鉴权底座 | 02 | HS256 / JWKS 双栈 |
| 2 | mcp-service | §14 MCP 框架 | — | BookStack MCP 工具 |
| 3 | metadata-catalog-pgvector | §10 资产目录底 | — | pgvector 语义检索 |
| 4 | rbac-access-control | §2 RBAC 决策 | 04 | Q001 token 关闭 HS256 默认 |
| 5 | pdf-pipeline-v2 | §7 PDF 管线 | 07 | opendataloader-pdf + VLM |
| 6 | knowledge-qa | §5-6 问答 | — | SSE 流式 + 引用 |
| 7 | agent-orchestrator | §3 Agent 契约 | 03 | 意图分类 + 分发 |
| 8 | ingest-pipeline-unify | §7 入库统一 | 08 | router → extractor → pipeline |
| 9 | knowledge-governance（G1）| §8-9 治理 | 09 | tags/重复/质量/audit |
| 10 | unified-auth-permissions（G2）| §2.3 permissions | 10 | expandRolesToPermissions |
| 11 | permissions-admin-ui（G3+G4）| §11-13 + §15 | 12 | 规则/用户/矩阵 Tab |
| 12 | assets-and-mcp-ui（G5+G7）| §10 + §14 | 11 | 资产列表+详情+MCP 调试 |
| 13 | ingest-ui-rich（G6）| §7 向导 | 13 | 多文件队列+预览+元数据 |
| 14 | real-login（G9）| §2 真登录 | 14 | scrypt + HS256 sign 零新包 |
| 15 | user-admin（G10 / FU-6）| §15 补 | 15 | PATCH/DELETE/reset-password |

---

## 三、Parked（明天决定要不要推）

### G8 task-knowledge-drawer · PRD §16

**为何 park**：之前按"DSClaw task knowledge drawer"名字推测设计，没细核 `uploads/知识中台产品需求文档.md` §16 原文。

**现状**：
- `openspec/changes/task-knowledge-drawer/` 有 proposal + design + spec + tasks（tasks.md 已明写 PARKED 状态）
- 代码零残留（半截 `routes/knowledgeTask.ts` + index.ts import 已回滚）

**Re-start 前必做**：
1. 读完 `/sessions/hopeful-clever-planck/mnt/uploads/知识中台产品需求文档.md` §16 完整章节
2. 对照 `uploads/dsclaw-knowledge-prototype-*.html` 里 DSClaw 任务详情页的 drawer 触发位置
3. 确认这是"DSClaw 任务详情页内嵌抽屉"还是"知识中台侧的 Task 视图"——两种接入方向设计完全不一样
4. 如果方向跟我当初猜的一致，复用 openspec 里已有的 proposal/design；否则推倒重写

---

## 四、本次开发（2026-04-21）新引入的系统面

### 后端（qa-service）
- `services/passwordHash.ts` —— Node 内置 `crypto.scrypt`
- `auth/signToken.ts` —— HS256 签发（与 verifyToken 对称）
- `routes/auth.ts` —— `/login /logout /register /password /users/:id patch/delete/reset-password`
- `routes/mcpDebug.ts` —— 加 `GET /api/mcp/stats` 返真 PG 统计
- `routes/ingest.ts` —— 加 `GET /api/ingest/recent` 读 audit_log
- `services/pgDb.ts` —— `users` 表 + `ensureDefaultAdmin()` seed
- `auth/enforceAcl.ts` —— 路由级从 `{action:'ADMIN'}` 改 `{requiredPermission:'permission:manage'}`（关键 fix）

### 前端（web）
- `auth/tokenStorage.ts` —— localStorage 封装
- `auth/RequireAuth.tsx` —— 路由守卫
- `auth/ChangePasswordModal.tsx` —— 自助改密
- `api/client.ts` —— 全局 axios 拦截器（monkey-patch `axios.create` 让新实例也带拦截器）
- `knowledge/Login/index.tsx` —— 登录页
- `knowledge/Iam/*` —— 规则/用户/权限矩阵 3 Tab
- `knowledge/Assets/*` —— 列表 + 详情 3 Tab
- `knowledge/Ingest/*` —— 向导 + ZIP Tab
- `knowledge/Mcp/index.tsx` —— 4 KPI + SQL 调试 + Skill 表（真 audit_log 聚合）

---

## 五、UI 还原度完成清单

本次对着 `uploads/dsclaw-knowledge-prototype-7408cb8d.html` 重写了 10 个页的视觉壳。

| 页 | 对齐要点 |
|---|---|
| /overview | page-body + page-title/sub + 右动作按钮 · 4 metric-card + sub 副标 · kc-grid-2 两栏 |
| /search | search-hero 大搜索 + pill 筛选 · split + panel 两栏 · result-item + tag-row · `.hl` 命中词高亮 |
| /spaces | split + panel 两栏（左 TreePane / 右 PreviewPane） |
| /ingest | page-body 壳 · 向导/ZIP 子 Tab 用 pill 风格 |
| /qa | split + chat/chat-log/msg.user/bubble/who/chat-input · 引用用 result-item |
| /governance | kc-subtabs（知识治理/成员/空间/数据权限）胶囊样式 |
| /assets | 搜索卡 + 类型筛选 pill · kc-grid-2 + asset-card/head/ico/name/meta-grid/k/v + status-pill.ok/.proc |
| /assets/:id | topbar-crumb 面包屑 · banner 渐变概览卡 · kc-subtabs 3 Tab |
| /iam | 租户模式 + 授权策略 两张信息卡 · kc-tabs 原型 Tab |
| /mcp | page-body · header 集成连接状态 · kc-grid-4 KPI · 真 audit_log 聚合数据 |

**全局**：
- `KnowledgeTabs` 共享组件升级到 `.kc-tabs/.kc-tab` 原型样式
- `index.css` 从 367 行扩到 620+ 行，foundation class 全覆盖
  - 布局：`page-body/title/sub`、`kc-grid-2/3/4`、`split/panel`
  - Tab：`kc-tabs/kc-tab/kc-subtabs/kc-subtab`
  - 卡：`metric-card/top/label/val/sub`、`asset-card/head/ico/name/k/v/meta-grid`、`banner/title/sub`
  - Pill：`.pill.green/.amber/.red/.blue/.active`
  - Button：`.btn.primary/.ghost/.danger`
  - Chat：`chat/chat-log/msg/bubble/who/chat-input`
  - 其它：`tag-row/tag`、`perm-chip/btn/row/h`、`form-row`、`status-pill/dot`、`list-right`、`icon-btn`、`cat-chip`、`field`、`hl`、`result-item/title/snippet`、`topbar-crumb`、`table`

---

## 六、未覆盖 / 可选后续

### UI 还原度方向
- **/login** 原型对齐 —— 我现在的渐变风格已经能用，但原型有专门的 login 页样式，可顺手对齐
- **knowledge-permission / permission-rule / permission-explain** —— 原型里单独拆的 3 个"数据权限"子页；我的 `/iam` 已覆盖等价功能（规则 CRUD / Simulate / Matrix），只是 UI 分拆方式不同。要拆成独立路由可单独做
- DSClaw 那边的 workbench/experts/skills/automation 等 —— **不在知识中台范围**，原型里有但不归我们管

### 功能方向
- **G8 task-knowledge-drawer**（PRD §16，最后的功能缺口）—— 先读原文再开工
- **端到端权限验证**（编号 VR 项里的手动验证）—— 创 editor/viewer 真用户，跑一遍 RequirePermission + enforceAcl 的 403 路径
- **followup 清单**（从各 tasks.md 的 Followups 小节收敛）：
  - `real-login` FU-2 localStorage → httpOnly cookie
  - `real-login` FU-3 refresh token
  - `real-login` FU-4 账号锁定 / rate limit
  - `real-login` FU-5 密码重置邮件
  - `ingest-ui-rich` FU-2 串行提交 → 并发 worker pool
  - `ingest-ui-rich` FU-3 category 枚举可配置化
  - `real-login` FU-1 login 路由 supertest 测试（需 mock pg pool）

---

## 七、本次修过的关键 bug（怕明天忘）

| 症状 | 根因 | 修法 |
|---|---|---|
| IAM 3 Tab 返 `missing token` | `axios.create()` 产的独立实例不继承默认 interceptor | `api/client.ts` 改模块副作用 + monkey-patch `axios.create`，`main.tsx` 第一行 `import './api/client'` |
| IAM 3 Tab 返 `forbidden` | `/api/acl/*` 挂的 `enforceAcl({action:'ADMIN'})` 走 metadata_acl_rule 表；表空时 deny-by-default | 全改成 `{requiredPermission:'permission:manage'}`，走 permission model（5 处端点同步改） |
| `/assets` 在 DEV 切真登录后 404 | qa-service 没 reload 新路由 | 用户本机 `pnpm dev:down && pnpm dev:up` |
| `api/iam.ts` vite 解析报 `axios has already been declared` | 中段重复 import | 删第二次 import，用顶部的 |
| `vitest run # 全仓单测` 挂 | `#` 后的注释被 pnpm 当成 positional arg 传给 vitest | 命令里别加 shell 注释 |

---

## 八、测试状态（本机 Mac 最新一次）

- **apps/qa-service**：`pnpm --filter qa-service test`
  - 上次跑 3 红 150 绿；我修了这 3 条（`auth.requireAuth` 加 permissions 断言、`intentFallback` 改 CJK 边界 regex、`ingestPipeline.pipeline` fullText 加长过 200 字）
  - **今天还没回归验**：明天先跑一次看是否 153+/153+ 全绿
  - 新增单测：`passwordHash.test.ts`（5 case）+ `signToken.test.ts`（3 case）
- **apps/mcp-service**：11/11 pass
- **apps/web**：vitest 沙箱跑不了（rolldown 原生绑定缺），本机能跑
  - G6 的 `Ingest/index.test.tsx` 已按 Wizard/ZIP Tab 重写，用户报 9/9 全绿

---

## 九、明天第一件事建议

```bash
cd /Users/xinyao/Git/knowledge-platform

# 1) 全仓单测回归（最后 3 条修没）
pnpm -r test

# 2) 起服务（qa-service 今天刚动了 enforceAcl 门 + 加了 /api/mcp/stats 端点；web 只改 UI）
pnpm dev:down && pnpm dev:up

# 3) 浏览器刷一遍 UI 对照原型，每页给我贴差异点
```

之后决定：
- 推 G8（需要先读 PRD §16）
- 或先做 UI 还原度微调（贴图我改）
- 或开始写端到端权限验证测试
