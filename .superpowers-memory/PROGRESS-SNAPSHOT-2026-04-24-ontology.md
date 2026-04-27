# Progress Snapshot · 2026-04-24 Ontology 三件套

> 今日主线：基于 PolarDB-PG Ontology 文章的 **OAG + Skill + Action** 三件套，走完 **D（锁契约）→ B（并行执行）** 两轮。3 个 OpenSpec change 从零契约到代码实现 + tsc 清 + 前端 Governance UI 就绪。

## 一、D 流程 · 契约锁定 ✅

选型：工作流 D `openspec-feature-workflow`（仅产契约不写码）。

契约路径：

- `openspec/changes/ontology-oag-retrieval/{proposal,design,tasks}.md + specs/ontology-context-spec.md`
- `openspec/changes/ontology-declarative-skills/{proposal,design,tasks}.md + specs/skill-loader-spec.md`
- `openspec/changes/ontology-action-framework/{proposal,design,tasks}.md + specs/action-engine-spec.md`
- Explore 草稿：`docs/superpowers/specs/ontology/explore.md`

三项关键对齐：
- **节点模型复用**：不新增业务对象节点（不做 Customer/Device），沿用 ADR-27 的 5 节点 5 边
- **Skill 落地点**：扩展 `apps/mcp-service`，不新建服务
- **权限模型复用**：走 Permissions V2 `evaluateAcl`，不引入 ACR 新表

## 二、B 流程 · 并行执行 ✅（代码层）

选型：工作流 B `superpowers-openspec-execution-workflow`，**3 个 change 并行开工**。

### 原计划 vs 实际隔离策略

原计划 git worktree 三路隔离。沙箱挂载 `mnt/` 对 git lock 文件 "Operation not permitted"，git init 无法完成。**改用文件所有权隔离**：3 个 agent 各自负责互不重叠的文件集，共享的 `index.ts` / `auth/types.ts` 由我在集成阶段亲自合并。效果等价。

### 各 change 交付

**ontology-oag-retrieval**（ADR-33）
- 新增：`services/ontologyContext.ts` / `routes/ontology.ts` + 9 个 test scenario
- 修改：`services/ragPipeline.ts` / `ragTypes.ts` / `agent/agents/KnowledgeQaAgent.ts` / `__tests__/ragPipeline.test.ts`
- OAG 空结果时 `gradeDocs` prompt 与旧版字节一致（regression-safe）

**ontology-declarative-skills**（ADR-34）
- 新增：`src/skillLoader.ts` / `skills/_lib/backendProxy.ts` / `scripts/build-schema.ts` + 8 个 skill（2 legacy + 6 new）
- 修改：`src/server.ts` → async；`mcp-schema.json` 改为 build 产物
- Legacy 两工具名字、I/O 字节级兼容
- 沙箱无 pnpm install → `js-yaml` 用 symlink；`globby` 未用已移除依赖

**ontology-action-framework**（ADR-35）
- 新增：`services/actionEngine.ts / actionWebhook.ts / actionPreconditions.ts`、`routes/actions.ts`、5 个内置 Action、migration 内联到 `pgDb.ts`
- 前端：`apps/web/src/knowledge/Governance/Actions/` 四个组件 + `api/actions.ts`
- 修改：`auth/types.ts` 加 `action_name?` / `action_run_id?` / `AclAction: 'EXECUTE'`（加法修改）
- 修复 17 个初始 tsc 错误（handler 泛型 / await / string 强转 / webhook 窄化）

### 集成层修改（我自己做的）

1. `apps/qa-service/src/index.ts` 追加 `ontologyRouter` import + `/api/ontology` mount（Action 那边 agent 已 "顺手" 把自己的 mount 加了，索性保留）
2. `apps/qa-service/src/services/pgDb.ts:runPgMigrations` 内联 Action 三表迁移（项目不是文件式 migration，那份 `migrations/001-action-framework.sql` 孤文件会被忽略）
3. `apps/mcp-service/node_modules/js-yaml` symlink → `node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml`
4. `apps/qa-service/node_modules/ajv` symlink → `node_modules/.pnpm/ajv@8.18.0/node_modules/ajv`
5. `apps/mcp-service/package.json` 删除未用的 `globby` 依赖
6. `.gitignore` 扩展：`infra/{bookstack,mysql,pg,kg}_data/` + `.env*` 等运行时目录

## 三、验证

### 沙箱内完成
- `npx tsc --noEmit` 三包（qa-service / mcp-service / web）**全绿**
- 文件结构 / import 路径 / 类型签名一致性检查通过

### 用户本机 Mac 验证（2026-04-24 11:21）✅

| 闸门 | 结果 |
|---|---|
| `pnpm install` | OK（先修 `@marsaud/smb2` 版本声明 `^0.19.0 → ^0.18.0` 的老笔误） |
| `pnpm -r exec tsc --noEmit` | 三包清 |
| `pnpm --filter mcp-service test` | **8 文件 / 42 tests 全绿**（2.12s） |
| `pnpm --filter qa-service test` | **50 文件 / 308 tests 全绿**（13.46s） |

### 用户本机验证过程中集中修掉的 5 条小 bug

1. **skillLoader 参数类型**：MCP SDK 1.29 `server.tool()` 要 Zod `ZodRawShape`，Skills agent 直接塞 JSON Schema 炸 "expected a Zod schema"。加了 `jsonSchemaObjectToZodShape` / `jsonSchemaToZod` 两个小转换器（递归支持 string/number/integer/boolean/object/array/enum/default/description，其它 type 降级 `z.any()`）。
2. **skillLoader test 私有字段名**：SDK 1.29 把 `_tools` 改 `_registeredTools` 且从数组改成对象。改用 `Object.keys(registered)` 做长度断言。
3. **ontologyContext 超时 race 失效**：原实现把 signal 传给下游，但 mock 下 runCypher 不听信号，整体等 500ms 才回。加了 `raceAbort(work)` helper 把 work 和 abort 事件 race，哨兵 `null` 走 fallback 分支。
4. **ragPipeline.test.ts 默认 mock**：`trace has new asset_* shape` 老测试触发 ragPipeline 跑到 OAG 调用点时拿到 `undefined.entities` 炸。顶层加 `mockExpandOntologyContext.mockResolvedValue({...})` 给所有不显式设置 ontology 的 case 兜底（`clearAllMocks` 不清 implementation）。
5. **Pre-existing 测试漂移顺手修**：
   - `ingestPipeline.pipeline.test.ts` regex `/UPDATE metadata_asset SET indexed_at/` 改 `\s+` 适配 SQL 多行写法
   - `knowledgeDocs.test.ts` DELETE 测试按 ADR-30 加固后的路由补 `vi.mock('../auth/index.ts', ...)` 透传 requireAuth/enforceAcl + 多补 2 次 `mockResolvedValueOnce`（pre-SELECT + audit）

### 建议后续自行跑的冒烟（非强制）
- `pnpm dev:up` 起全栈后：F12 看 `ontology_context` SSE 事件；前端 `/governance` 新 "操作与审批" tab 可见；`revoke_acl_rule` curl 进 pending → admin approve → succeeded
- `pnpm eval-recall` 对比 OAG 前后的 RAG recall，确认无 regression

### 用户本地验证 checklist（建议顺序）

```bash
# 1. 重新装 native 依赖（此步很关键，沙箱动不了）
pnpm install

# 2. tsc 三包（应该直接过）
pnpm -r exec tsc --noEmit

# 3. 跑单测
pnpm -r test
# 预期新增 case：
#  - qa-service: ontologyContext(9) + ragPipeline(+3) + actionEngine.state(多) + preconditions + webhook + routes/actions + 5 action handlers
#  - mcp-service: skillLoader(14) + skills/** 每 skill 一个 I/O 测试（legacy 迁移 + 6 new）

# 4. 起服务
pnpm dev:up
# 4a. 查 `.dev-logs/qa-service.log` 应看到：
#   ✓ Apache AGE graph ready: knowledge
#   ✓ ACL rules loaded: N
#   ✓ QA service → http://localhost:3001
#   （新）action bootstrap: registered 5 actions
#   （新）ontology context API ready

# 5. MCP schema drift check
pnpm --filter mcp-service schema:check

# 6. 端到端 smoke（浏览器）
# 6a. http://localhost:5173 正常登录
# 6b. 发起一次知识问答，F12 看 SSE 流应出现 `ontology_context` event
# 6c. http://localhost:5173/governance 新 "操作与审批" tab 可见
# 6d. 以 admin 身份 `curl -X POST http://localhost:3001/api/actions/online_asset/run \
#        -H 'Authorization: Bearer $JWT' -d '{"args":{"asset_id":"a1"}}'`
#     → 200 + run_id，state=approved（low risk 自动跳过审批）
# 6e. 同 curl 打 `revoke_acl_rule` → state=pending，到前端审批队列 approve 后才执行

# 7. eval-recall（可选，确保 RAG 没 regression）
pnpm eval-recall
```

## 四、新增环境变量

```bash
# 写到 infra/.env 或 apps/qa-service/.env
ACTION_WEBHOOK_ALLOWLIST=https://ci.example.com,https://incident.example.com
ACTION_WEBHOOK_SECRET=<openssl rand -hex 32>

# mcp-service 调 qa-service 时使用
QA_SERVICE_URL=http://localhost:3001
QA_SERVICE_SKILL_TOKEN=<服务账号 JWT>   # 仅 auth.forward=false 的 skill 用
```

## 五、未决（open questions）

沉淀到 `.superpowers-memory/open-questions.md`：

- **OQ-ONT-1** 业务对象节点（Customer/Device）的引入触发阈值
- **OQ-ONT-2** ACR-aware Cypher traversal 的 ROI 评估
- **OQ-ONT-3** `compose` 类 Skill（pipeline-of-skills）是否进入平台范围
- **OQ-ONT-4** Action `executing` 状态的真实中断机制（MVP 只设 `cancel_requested` 旗标）
- **OQ-ONT-5** Action handler `rebuild_asset_index` / `rebuild_kg_from_asset` 与现有 ingest / knowledgeGraph pipeline 的深度集成（MVP 返回 mock 值）

## 六、归档状态 ✅

按 CLAUDE.md 约定，验证通过后归档：

- `docs/superpowers/archive/ontology-oag-retrieval/{proposal,design,tasks}.md + specs/ + ARCHIVED.md`
- `docs/superpowers/archive/ontology-declarative-skills/{proposal,design,tasks}.md + specs/ + ARCHIVED.md`
- `docs/superpowers/archive/ontology-action-framework/{proposal,design,tasks}.md + specs/ + ARCHIVED.md`

`openspec/changes/ontology-*/` 保留作为活契约（被下游消费），三份 `tasks.md` 的复选框全部勾选完成。

## 七、ADR 索引

- `.superpowers-memory/decisions/2026-04-24-33-ontology-oag-retrieval.md`
- `.superpowers-memory/decisions/2026-04-24-34-ontology-declarative-skills.md`
- `.superpowers-memory/decisions/2026-04-24-35-ontology-action-framework.md`
- `.superpowers-memory/decisions/2026-04-24-36-eval-golden-set-realign.md`（C 流程 follow-up）
- `.superpowers-memory/decisions/2026-04-24-37-ts-strip-types-discipline.md`（工程纪律：qa-service dev runner 的 TS 禁用清单 + reviewer egrep）
- `.superpowers-memory/decisions/2026-04-24-38-governance-actions-list-wire.md`（C 流程 follow-up：`GET /api/actions/runs` + Governance UI 真接数据）

---

## 八、Follow-up · eval-golden-set-realign（C 流程）

跑完 ontology 验证后的 `eval-recall` 出现 0/37 命中，经 DB 直查锁定为 golden set `expected_asset_ids:[3]` 是 chunks=0 的僵尸记录，真身在 `id=5`。**不是 OAG 回归**。

### 诊断依据

`metadata_asset` 当前状态（用户 2026-04-24 截图）：

| id | name | chunks |
|---|---|---|
| 1 | LFTGATE-3 Liftgate_Liftglass gas strut guidelines 19Oct2018.pdf | 146 |
| 2 | Bumper Integration BP rev 11.pdf | 233 |
| 3 | LFTGATE-32_..._Rev.pdf | 0（僵尸） |
| 5 | LFTGATE-32_..._Rev.pdf | 1084（重 ingest 真身） |

### 交付

走 workflow C（无 OpenSpec）：

- 设计：`docs/superpowers/specs/eval-golden-set-realign-design.md`
- 计划：`docs/superpowers/plans/eval-golden-set-realign-impl-plan.md`
- ADR：`decisions/2026-04-24-36-eval-golden-set-realign.md`
- 数据修复：`eval/gm-liftgate32-{v2,v3-annotated,v4-judge}.jsonl` 各 37 处 `[3]` → `[5]`（`gm-liftgate32-only.jsonl` 是另一个 DB 快照 id=35，不动）
- 工具：`scripts/find-zombie-assets.mjs`（`chunks=0` 资产列表；`--delete` 走 ADR-30 的带 audit DELETE；`--json` 给 CI）
- 未决沉淀：`open-questions.md` 新增 OQ-EVAL-1（eval-recall 是否加 PG preflight）

### 验证结果（用户本机 Mac · 2026-04-24，golden set 修正 + 僵尸 id=3 已删 + qa-service 重启后）

```
node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl
```

| 指标 | 值 |
|---|---|
| 平均 recall@1 | **0.973** （36/37 首位命中） |
| 平均 recall@3 | **1.000** |
| 平均 recall@5 | **1.000** |
| 平均首命中 rank | 1.1 |
| top-5 未命中 | **0 题** |

**结论**：OAG 三件套上线**零回归**实锤。recall@5 触顶，召回链路质量没被 OAG 的 prompt 扩展影响。

**唯一 recall@1 miss 的 Q70**（"SSTS 代表什么？"）首命中在 #3，前两个被 LFTGATE-3 / Bumper PDF 的 chunk 抢位 —— 是 baseline RAG 在缩写匹配上的固有弱项（无语境的纯缩写易被无关 doc 干扰），跟 OAG 无关，OAG 是 rerank 之后才介入的。

### 顺手发现

`scripts/find-zombie-assets.mjs` 跑出来还有第二个小修：原本 `import pg from 'pg'` 在仓库根触发 `ERR_MODULE_NOT_FOUND`（pnpm 没把 pg 提升到根 node_modules），改用 `createRequire` 锚定到 `apps/qa-service/package.json` 后修好。同样的坑在 `scripts/cleanup-bad-chunks-ocr.mjs` 也存在，未本次处理（OQ 暂不开新条目，下次重写它的人顺便修）。

`apps/qa-service` 的 dev runner 是 `node --experimental-strip-types`，启动时被 ActionFatalError 的 `constructor(public code: string, ...)` 触发 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。strip-types 不支持 TS parameter property / enum / namespace / 装饰器。已修；建议把这条工程纪律写进 glossary（用户决策中）。

### 完整归档

本 C 流程交付不涉及 OpenSpec 契约，按 CLAUDE.md §"C `superpowers-feature-workflow`" 约定无需归档到 `docs/superpowers/archive/`；所有产物保留在 `specs/` + `plans/` 原位即为最终状态。
