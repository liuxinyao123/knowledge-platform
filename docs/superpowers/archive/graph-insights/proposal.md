# Proposal: graph-insights — 图谱洞察与 Deep Research 触发

## Problem

ADR-27 的 AGE 知识图谱已在 `ingest/RAG/spaces` 三处 fire-and-forget 写入 `:Asset / :Source / :Space / :Tag / :Question + CITED/CO_CITED/HAS_TAG/CONTAINS/SCOPES`，但当前只被 `DetailGraph.tsx` 消费成 per-asset 的邻域环形视图。**全图拓扑信号（孤立度、中心性、社区结构）完全未被利用**，带来四个可见症状：

1. **孤立资产不可见** — BookStack 附件（ADR-31）和冷启动资料容易产生 `degree(CO_CITED ∪ HAS_TAG) ≤ 1` 的孤岛页面，用户无法主动感知，需通过 `scripts/find-zombie-assets.mjs`（ADR-36）手工巡检。
2. **桥接知识不可见** — 横跨多主题的关键资产，当前只能靠运气在搜索结果里撞见。
3. **稀疏社区不可见** — 某主题摄入不足时（社区内 CO_CITED 稀疏）无任何信号提示"这里需要更多资料"。
4. **惊奇连接不可见** — 跨社区的 CO_CITED 边常是知识的跨界联结，但无凸显机制。

OAG Phase 1（ADR-33）解决的是 prompt 注入侧的知识关联增强；OAG Phase 2（ADR-39 已搁置）是检索召回侧。graph-insights 是**第三条正交路线**：**把图谱从展示物变成摄入驱动源**，通过全图统计主动暴露知识盲点并触发 Deep Research 补齐。

参考来源：llm_wiki README（GPL-3，仅借概念、不引源代码）。详细 Explore 见 `docs/superpowers/specs/graph-insights/design.md`。

## Scope（本 change）

1. **四类洞察算法**（按需计算 + TTL + signature 双失效）：
   - **isolated**：`degree(CO_CITED ∪ HAS_TAG) ≤ 1` 且 `metadata_asset.created_at < now() - 7d`
   - **bridges**：Louvain 社区邻居 distinct `community_id ≥ 3`；社区未启用时回退到 `HAS_TAG` 集群 distinct ≥ 3
   - **surprises**：CO_CITED 边端点跨不同 Louvain 社区，按复合 `surprise_score = 3·cross_community + 1.5·cross_type + 1.0·log(1+weight)` 排 top-N
   - **sparse**：Louvain 社区 `|C| ≥ 3 AND cohesion = edges_in_C / C(|C|,2) < 0.15`

2. **Louvain 计算**：在 Node 侧用 `graphology-communities-louvain`，resolution=1.0（env `GRAPH_INSIGHTS_LOUVAIN_RESOLUTION` 可覆盖），仅以 `CO_CITED` 作为输入边（`HAS_TAG` 不进 Louvain，仅用于 bridge 回退识别）。

3. **DB 结构**：
   - 新表 `metadata_graph_insight_cache (space_id PK, computed_at, ttl_sec, graph_signature, payload JSONB)`
   - 新表 `metadata_graph_insight_dismissed (user_email, space_id, insight_key, dismissed_at; PK (user_email, space_id, insight_key))` — 用户关闭的洞察跨会话持久化

4. **HTTP 路由**（`apps/qa-service/src/routes/insights.ts`）：
   - `GET /api/insights?spaceId=N` → requireAuth + enforceAcl(Viewer) → `{generated_at, isolated, bridges, surprises, sparse}`；payload 内每条洞察带 `key`（稳定哈希）和相应 `score`
   - `POST /api/insights/refresh` body `{spaceId}` → 强制重算（role=Admin 限制）
   - `POST /api/insights/dismiss` body `{spaceId, insight_key}` → 写 `metadata_graph_insight_dismissed`
   - `DELETE /api/insights/dismiss` body `{spaceId, insight_key}` → 取消 dismiss

5. **Deep Research 复用**：
   - 新增 `services/graphInsights/deepResearchPrompt.ts`：接受洞察卡片 → 调 `llmProviders.chat`（`GRAPH_INSIGHTS_TOPIC_MODEL` 默认取 ragPipeline 同模型）生成一句研究主题
   - 前端可编辑 → 提交到既有 `POST /api/agent/dispatch { intent:'knowledge_qa', question, assetIds, spaceId }`
   - **不新增 Agent skill / intent**，复用 `runRagPipeline.opts.assetIds/spaceId`（`ragPipeline.ts:498-514` 已支持）

6. **前端**：
   - 新路由 `/knowledge/insights`（Layout 左栏新增导航项"洞察"）
   - `apps/web/src/knowledge/Insights/` 目录：`index.tsx` + `Cards/{Isolated,Bridges,Surprises,Sparse}.tsx` + `DeepResearchDialog.tsx`
   - payload 过滤 `dismissed` 后展示；前端 dismiss 乐观更新
   - **不改 `DetailGraph.tsx`**；未来可选反链"在洞察中查看"

7. **并发与可观测性**：
   - 重算使用 `pg_try_advisory_lock(hashtext('gi:'||space_id))`，未拿到锁时读旧缓存 + WARN
   - 结构化日志事件：`graph_insights_computed{space_id, duration_ms, asset_count, edge_count, communities}`、`graph_insights_cache_hit{space_id}`、`graph_insights_dismissed{user, space_id, insight_key}`

8. **降级策略**：
   - `|E| > GRAPH_INSIGHTS_MAX_EDGES`（默认 10_000）→ 跳过 Louvain，仅返回 `isolated` + 基于 `HAS_TAG` 回退的 `bridges`；payload 带 `degraded:true` 标记
   - AGE sidecar 不可达 → 路由直接返回 `503 {code:'KG_UNAVAILABLE'}`，前端显示"暂不可用"

## Out of Scope

- **跨 Space 全局洞察**（v1 严格按 Space 分片，防 ACL 泄露；Admin 需要全局视图等 v2）
- **Notebook 级洞察**（ADR-24 的子 scope；等真实需求）
- **历史趋势 / 时间序列**（v1 只快照当前，不存历史）
- **主动推送 / 通知**（v1 用户进入页面才看到；不发邮件/站内信）
- **llm_wiki 源代码移植**（GPL-3 合规；全部从概念级重写；权重常量自定）
- **新增图谱节点/边类型**（全部洞察都是计算产物，不改 AGE schema）
- **替换或并行的向量库**（pgvector 真相源不动，Q-002）
- **DetailGraph 重构**（保留纯 SVG 环形布局；引 sigma.js 是 v2 议题）
- **写入侧图谱数据质量修复**（若 CO_CITED 权重有偏，那是 ADR-27 的问题，在本 change 范围外）
- **Louvain 增量算法**（v1 每次全量跑；缓存 + advisory lock 足够对付 MVP 规模）
- **OAG Phase 2 合并实现**（ADR-39 已搁置；graph-insights 与其正交，不触发 Phase 2）

## Success Metrics（OpenSpec 合并后由执行方验证）

- `GET /api/insights?spaceId=N` 冷启（无缓存）响应 p95 ≤ **1200ms**，热启（命中缓存）p95 ≤ **50ms**（|V|=500 / |E|=2000 Space 规模下）
- Louvain 在 `|E|=10_000` 的极限 Space 上 **≤ 2000ms**；超限自动降级，响应 payload `degraded=true`
- `POST /api/insights/dismiss` 后同一用户 24 小时内同一 `insight_key` 不再出现在 `GET /api/insights` payload
- 两个 Admin 并发 `POST /api/insights/refresh` 同一 space_id：仅一个触发 Louvain，另一个读旧缓存 + WARN 日志（`graph_insights_cache_hit{reason:'advisory_lock_held'}`）
- 匿名请求 `GET /api/insights` → `401`；Viewer 请求别的 Space → `403`
- `pnpm -r exec tsc --noEmit` / `pnpm --filter qa-service test` / `pnpm --filter web test` 全绿
- `pnpm eval-recall eval/gm-liftgate32-v2.jsonl` recall@5 仍为 **1.000**（graph-insights 不改 RAG 链路，应无影响；必须验证）
- qa-service 冷启 30s 内无异常日志（ADR-37 纪律）
