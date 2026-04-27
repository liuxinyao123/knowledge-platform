# Open Questions

> 列出当前仍未收敛的跨团队问题。每项必须有 **Owner**、**等待事件**、**影响的工作流** 与 **建议解决路径**。
> 解决后迁移到 `decisions/` 里做 ADR，然后从本表移除。

---

## 已关闭

| Q-ID | 关闭 ADR | 结论 |
|---|---|---|
| Q-001 RBAC Token 走 OIDC？ | `decisions/2026-04-21-04-q001-rbac-token-closes-hs256-default.md` | Phase 1 = HS256；Phase 2（需要 SSO 时）切 OIDC |
| Q-002 pgvector vs MySQL 对齐 | `decisions/2026-04-21-05-q002-pgvector-source-of-truth-confirmed.md` | pgvector = 检索真相；MySQL 只承担治理表 |
| Q-003 审批队列复用 Mission Control | `decisions/2026-04-21-06-q003-approval-queue-deferred.md` | 暂缓立项；触发后走工作流 C |
| OQ-INGEST-1 Ingest 同步→异步 | `decisions/2026-04-24-40-ingest-async-pipeline.md` | DB 状态机 + in-proc worker · Phase A/B/C 2026-04-24 完成 · 323/323 tests 绿 |
| OQ-WEB-TEST-DEBT web 测试 18 失败 | `decisions/2026-04-25-43-web-test-debt-cleanup.md` | 全局 axios stub + 5 文件 mock/选择器修复 · 2026-04-25 完成 · 114/114 全绿 |
| llm_wiki 图谱洞察接入 | `decisions/2026-04-25-41-graph-insights.md` | 工作流 B · /insights 路由 · 四类洞察 + Deep Research 复用 runRagPipeline · Phase A–K 完成 |
| llm_wiki 知识图谱视图接入 | `decisions/2026-04-25-42-knowledge-graph-view.md` | 工作流 B · /knowledge-graph 路由 · sigma.js + ForceAtlas2 + Asset.type 着色 + hover 高亮 · Phase A–G 完成 |

---

## 当前未决

### OQ-ONT-1 — 业务对象节点（Customer/Device/Order）的引入触发阈值
- **Owner**：架构 owner
- **等待事件**：出现真实需要跨域推理的业务场景（例如"客户 × 订单 × 设备"）
- **影响工作流**：未来可能新开 A 流程的 change
- **建议解决路径**：本期刻意只复用 Asset/Source/Space/Tag/Question 5 类节点。加新类要同时评估：1) AGE schema 扩展成本；2) OAG 跳数上限是否还够；3) 是否引入 ObjectType 元表

### OQ-ONT-2 — ACR-aware Cypher traversal 的 ROI
- **Owner**：RAG owner
- **等待事件**：top-K 超过 30，或 `expandOntologyContext` p95 超 300ms
- **影响工作流**：`ontology-oag-retrieval` 的后续 change
- **建议解决路径**：现在走 `evaluateAcl` 批量调用（16 并发），top-K=15 p95 够用。若负载上来，把 ACL 过滤谓词内嵌 Cypher，需要先重做 V2 规则的 Cypher 可表达性

### OQ-ONT-3 — `compose` 类 Skill（pipeline-of-skills）
- **Owner**：Agent/MCP owner
- **等待事件**：出现"一个用户请求需要串多个 skill"的真实场景
- **影响工作流**：`ontology-declarative-skills` 后续 change
- **建议解决路径**：当前 `backend.kind=compose` 占位抛 `SkillComposeNotImplementedError`。加实现时考虑：1) 用 YAML 声明 step / input 映射；2) 是否允许分支（if/else）—— 不允许则简单，允许则成 DSL

### OQ-ONT-4 — Action `executing` 状态的真实中断机制
- **Owner**：Action framework owner
- **等待事件**：第一个长跑 Action（比如大文件 `rebuild_asset_index`）被用户 cancel
- **影响工作流**：`ontology-action-framework` v1.1
- **建议解决路径**：MVP 只在 `action_run.cancel_requested` 置 flag。真实中断需要 handler 周期轮询 `ctx.cancelRequested`，或走 AbortSignal

### OQ-EVAL-1 — eval-recall.mjs 是否加 PG preflight
- **Owner**：Eval owner
- **等待事件**：再次出现 eval 0 命中，人工排查又定位到"ID 漂移"而非 RAG 退化
- **影响工作流**：未来的 workflow C（或 B，取决于是否要动 HTTP API）
- **建议解决路径**：给 `eval-recall.mjs` 加可选 `--preflight` flag，跑前直连 PG 检查每条题目的 `expected_asset_ids` 是否在 `metadata_field` 表里有 chunks；有漂移直接友好报错指向 `find-zombie-assets.mjs`。注意不要把 PG 直连做成强依赖 —— 脚本原本走 HTTP 是为了在外部环境/生产只读账号也能跑

### OQ-ONT-5 — Action handler 与 ingest / KG pipeline 的深度集成
- **Owner**：Action framework owner + ingest owner
- **等待事件**：首个 `rebuild_asset_index` 在生产触发
- **影响工作流**：`ontology-action-framework` v1.1
- **建议解决路径**：当前 `rebuild_asset_index` / `rebuild_kg_from_asset` 返回 mock；要调现有 `services/ingestPipeline` 和 `services/knowledgeGraph` 的公开入口，可能需要把现有 fire-and-forget 路径改成可等待的

### OQ-AGENT-1 — `KnowledgeQaAgent` 升级 ReACT 多轮循环的启动时机
- **Owner**：Agent/RAG owner
- **等待事件（原）**：OAG Phase 1 合并上线、eval 基线产出；真实用户反馈中"多源合成 / 多跳推理"场景占比 ≥ 20%
- **等待事件（修订 2026-04-24）**：~~占比 ≥ 20%~~ 量化门槛在开发期项目**不可用**——AGE 里 Question 节点总数 = 0（脚本 `analyse-qa-multihop.mjs` 首次观测），eval-recall 只走检索不触发 `recordCitations`，没有真实用户流量可测。**改为**：① 项目积累 ≥ 3 个月生产流量，或 ② eval set 扩入 ≥ 20 道显式多跳题且当前 pipeline 在这些题上 groundedness < 70%。任一满足即启动。
- **影响工作流**：工作流 A 或 B —— 改 `KnowledgeQaAgent` 内部实现，可能涉及 SSE 事件协议扩展
- **建议解决路径**：参考 WeKnora 的 ReACT AgentEngine。具体：
  1. `KnowledgeQaAgent.run` 从"一行 runRagPipeline"升级成 tool-call 循环：LLM 决定每轮调 `searchKnowledge` / `queryGraph` / `rewriteQuestion` / `answer`；
  2. 环境变量上限：`AGENT_MAX_ITERATIONS`（默认 5）、`AGENT_MAX_REFLECTIONS`（默认 2）；
  3. 并行工具调用：同轮多工具 `Promise.all`；
  4. 新 SSE 事件 `tool_call_started` / `tool_call_finished`，和现有 `rag_step` 同通道；
  5. Dispatch 层（`agent/dispatchHandler.ts`）不变——"意图路由"和"推理引擎"是两层。
- **关键前置**：OAG Phase 1 eval 数据要能说明"可解释性是不是瓶颈"，不然冒然上 ReACT 会放大 LLM 成本与 latency。
- **来源**：ADR-39 D-001 / D-004

### OQ-GI-FUTURE-1 — graph-insights 跨 Space 全局视图（Admin）的触发条件
- **Owner**：graph-insights owner
- **等待事件**：管理员明确反馈"想一眼看到全组织的孤立资产"，或多 Space 数量 ≥ 10 后跨域桥接节点开始有讨论价值
- **影响工作流**：未来工作流 C（仅 UI 加全局视图）或 B（如需新表 `metadata_graph_insight_global_cache`）
- **建议解决路径**：
  1. v1 严格按 Space 分片（防 ACL 泄露）。要扩到全局，先确定**谁能看**：仅全局 admin？还是任何 Space owner 都能看自己 owns 的所有 Space 汇总？
  2. 实现层面：路由层增 `GET /api/insights/global`（admin only）；服务层把 `getInsights` 改成接受 `spaceIds: number[]` 列表，单独路径并发拉子图、合并 stats、分别算洞察后聚合；
  3. 缓存：单独的 `metadata_graph_insight_global_cache (admin_email, ...)` 或复用现表用 `space_id=0` 哨兵（前者干净后者省表）；
  4. **禁止**直接 union 多 Space 的 cache.payload —— Louvain 是按子图算的，跨 Space 合并社区 ID 会撞号。
- **来源**：ADR-41 D-008 已知缺陷

### OQ-GI-FUTURE-2 — graph-insights 下钻到 Notebook 级
- **Owner**：graph-insights owner + Notebook owner
- **等待事件**：Notebook 用户反馈"我的 Notebook 内有些资产没人理"或"我想看 Notebook 内部的桥接资产"
- **影响工作流**：工作流 B（要扩 loader.ts 支持以 notebook_id 过滤 + 新 `/api/insights?notebookId=N`）
- **建议解决路径**：
  1. Notebook 是 Space 子集（`notebook_source.notebook_id × asset_id`）。loader 里加分支：若传 notebookId，先查 `notebook_source.asset_id` 集合，再用它过滤 AGE 子图；
  2. ACL：复用 `notebook_member.subject_type/subject_id` 现有规则（ADR-permissions-v2）；
  3. 缓存键：`(scope_type, scope_id)` 二元组（`scope_type ∈ {'space','notebook'}`），表结构稍调；
  4. 注意 Louvain 可能在 ≤10 节点的 Notebook 上无意义，需小图降级；
  5. **不要**让 Notebook 视图比 Space 视图先上线——会反噬"Space 是一级实体"的 ADR-26 心智。
- **来源**：ADR-41 D-008 已知缺陷

### OQ-GI-FUTURE-3 — Dismissed 列表管理 UI（"我关掉的 N 条"）
- **Owner**：graph-insights owner
- **等待事件**：用户反馈"误关了一条洞察、找不回来"，或 dismissed 表行数 / 用户 ≥ 50（需要管理而不是只能逐条找回）
- **影响工作流**：工作流 C（纯前端 + 一个新只读端点）
- **建议解决路径**：
  1. 后端：`GET /api/insights/dismissed?spaceId=N` 返回 `[{insight_key, dismissed_at, last_payload_snapshot?}]`；
  2. payload_snapshot 是难点：dismissed 表只存 key，洞察本身已被 dismiss 后从 cache 过滤掉；要么 dismiss 时把当时的 insight 内容快照进 dismissed 表新加的 `snapshot_json` 列，要么仅显示 key + 类型推断 + "重新计算后再判定"；
  3. 推荐方案：dismiss 时不存快照（保持表小）；列表 UI 仅显示 `[isolated/bridge/surprise/sparse]` 类型标签 + dismissed_at + 一个"恢复"按钮调 DELETE；
  4. 入口：在 `/insights` 页右上角加"我关掉的"链接，打开抽屉/对话框。
- **来源**：ADR-41 D-005 衍生

### OQ-KGV-FUTURE-1 — AGE 老 Space 数据 backfill 的触发条件
- **Owner**：knowledge-graph-view owner + ADR-27 owner
- **等待事件**：用户报告 "我有 ≥ 3 个老 Space 进 `/knowledge-graph` 都看到 empty banner、且这些 Space 在 PG 里有数据"，或 `kg_graph_loaded{empty:true}` 在生产日志的占比 ≥ 20%
- **影响工作流**：工作流 B 或 C（看是否要新表、还是仅写一次性脚本）
- **建议解决路径**：
  1. 写脚本 `scripts/backfill-age-spaces.mjs`：遍历 PG `space` 表，对每个 space_id 调 `upsertSpace` + 遍历 `space_source` 调 `linkSpaceSource` + 遍历该 source 下 asset 调 `upsertAsset` / `linkSourceAsset`；
  2. 全部走既有 `services/knowledgeGraph.ts` 的 fire-and-forget API（与 ingest 写入路径一致，避免 schema 漂移）；
  3. 加 `--dry-run` flag 先扫不写；
  4. 写完后冷启 30s 验 + 跑一次 `pnpm eval-recall` 确认没动 RAG 链路；
  5. **不要**让 `GET /api/kg/graph` 自动 backfill —— D-008 约束（GET 不带写副作用）。
- **来源**：ADR-42 D-008

### OQ-SQLSEC-1 — `structured_query` 落地时的 SQL AST 级安全校验方案
- **Owner**：`structured_query` change owner（未来）
- **等待事件**：`StructuredQueryAgent` 占位状态解除，启动 NL2SQL change
- **影响工作流**：工作流 A 或 B（全新 P0，`structured_query` change）
- **建议解决路径**：参考 WeKnora 2026 年那次从正则黑名单重构为 PG 官方 parser 的 commit。Node 生态可选：
  1. `pgsql-parser` / `libpg-query-node`（PG 官方 parser 的 JS 绑定），AST 级校验：只允许 `SELECT`、禁止 `pg_catalog` / `information_schema`、强制 `LIMIT`；
  2. 纵深防御：`SET statement_timeout`、`SET TRANSACTION READ ONLY`、独立只读角色（不走主 `pg_db` 的业务账号）；
  3. **不要**用正则黑名单或字符串拼接校验 —— WeKnora 踩过坑才换的，直接继承结论。
- **设计阶段必做**：在 `structured_query` 的 `proposal.md` 里把上述方案写进 Scope 而不是 Future Work。
- **来源**：ADR-39 D-001 / D-004

### OQ-VEC-QUANT-V2 — pgvector 高维向量量化的真正甜区
- **来源**：ADR-44 D-003 / D-004（2026-04-27 LanceDB 借鉴落地实测发现）
- **Owner**：RAG owner + 基础设施 owner
- **等待事件（任一触发）**：① `metadata_field` 行数 > 50,000；② `metadata_field` 总大小 > 200 MB；③ P95 检索 latency > 100 ms（任意一道 RAG 用户被吐槽慢）
- **影响工作流**：未来工作流 B（重启 `asset-vector-coloc` Phase 1.5 / Phase 2）
- **现状**：halfvec 迁移代码、单测、回滚脚本全部 ready；env `PGVECTOR_HALF_PRECISION=true` 可一键启。但本次实测在 30 MB / 2k 行 corpus 上：(a) halfvec 把 Q26/Q32 类 borderline 题候选从 5 切到 0（MIN_SCORE=0.5 阈值 + fp16 累积误差），(b) 收益（~14 MB 节省）不足以抵消任何风险。
- **建议解决路径（重启前必须先做）**：
  1. **MIN_SCORE adaptive 或 reranker 兜底**——retrieveInitial 在 < MIN_SCORE 时不直接丢弃，而是 fallback 到 top-K（譬如 K=5 强制保留），再让 reranker 决定相关性；
  2. **启 halfvec** + 跑 eval-recall 实测 borderline 题不再退化；
  3. **可选 Phase 1.5** 引入 `bit(4096)` Hamming HNSW 粗筛 + halfvec 精排（pgvector 0.8 已支持）；
  4. **可选 Phase 2** 引入 pgvectorscale DiskANN（需先核国产 PG 发行版的 .so 兼容性）

### OQ-CAPTION-DUAL-EMBED — caption 独立向量列（异构模型驱动）
- **来源**：ADR-44 D-004（2026-04-27 LanceDB 借鉴评估）
- **Owner**：Ingest owner + RAG owner
- **等待事件**：引入与正文不同的 caption embedding 模型（如 BGE-M3 caption-tuned / Cohere `embed-multilingual-v3`），或上线"用户上传图片做 query"的多模态检索场景
- **影响工作流**：工作流 B（在 `metadata_field` 加 `caption_embedding halfvec(N)` 列 + `hybridSearch` 加第三路）
- **现状**：当前 caption 与正文共用 Qwen3-Embedding-8B 同一模型；过滤 `WHERE kind='image_caption'` 已等价"图问图"过滤，单独存列零增量价值。
- **建议解决路径**：触发后 (a) 选定异构模型评估在 GM-LIFTGATE32 上的 image-related 题召回提升幅度；(b) 加列 + 回填脚本（仿 `backfill-l0.mjs`）；(c) `hybridSearch` 加第三路 RRF k=90，权重低于 vector / keyword

### OQ-EVAL-RECALL-DRIFT — `recall@5=1.000 → 0.865` 基线漂移追查
- **来源**：ADR-44 D-003 / D-005 / D-006（2026-04-27 跨 4 配置实测均得 0.865，PROGRESS-SNAPSHOT-2026-04-26-l0-abstract.md 的 1.000 不可复现）
- **Owner**：Eval owner + RAG owner
- **等待事件**：可立即启动（已是当前真痛点；与 LanceDB 借鉴评估完全独立）
- **影响工作流**：工作流 B 或 C（视范围而定）—— 至少需要先跑诊断，再决定是修复 corpus / eval set / chunk_abstract 覆盖率，还是修复 retrievalInitial 的 MIN_SCORE/topK 策略
- **现状**：5 道题（Q26/Q27/Q32/Q62/Q70）跨"halfvec ON · vector ON · L0 ON · L0 OFF"四种配置一律 top-5 = 19,19,19,19,19 或类似单 asset 占满。L0 filter 在这 5 道题上零效果，疑似 chunk_abstract 表对 asset_5 相关 chunk 的覆盖不全。
- **建议解决路径（按顺序）**：
  1. **先做"基线条件锚定"**——给 PROGRESS-SNAPSHOT 指标块加固定字段：测量时间 / corpus rows / eval-set commit hash / 关键 env flag 状态；
  2. **诊断步骤**：(a) 查 `chunk_abstract WHERE asset_id IN (期望 asset 列表)` 的覆盖率；(b) diff 当前 corpus vs 上次 1.000 测量时的 corpus 行数 / 时间戳；(c) eval-recall 加 `--preflight`（与 OQ-EVAL-1 合并）；
  3. **判定**：若漂移源于 corpus / 评测集，重测一次锁定 0.865 为新基线；若源于 chunk_abstract 缺漏，跑 `backfill-l0.mjs --commit` 补；若源于 retrievalInitial 策略，进 OQ-VEC-QUANT-V2 §1 那条 MIN_SCORE adaptive
- **关联**：OQ-EVAL-1（PG preflight）—— 本 OQ 应作为 OQ-EVAL-1 的超集启动，二者合并解决

### OQ-SKILL-BRIDGE — qa-service Agent 消费 mcp-service 的声明式 Skill
- **MVP 已交付**（2026-04-25 · ADR-41 `skill-bridge-mvp`）：
  - `apps/qa-service/src/services/skillBridge.ts` 新建（282 行），登记 4/8 skill：`search_knowledge` / `get_page_content` / `ontology.query_chunks` / `ontology.traverse_asset`
  - 不动任何 agent，作为 ready-to-consume API 摆在那
  - 4 个延后的 skill：`ontology.match_tag` 与 `ontology.path_between`（依赖 `/api/ontology/match` 与 `/api/ontology/path` 端点，未实现）；`action.execute` / `action.status`（依附 actionEngine 演进）
  - **本 OQ 不关闭** —— 完整版（MCP client + 自动重连 + 8/8）仍是后续目标
- **Owner**：Agent/MCP owner
- **等待事件（剩余）**：① OQ-AGENT-1 ReACT change 启动时把 skillBridge 接入新 Agent；② `/api/ontology/match` 与 `/api/ontology/path` 端点落地后补 2 个 ontology skill；③ actionEngine 稳定后补 2 个 action skill；④ 出现"agent 需要按运行时配置切换工具集"的真实场景（升级到完整 MCP client）
- **影响工作流**：工作流 B —— 改 `apps/qa-service/src/agent/` + 可能新增 `services/mcpClient.ts`；不动 mcp-service 既有 Skill
- **现状**：
  - mcp-service 已有 8 个声明式 Skill（ADR-34，包含 `search_knowledge` / `get_page_content` 与 6 个 ontology skill），通过 stdio + streamable HTTP 双通道暴露给 Cursor / Claude Desktop
  - qa-service 4 个 agent 都不消费这些 Skill：`KnowledgeQaAgent` 直接 `runRagPipeline`；`dataAdminAgent` 用本地 `TOOLS` 数组；其它两个是占位
  - 桥（MCP client）不存在
- **建议解决路径（两档）**：
  - **MVP 弱解读**（~0.5 人天）：qa-service 直接 `import` `apps/mcp-service/src/skills/*` 的 handler，绕开 MCP 协议层。代价：Skill 的"声明式可热插拔"价值打折扣，但能立刻让 ReACT 用上现成 8 个工具
  - **完整 强解读**（~2-3 人天）：qa-service 起 MCP client 指向 stdio 或 `http://localhost:3002/mcp`，把 Skill 注册成 LLM 工具；含 WeKnora #5 同源的"自动重连 + Web search provider 化"。可热插拔
- **决策时机**：等 OQ-AGENT-1 触发时再做选择 —— 若多跳 eval 显示 ReACT 必要，先 MVP 跑通验证，再视效果升级到完整版
- **来源**：ADR-39 D-007（2026-04-25 把 D-001 第 5 行从"不登记"升级为登记）

---

新问题出现时按下列模板追加：

```
## Q-NNN — <一句话问题>

- **Owner**：_<姓名>_
- **等待事件**：_<外部依赖>_
- **影响工作流**：_<A/B/C/D 或具体 change 目录>_
- **建议解决路径**：1. …  2. …
```

---

**维护规则**：
- 每条问题必须可回溯到一个看板任务或 change 目录
- 超过 2 周未动的 Open Question，周会上必须点名复盘或关闭
- 关闭时新增 ADR 到 `.superpowers-memory/decisions/`，然后把问题迁到本文件"已关闭"区
