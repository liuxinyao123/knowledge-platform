# ADR 2026-04-25-41 — Graph Insights · 图谱洞察 + 一键 Deep Research

> 工作流 B · `superpowers-openspec-execution-workflow`。
> 契约：`openspec/changes/graph-insights/{proposal,design,tasks}.md + specs/graph-insights-spec.md`
> 归档：`docs/superpowers/archive/graph-insights/`
> 关联 Open Question：新增 `OQ-GI-FUTURE-1/2/3`
> 上游：ADR-27（AGE）/ ADR-26（Space）/ ADR-33（OAG Phase 1）/ ADR-37（TS 纪律）/ ADR-39（项目借鉴范本）
> 来源：用户 2026-04-24 要求接入 llm_wiki（GPL-3）的"图谱洞察"概念

## Context

ADR-27 把 AGE 的写入侧（`ingest / RAG / spaces` 三处 fire-and-forget）跑通，5 节点 5 边类型已在 `knowledgeGraph.ts` 落盘；ADR-33 把"读取侧 prompt 注入"以 OAG Phase 1 名义落地，eval-recall 跑出 recall@5=1.000。但**全图拓扑信号（孤立度、中心性、社区结构）完全未被消费**，只有 `DetailGraph.tsx` 把单资产邻域渲染成环形 SVG。

用户提出参考 llm_wiki 的"图谱洞察"模块，把图谱从展示物变成**摄入驱动源**：通过全图统计自动暴露孤立资产 / 桥接节点 / 跨社区边 / 稀疏社区，并对每条洞察提供"一键 Deep Research"补齐。

合规约束：llm_wiki 是 GPL-3。本项目**只借概念、不引入源代码**——所有算法从 README 描述级重新实现，权重常量自定，避免许可证传染。

## Decision

### D-001 工作流选 B 而非 ADR-39 模板的"借鉴 + OQ 登记"

ADR-39 对 WeKnora 的处置是"登记 OQ、不启 change"，理由是 OAG Phase 2 的触发条件不成立（recall@5 已触顶）。graph-insights 与之不同：**它不改检索链路**，是正交的"主动发现"路线，不依赖 recall 数据触发。用户明确要求落实，按工作流 B 走完 Explore → Lock → Execute → Verify → Archive 四步。

### D-002 Louvain 跑在 Node.js 侧，仅消费 CO_CITED

- AGE / Postgres 无原生 Louvain；引 `pg_graphblas` 与现有 sidecar 部署冲突。`graphology-communities-louvain` 在 |E|≤10_000 尺度内基准 < 500ms。
- `HAS_TAG` 不进 Louvain（被 ontology 手工增删污染、跨来源质量差异大）；只在"Louvain 降级时的 bridges 回退识别"路径里使用。
- `resolution=1.0`（graphology 默认）通过 env `GRAPH_INSIGHTS_LOUVAIN_RESOLUTION` 可覆盖。

### D-003 惊奇度权重自定，不抄 llm_wiki

公式：`surprise_score = 3.0 * cross_community + 1.5 * cross_type + 1.0 * log(1 + edge.weight)`。三个系数全部走 env（`GRAPH_INSIGHTS_WEIGHT_*`），eval 后再调。**不**从 llm_wiki 抄数值——避免 GPL 化常量。

### D-004 双保险缓存失效（TTL + signature）+ PG advisory lock 防并发重算

- 缓存表 `metadata_graph_insight_cache (space_id PK, computed_at, ttl_sec, graph_signature, payload JSONB)`。
- `graph_signature = 'a=N,e=M,t=K,m=<ISO>'`：拉子图前先算签名，与 cache 比对，不一致即重算（绕开 TTL）。
- 并发：`pg_try_advisory_lock(hashtext('graph_insights:'||space_id))`。拿到锁的重算并写 cache；拿不到的读旧 cache（即使 stale）+ WARN 日志 `graph_insights_cache_hit{reason:'advisory_lock_held'}`。**非阻塞**，用户不会看到长时间转圈。

### D-005 Dismissed 走二级表，不塞进 payload

- `metadata_graph_insight_dismissed (user_email, space_id, insight_key, dismissed_at)` 三元主键。
- `insight_key` 用 sha256 稳定哈希构造，跨重算保持洞察 identity（详见 design.md §D-006）：
  - `iso:asset_id` / `bri:asset_id` / `sur:min_id:max_id` / `spa:sorted_asset_ids`
- 路由层在返回 payload 前按 `(user_email, space_id)` 过滤；前端不需要自行去重。
- sparse 的 `insight_key` 在社区成员变化时会变——这是预期行为（"当时的那个稀疏社区"）。

### D-006 Deep Research **不**新增 Agent skill / intent，复用 `runRagPipeline`

- ADR-24 已确认 `RunRagOptions.assetIds` 非空时跳过 short-circuit、直接调 LLM。`opts.spaceId` 也已支持。Deep Research 直接 `POST /api/agent/dispatch { intent:'knowledge_qa', question, assetIds, spaceId }`。
- 研究主题生成走 `llmProviders.chatComplete`（`GRAPH_INSIGHTS_TOPIC_MODEL` 空则取 `getLlmModel()`），LLM 失败兜底回拼接模板。OQ-GI-3 锁定。
- **零** ragPipeline / hybridSearch / agent dispatch 代码改动。

### D-007 路由层 ACL 双重保护

- `enforceAcl({action:'READ', resourceExtractor:(req)=>({space_id:N})})` —— Space 级 Viewer 门禁。
- `POST /api/insights/refresh` 用 `action:'ADMIN'`（Permissions V2 把 Space owner/admin 投影到 ADMIN 权限，与全局 admin 都通过）。
- payload 里嵌的 `assetId` 列表，前端二次查询走 `/api/assets/:id` 时再次走 ACL（纵深防御 R8）。

### D-008 降级路径与 graceful 状态

| 条件 | 行为 | payload |
|------|------|---------|
| AGE 不可达 | 503 `{code:'KG_UNAVAILABLE'}` | — |
| `\|E\| > GRAPH_INSIGHTS_MAX_EDGES`（默认 10_000） | 跳过 Louvain；bridges 用 `HAS_TAG` 回退；surprises/sparse 空 | `degraded:true, reason:'graph_too_large'` |
| `LouvainFailureError` | 同上 | `degraded:true, reason:'louvain_exception'` |
| Space 无资产 | 200 + 空数组 | `degraded:false`（正常空，非降级） |
| `GRAPH_INSIGHTS_ENABLED=false` | 503 `{code:'FEATURE_DISABLED'}` | — |

### D-009 前端布局：新路由 `/insights`，不耦合 DetailGraph

- DetailGraph 是 per-asset 视图，洞察是 per-Space 全局视图——心智不同，分开放。
- Layout `NAV_MANAGE` 加 "图谱洞察"，与"运行概览"/"内容治理"/"资产目录"/"数据接入"平级。
- 每条卡片右侧带 64×64 静态 SVG MiniGraph（用户在 mockup 评审时明确要求入 v1）。**不引 sigma.js**（避免 +200KB bundle）。
- 四类洞察用色彩语义编码：amber=孤立 · purple=桥接 · teal=惊奇 · coral=稀疏。

## Consequences

### 正向

- 知识盲点首次有了主动发现机制：之前只能靠 `find-zombie-assets.mjs`（ADR-36）人工扫，现在 `/insights` 一键看四类。
- 不改 RAG / 检索 / hybridSearch / Agent dispatch 任何代码，eval-recall 应字节级一致（待 Verify 阶段证实）。
- 不改 AGE schema（ADR-27 不动）：洞察全部是计算产物，未来扩到新洞察类型也只在 Node 侧加。
- GPL-3 合规边界清晰：源代码全自写，权重常量自定，README 概念级借鉴有 ADR-39 / ADR-41 双重溯源。
- 缓存策略可观测：`graph_insights_cache_hit` / `graph_insights_computed` / `graph_insights_louvain_skipped` / `graph_insights_topic_fallback` 全 emit 结构化日志。
- ADR-37 纪律遵守：无 enum、无 parameter property、无 namespace、无 decorator。新代码冷启 30s 验证作为 Verify 门槛。

### 负向

- AGE 子图拉取每次都查（即使缓存命中也算 signature）——单次开销 ~50–200ms，命中 cache 的总响应 < 200ms 仍达标，但**未命中**的冷请求 p95 在 1200ms。可接受但需监控。
- Louvain 降级阈值 `|E|=10_000` 是经验值；未来 BookStack 全量同步可能会触发降级。需要等真实数据再调。
- Notebook 级洞察缺位（OQ-GI-FUTURE-2 登记）。当前所有洞察按 Space 分片，对"私有 Notebook 内的关联"无信号。
- Admin 跨 Space 全局视图缺位（OQ-GI-FUTURE-1）。原因是 ACL 防泄露的保守选择，等场景明确再加。
- 前端 MiniGraph 是静态 SVG，无交互；用户若想钻取节点要回 DetailGraph 单看。

### 归档后副本与活契约的差异治理

- 归档副本（`docs/superpowers/archive/graph-insights/`）= 完成时刻快照，**不再修改**。
- 活契约（`openspec/changes/graph-insights/`）保留供下游引用；后续扩展（如 OQ-GI-FUTURE-1 立项）须新开 change 引用本 ADR-41。
- 与 ADR-39 / ADR-40 同模式。

## 代码清单

### 新增（apps/qa-service · 11 文件）

- `services/graphInsights/{config,loader,louvain,keys,isolated,bridges,surprises,sparse,cache,dismissed,deepResearchPrompt,index}.ts`（共 ~1080 行）
- `routes/insights.ts`（~210 行 · 5 端点）
- `__tests__/graphInsights.{algo,cache,routes}.test.ts`（共 35 case）

### 新增（apps/web · 9 文件）

- `api/insights.ts`（typed client）
- `knowledge/Insights/index.tsx` + `Cards/{Isolated,Bridges,Surprises,Sparse}.tsx` + `MiniGraph.tsx` + `DismissButton.tsx` + `DeepResearchDialog.tsx`（共 ~720 行）

### 修改

- `apps/qa-service/src/services/pgDb.ts` —— +59 行 DDL（2 表 + FK + 索引）
- `apps/qa-service/src/index.ts` —— +2 行（import + mount `/api/insights`）
- `apps/qa-service/.env.example` —— +25 行（11 env vars 含注释）
- `apps/web/src/App.tsx` —— +2 行（import + Route）
- `apps/web/src/components/Layout.tsx` —— +9 行（icon + NAV_MANAGE 项）

### Lock 阶段

- `openspec/changes/graph-insights/{proposal,design,tasks}.md + specs/graph-insights-spec.md`
- `docs/superpowers/specs/graph-insights/design.md`（Explore 草稿）

### 不动

- `services/knowledgeGraph.ts`（AGE 写入侧）
- `services/ragPipeline.ts`（Deep Research 直接复用既有 `opts.assetIds/spaceId`）
- `services/hybridSearch.ts`
- `agent/dispatchHandler.ts`（不新增 intent）
- `apps/web/src/knowledge/Assets/DetailGraph.tsx`（保留 SVG 环形布局）
- AGE schema（ADR-27 冻结）
- pgvector / MySQL 真相源职责边界（Q-002）

## Links

- 上游 README：https://github.com/nashsu/llm_wiki/blob/main/README_CN.md（GPL-3）
- 关联 ADR：
  - ADR-27 `knowledge-graph-age` —— AGE schema 物质基础
  - ADR-26 `space-permissions-lock` —— Space 一级实体 + ACL 投影
  - ADR-33 `ontology-oag-retrieval` —— OAG Phase 1 已上线；graph-insights 与 OAG Phase 2 正交
  - ADR-36 `eval-golden-set-realign` —— eval recall 基线，Verify 用
  - ADR-37 `ts-strip-types-discipline` —— 本 change 所有新代码遵守
  - ADR-39 `weknora-borrowing-map` —— 项目对外部项目借鉴的范本（流程 / 合规）
- 衍生 Open Questions：`OQ-GI-FUTURE-1` / `OQ-GI-FUTURE-2` / `OQ-GI-FUTURE-3`（见 `.superpowers-memory/open-questions.md`）
