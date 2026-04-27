# 知识中台开发进度快照 · 2026-04-22 收工

> 接 `PROGRESS-SNAPSHOT-2026-04-21.md`。今天的目标是：**入库调通 / 问答调通 / 权限调通**
> + 评审用户上传的"新方案"并把值得借鉴的 4 件事吸收进 roadmap。

---

## 一、今天完成的事

### 1. 端到端权限验证（C 路线）✅
- 写了 `scripts/verify-permissions.mjs`（Node 18+ 自含）
- 写了 `docs/verification/e2e-permissions-matrix.md`（端点 × 角色 期望矩阵 + DEV BYPASS / deny-by-default 两个坑）
- **Group 1 requiredPermission 31/31 PASS**（用户本机跑过）
- **新增**：`apps/qa-service/src/services/pgDb.ts` 加 `ensureDefaultAclRules()` 幂等 seed 4 条兜底规则（all READ + editor/admin WRITE + admin ADMIN），解 deny-by-default 自锁
  - 启动日志会打印 `✓ seed metadata_acl_rule: role=... permission=...`
  - 用户后续可在 IAM 面板覆盖 / 增删

### 2. /ingest 重做 ✅（按原型）
- 4 sub-tab：文件上传 / 网页抓取 / 对话沉淀 / 批量任务
- 右侧统一「入库配置」面板（目标空间 / 标签 / 分段策略 / 向量化 toggle）
- 底部「任务队列」表（处理中 N · 失败 N · 完成 N · 进度条 · 日志/暂停/重试）
- 独立路由 `/ingest/jobs/:id` —— 6 步 stepper + "正在 X" panel + 表格预览 + 日志
- 后端：`services/jobRegistry.ts`（in-memory LRU 200）+ `routes/ingestJobs.ts` + 三个新高层入口（upload-full / fetch-url / conversation）
- 前端测试：`Ingest/index.test.tsx` 烟雾测改写为 4 Tab 覆盖

### 3. 验证脚本 ✅
- `scripts/verify-permissions.mjs`（昨天写的）默认跑全 3 组：requiredPermission + acl-resource + auth-only
- `scripts/verify-ingest.mjs`（新）—— admin 登录 → POST /api/ingest/conversation → 轮询 jobs/:id → 断言 done
- `scripts/verify-qa.mjs`（新）—— admin 登录 → POST /api/qa/ask → 读 SSE → 断言 agent_selected + rag_step + done

### 4. 评审新方案 + 借鉴决策 ✅
- 写了 `docs/verification/proposal-comparison-2026-04-22.md`（13 维度对照）
- 结论：**不切栈**，但**借鉴 4 件事**（详见下方 §四）

### 5. 双 tsc EXIT=0 保持
- `apps/qa-service` `tsc --noEmit` ✅
- `apps/web` `tsc --noEmit` ✅

---

## 二、用户本机 15 分钟跑一圈

```bash
cd /Users/xinyao/Git/knowledge-platform

# 0. 重启服务（pgDb 加了 seed，必须重启让 runPgMigrations 跑一次）
pnpm dev:down && pnpm dev:up
# 启动日志应看到：
#   ✓ seed metadata_acl_rule: role=ANY permission=READ
#   ✓ seed metadata_acl_rule: role=editor permission=WRITE
#   ✓ seed metadata_acl_rule: role=admin permission=WRITE
#   ✓ seed metadata_acl_rule: role=admin permission=ADMIN

# 1. 权限验证全 3 组
node scripts/verify-permissions.mjs --seed     # 幂等：editor/viewer 已存在会 SKIP
node scripts/verify-permissions.mjs            # 期望 N/M 全 PASS（现在 ACL 表已自动 seed）

# 2. 入库验证
node scripts/verify-ingest.mjs                 # 4-5 条断言；fetch-url 可能 SKIP（外网）

# 3. 问答验证
node scripts/verify-qa.mjs                     # 5 条断言；content 可能 SKIP（看 LLM 是否配）

# 4. 浏览器手验
#   /ingest      — 按 docs/verification/ingest-revamp-2026-04-22.md 12 条清单
#   /iam, /governance — admin 进得去，editor/viewer 看到锁屏（前端守卫已就位）
#   /qa          — 真问一个问题，看流式回答 + 引用
```

---

## 三、当前仓库状态

- **TS 编译**：双 `tsc --noEmit` EXIT=0 ✅
- **OpenSpec change 归档**：15 个全归档（昨天的）
- **ADR**：01 ~ 15（昨天的）+ 待新增（见 §四）
- **PRD 功能覆盖**：§2 / §5-6 / §7 / §8-9 / §10 / §11-13 / §14 / §15 全部落地；§16 (G8) 仍 PARKED
- **新文件清单**（今天）：
  ```
  apps/qa-service/src/services/jobRegistry.ts        新
  apps/qa-service/src/routes/ingestJobs.ts           新
  apps/qa-service/src/routes/ingest.ts               改 (+ upload-full/fetch-url/conversation)
  apps/qa-service/src/index.ts                       改 (挂 ingestJobsRouter)
  apps/qa-service/src/services/pgDb.ts               改 (+ ensureDefaultAclRules)

  apps/web/src/api/ingest.ts                         改 (+ 7 个新方法)
  apps/web/src/knowledge/Ingest/IngestConfigPanel.tsx 新
  apps/web/src/knowledge/Ingest/JobQueue.tsx          新
  apps/web/src/knowledge/Ingest/EmptyState.tsx        新
  apps/web/src/knowledge/Ingest/UploadTab.tsx         新
  apps/web/src/knowledge/Ingest/FetchUrlTab.tsx       新
  apps/web/src/knowledge/Ingest/ConversationTab.tsx   新
  apps/web/src/knowledge/Ingest/BatchTab.tsx          新
  apps/web/src/knowledge/Ingest/index.tsx             重写 (4 Tab + 配置 + 队列)
  apps/web/src/knowledge/Ingest/index.test.tsx        重写 (4 Tab 烟雾)
  apps/web/src/knowledge/IngestJob/index.tsx          新 (/ingest/jobs/:id)
  apps/web/src/App.tsx                                改 (加路由)

  scripts/verify-permissions.mjs                     新（昨天）
  scripts/verify-ingest.mjs                          新
  scripts/verify-qa.mjs                              新

  docs/verification/README.md                        新
  docs/verification/e2e-permissions-matrix.md        新
  docs/verification/ingest-revamp-2026-04-22.md      新
  docs/verification/proposal-comparison-2026-04-22.md 新
  ```

---

## 四、新方案借鉴决策 → 进 Roadmap

完整对照见 `docs/verification/proposal-comparison-2026-04-22.md`。
**结论：不切栈，借鉴 4 件事。** 以下排进 Roadmap，按优先级：

### Roadmap-1 · 加 Langfuse trace（高优 · 1 天）
- **痛点**：当前调 RAG/prompt 没有调用链可看，调优全靠日志
- **做法**：
  1. `pnpm add langfuse` 到 qa-service
  2. `services/ragPipeline.ts` 起 trace span：retrieval / rerank / generate
  3. `services/llm.ts` wrap LLM 调用，自动 attach 到 trace
  4. 自托管：起 1 个 docker（Langfuse + Postgres）；本地走 `LANGFUSE_HOST=http://localhost:3000`
- **验收**：浏览 Langfuse UI 看到 /api/qa/ask 一次完整 trace（含 retrieve/rerank/llm 各步耗时与 token）
- **OpenSpec change**: `obs-langfuse-trace`

### Roadmap-2 · Ragas 评测集（高优 · 3-5 天）
- **痛点**：当前没法量化 RAG 调优效果（chunk size / top_k / prompt）
- **做法**：
  1. **W1**：跟业务方收集 50 条真实问答对（question + ground_truth + 期望召回的 doc）→ `eval/golden-set.jsonl`
  2. **W1.5**：写 `scripts/eval-ragas.py`（Python 单文件，调本地 RAG endpoint）
     - 指标：Faithfulness / Answer Relevancy / Context Precision / Context Recall
  3. **W2**：CI 加一个 weekly job 跑 eval → 写报告到 `docs/eval/YYYY-MM-DD.md`
  4. **W2**：A/B 框架（baseline vs current），后端加 `?ab=<name>` 参数走不同 prompt
- **验收**：能跑出 Faithfulness ≥ 0.80, Answer Relevancy ≥ 0.85（PRD 隐含目标）
- **OpenSpec change**: `eval-ragas-pipeline`

### Roadmap-3 · Schema 加 tenant_id 一等公民（中优 · 1.5 天）
- **痛点**：当前没多租户概念；如果未来要给多业务方共享，迁移代价大
- **做法**：
  1. PG migration：`metadata_source / metadata_asset / metadata_field / metadata_acl_rule / users` 都加 `tenant_id VARCHAR(64) DEFAULT 'default' NOT NULL` + 索引
  2. requireAuth 解 token 时把 `tenant_id` 注入 principal（默认 'default'）
  3. evaluateAcl + 所有 SELECT 加 `WHERE tenant_id = $1`
  4. 前端 IAM 加 tenant 选择 placeholder（V1 只显示 default，无切换 UI）
  5. ADR 写一条说明"为什么现在加但不暴露"
- **验收**：所有现有功能照常工作；新加 ACL 规则带 tenant_id；migration 在已有数据上幂等
- **OpenSpec change**: `multi-tenant-schema-foundation`

### Roadmap-4 · jobRegistry 持久化（中优 · 1 天）
- **痛点**：今天加的 in-memory 任务表进程重启清空；用户看到的"已完成"会消失
- **做法**：
  1. PG migration：建 `ingest_job` 表（id UUID PK, kind, name, space, source_id, tags JSONB, strategy, vectorize, phase, progress, started_at, updated_at, finished_at, error, asset_id, chunk_count, log JSONB, preview JSONB）
  2. `services/jobRegistry.ts` 改写：所有 create/update/finish/fail 都先 PG，cache in Map 当读优化
  3. `listJobs` 走 PG 查询（按 updated_at desc）
- **验收**：重启 qa-service 后 /api/ingest/jobs 仍能列出昨天的任务；UI 任务队列不丢
- **OpenSpec change**: `ingest-jobs-persistent`

---

## 五、归档：值得长期参考的新方案产物

放进 `docs/superpowers/specs/external-references/knowledge-platform-fastapi/`（未来公司扩张时拿出来）：
- `01_project_plan.md` 14 周节奏（参考排期格式）
- `02_architecture.md` 13 层架构图（"权限过滤黄金法则"那段值得抄进 ADR）
- `03_tech_stack.md` 36 个组件 + License 表（选型字典）
- `schema/init.sql` 多租户 schema（Roadmap-3 抄这个）
- `deploy/docker-compose.yml` 全栈 14 服务（公司级部署蓝图）
- `tasks/jira_import.csv` 14 周任务拆解（参考拆任务方式）

> **明确**：不在本仓库重新实现这套；只是文档归档供未来参考。

---

## 六、明天第一件事建议

按这个顺序走，把今天的 verify 脚本结果落地：

1. `pnpm dev:down && pnpm dev:up` 重启拿 ACL seed
2. 跑 3 个 verify 脚本，把输出贴回来
3. 浏览器过 /ingest 12 条手验清单（见 `docs/verification/ingest-revamp-2026-04-22.md`）
4. 决定 Roadmap-1（Langfuse）和 Roadmap-2（Ragas）的启动时机；其它两个等 follow

如果 verify 全 PASS，今天的"入库 / 问答 / 权限调通"算正式收尾，可以开 commit。

---

## 八、Permissions V2 · 用户权限 / 知识库权限（晚场） ✅

> 用户原话："你开始做吧，我现在要开始解决权限的问题，用户权限，知识库权限"
> 选型：C（团队/用户/角色 三类主体） + G（source / asset / notebook 三层 ACL） + Spec 先行

### 设计要点
- **主体维度**：`subject_type ∈ {role, user, team}` + `subject_id`（含通配 `*`）；`role` 字段保留向下兼容
- **效果**：`effect ∈ {allow, deny}`，**deny 优先**；同时支持 `expires_at` TTL
- **资源维度**：`source_id` / `asset_id`（asset 隐式继承所属 source 的 ACL）
- **种子模式**：采纳推荐方案 B（**严格种子**）—— 默认不再给 `* READ`，只给 `admin` 全权；其它角色明确授权后才能进
- **团队模型**：新建 `team` + `team_member` 两表；`requireAuth` 加载用户的 team_ids 注入 principal
- **Notebook 共享**：新建 `notebook_member`（subject_type/subject_id/role），accessibility = owner ∪ user 直授 ∪ 团队授

### 后端落地
```
apps/qa-service/src/services/pgDb.ts        改 (V2 schema + 严格 seed)
apps/qa-service/src/auth/types.ts           改 (Principal 加 team_ids/team_names；AclRuleRow 加 V2 字段)
apps/qa-service/src/auth/requireAuth.ts     改 (loadUserTeams 注入 principal)
apps/qa-service/src/auth/evaluateAcl.ts     改 (subjectMatches + notExpired + deny 最高优)
apps/qa-service/src/routes/teams.ts         新 (CRUD + members；挂 /api/iam/teams)
apps/qa-service/src/routes/acl.ts           改 (rules CRUD 接收/校验 V2 字段)
apps/qa-service/src/routes/notebooks.ts     改 (loadAccessibleNotebook + members 端点；
                                             GET / 返回 {items, shared})
apps/qa-service/src/index.ts                改 (mount teamsRouter)
```

### 前端落地
```
apps/web/vite.config.ts                                改 (+ /api/iam 代理)
apps/web/src/api/teams.ts                              新 (TeamSummary/TeamMember + CRUD)
apps/web/src/api/notebooks.ts                          改 (NotebookMember + listMembers/addMember/removeMember + access?)
apps/web/src/api/iam.ts                                改 (AclRule 加 subject_type/subject_id/effect/expires_at)
apps/web/src/knowledge/Iam/index.tsx                   改 (4 Tab：用户/团队/规则/矩阵；默认 users)
apps/web/src/knowledge/Iam/TeamsTab.tsx                新 (列表 / 创建 / 展开看成员 / 加移除成员)
apps/web/src/knowledge/Iam/RulesTab.tsx                改 (主体类型选择器 + team 下拉 + effect + expires_at)
apps/web/src/knowledge/Notebooks/index.tsx             改 (我的 / 共享给我的 两区段；access 徽标)
apps/web/src/knowledge/Notebooks/Detail.tsx            改 (共享按钮 + ShareModal)
apps/web/src/knowledge/Notebooks/ShareModal.tsx        新 (列成员 + 添加 user/team 成员 + 角色)
```

### 双 tsc 验证
- `apps/web` `tsc --noEmit` ✅ EXIT=0
- `apps/qa-service` `tsc --noEmit` ✅ EXIT=0

### 用户本机 follow-up
1. **重启服务**（schema 变化）：`pnpm dev:down && pnpm dev:up`
   - 启动日志会跑 V2 migration（team / team_member / notebook_member / metadata_acl_rule ALTER）
   - 严格种子：旧的 `* READ` 不再下发；如需 viewer/editor 还能读，要在 IAM Rules Tab 手动加规则
2. **浏览器手验**：
   - `/iam?tab=teams` 新建一个团队 → 加成员
   - `/iam?tab=rules` 新建规则时主体可选 user/team
   - `/notebooks` 进一个 notebook → 「共享」按钮 → 邀请用户/团队
   - 切到该用户/团队成员账号登录 → 应该在「共享给我的」看到这个 notebook
3. **回滚开关**：如果严格种子误锁，临时把 `ensureDefaultAclRules` 加一条 `subject_type=role, subject_id=*, permission=READ`

### 已知 follow-up（V1.5）
- 源（Spaces）/ 资产页直接挂"权限"抽屉（当前必须去 /iam 加规则）
- 自定义角色（custom role）— V2 扩
- 团队层级（团队嵌套团队）— 现在只支持扁平
- 审计日志（谁在何时改了哪条规则）

---

## 七、未解 / Park

| 项 | 状态 | 备注 |
|---|---|---|
| G8 task-knowledge-drawer (PRD §16) | 🅿 PARKED | 还没读 PRD §16 原文 |
| Roadmap-1 Langfuse | 待启动 | 1 天工作量 |
| Roadmap-2 Ragas | 待启动 | 3-5 天，先收集 golden set |
| Roadmap-3 tenant_id | 待启动 | 1.5 天 |
| Roadmap-4 jobs 持久化 | 待启动 | 1 天 |
| /ingest 暂停/重试真实语义 | followup | 当前是 UI 标记，pipeline 同步执行 |
| /api/mcp/* + /api/graph/cypher 加 permission:manage 门 | followup VR-1 | 现在 viewer 也能拉 SQL debug |
| governance/* 从 action+resource 迁到 requiredPermission | followup VR-2 | 消 deny-by-default 风险（虽然 seed 后不会触发） |
| FU-1 ~ FU-5（昨天列的 follow-ups） | 待开 | 见 PROGRESS-SNAPSHOT-2026-04-21.md §六 |
