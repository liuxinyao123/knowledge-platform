# Tasks: graph-insights

> 工作流 B · Lock 完成后，Execute 阶段按本表顺序推进。任务分组按依赖排序；组内可并行。
> 所有 DB migration 幂等；所有路由加 `requireAuth + enforceAcl`；所有 env 默认在 `.env.example` 落位。

## 锁定（Lock 阶段已完成）

- [x] `openspec/changes/graph-insights/proposal.md`
- [x] `openspec/changes/graph-insights/design.md`
- [x] `openspec/changes/graph-insights/specs/graph-insights-spec.md`
- [x] `openspec/changes/graph-insights/tasks.md`（本文件）
- [x] 与用户确认 OQ-GI-1～5 锁定值：Louvain resolution=1.0 · 仅 CO_CITED 参与 Louvain · Topic model 走 llmProviders · v1 不做 Notebook 级 · payload 带 score · v1 支持 dismissed 持久化

## 执行阶段

### Phase A · DB 迁移（无依赖，先落）

- [ ] 扩 `apps/qa-service/src/services/pgDb.ts:runPgMigrations()`：
  - [ ] `CREATE TABLE IF NOT EXISTS metadata_graph_insight_cache (...)`（DDL 见 design.md §数据结构）
  - [ ] `CREATE INDEX IF NOT EXISTS idx_mgic_computed_at`
  - [ ] `CREATE TABLE IF NOT EXISTS metadata_graph_insight_dismissed (...)`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_mgid_user_space`
- [ ] 验证幂等：重复跑 `runPgMigrations` 不报错（本机 `pnpm dev:up` 二次启动实测）
- [ ] 写 `pgDb.ts:runPgMigrationsDown()` 对应的 drop（可选，向后可回滚）

### Phase B · 图谱读取 + Louvain（核心算法层）

- [ ] 新增依赖：`pnpm --filter qa-service add graphology graphology-communities-louvain`
- [ ] 新增 `apps/qa-service/src/services/graphInsights/loader.ts`：
  - [ ] `loadSpaceSubgraph(spaceId): Promise<{ nodes, edges, signature }>`
  - [ ] 从 AGE 查 `MATCH (s:Space {id:$1})-[:SCOPES]->(src:Source)-[:CONTAINS]->(a:Asset) ...` 把 Space 范围内的 Asset + CO_CITED 边 + HAS_TAG 拉出
  - [ ] 额外查 `(a)-[t:HAS_TAG]->(:Tag)` 仅供 bridges 回退使用
  - [ ] `signature = 'a='+count+',e='+count+',m='+max(indexed_at)`
- [ ] 新增 `apps/qa-service/src/services/graphInsights/louvain.ts`：
  - [ ] `detectCommunities(edges, resolution): Map<asset_id, community_id>`
  - [ ] 边超限判定（`|E| > GRAPH_INSIGHTS_MAX_EDGES`）抛 `GraphTooLargeError`
  - [ ] try/catch 兜底，异常抛 `LouvainFailureError`

### Phase C · 四类洞察计算

- [ ] 新增 `apps/qa-service/src/services/graphInsights/isolated.ts`：
  - [ ] `computeIsolated(subgraph, minAgeDays): IsolatedInsight[]`
- [ ] 新增 `apps/qa-service/src/services/graphInsights/bridges.ts`：
  - [ ] `computeBridges(subgraph, communities | null): BridgeInsight[]`
  - [ ] communities=null 时走 HAS_TAG 回退口径
- [ ] 新增 `apps/qa-service/src/services/graphInsights/surprises.ts`：
  - [ ] `computeSurprises(subgraph, communities, weights, topN): SurpriseInsight[]`
  - [ ] 计算 `surprise_score`；按降序取 topN
- [ ] 新增 `apps/qa-service/src/services/graphInsights/sparse.ts`：
  - [ ] `computeSparse(subgraph, communities, cohesionThreshold, minSize): SparseInsight[]`
- [ ] 新增 `apps/qa-service/src/services/graphInsights/keys.ts`：
  - [ ] `makeKey(type, payload): string` — sha256，稳定

### Phase D · 缓存与编排

- [ ] 新增 `apps/qa-service/src/services/graphInsights/cache.ts`：
  - [ ] `readCache(spaceId): Promise<CachedPayload | null>`
  - [ ] `writeCache(spaceId, payload, signature): Promise<void>`（UPSERT）
  - [ ] `isFresh(cached, signature, ttlSec): boolean`
- [ ] 新增 `apps/qa-service/src/services/graphInsights/index.ts`：
  - [ ] `getInsights(spaceId, { force?: boolean }): Promise<Payload>`
  - [ ] 流程：if !force → 读 cache → 算 signature → 有效命中则返回 · else 进重算
  - [ ] 重算路径：`pg_try_advisory_lock` → loader → louvain → 4 算 → writeCache → 返回
  - [ ] 未拿锁：读 cache（即使 stale）+ WARN
- [ ] 新增 `apps/qa-service/src/services/graphInsights/dismissed.ts`：
  - [ ] `listDismissed(user, spaceId): Promise<Set<string>>`
  - [ ] `addDismissed(user, spaceId, key)` / `removeDismissed(user, spaceId, key)`
  - [ ] `getInsights` 返回前过滤

### Phase E · Deep Research 主题生成

- [ ] 新增 `apps/qa-service/src/services/graphInsights/deepResearchPrompt.ts`：
  - [ ] `generateTopic(insight, spaceContext): Promise<{topic, query_hint}>`
  - [ ] 用 `llmProviders.chat`；模型由 `GRAPH_INSIGHTS_TOPIC_MODEL` 决定（空则取 rag 的模型）
  - [ ] 兜底模板：LLM 超时/异常时返回 `{topic:'扩展 ${name} 的关联知识', query_hint:''}`

### Phase F · HTTP 路由

- [ ] 新增 `apps/qa-service/src/routes/insights.ts`：
  - [ ] `GET /api/insights?spaceId=N`
    - [ ] requireAuth + enforceAcl(Viewer, resource=Space:N)
    - [ ] 调 `getInsights`
    - [ ] 过滤 dismissed 后返回
  - [ ] `POST /api/insights/refresh`
    - [ ] requireAuth + role=Admin
    - [ ] 调 `getInsights(spaceId, { force: true })`
  - [ ] `POST /api/insights/dismiss`
    - [ ] requireAuth + enforceAcl(Viewer, resource=Space:N)
    - [ ] UPSERT into `metadata_graph_insight_dismissed`
  - [ ] `DELETE /api/insights/dismiss`
    - [ ] requireAuth + enforceAcl(Viewer)
    - [ ] DELETE from `metadata_graph_insight_dismissed`
  - [ ] `POST /api/insights/topic` body `{spaceId, insight_key}`（可选内部端点，供前端 Deep Research 对话框用）
    - [ ] requireAuth + enforceAcl(Viewer)
    - [ ] 从 cache 里按 `insight_key` 查到 insight → 调 `generateTopic`
- [ ] `apps/qa-service/src/index.ts` 挂路由：`app.use('/api/insights', insightsRouter)`

### Phase G · 环境变量

- [ ] `apps/qa-service/.env.example` 追加（默认值见 design.md）：
  ```
  GRAPH_INSIGHTS_ENABLED=true
  GRAPH_INSIGHTS_TTL_SEC=1800
  GRAPH_INSIGHTS_LOUVAIN_RESOLUTION=1.0
  GRAPH_INSIGHTS_MAX_EDGES=10000
  GRAPH_INSIGHTS_TOP_SURPRISES=10
  GRAPH_INSIGHTS_WEIGHT_CROSS_COMMUNITY=3.0
  GRAPH_INSIGHTS_WEIGHT_CROSS_TYPE=1.5
  GRAPH_INSIGHTS_WEIGHT_EDGE_LOG=1.0
  GRAPH_INSIGHTS_TOPIC_MODEL=
  GRAPH_INSIGHTS_ISOLATED_MIN_AGE_DAYS=7
  GRAPH_INSIGHTS_SPARSE_COHESION_THRESHOLD=0.15
  GRAPH_INSIGHTS_SPARSE_MIN_SIZE=3
  ```
- [ ] 如 docker-compose 显式列变量，同步添加（参考 ingest-async-pipeline follow-up 经验，可放 Phase J）

### Phase H · 前端

- [ ] 新增 `apps/web/src/api/insights.ts`：
  - [ ] `getInsights(spaceId)` / `refreshInsights(spaceId)` / `dismiss(spaceId, key)` / `undismiss(...)` / `generateTopic(spaceId, key)`
- [ ] 新增 `apps/web/src/knowledge/Insights/`：
  - [ ] `index.tsx` — 主页面，拉 `/api/insights`，渲染四个卡片分组
  - [ ] `Cards/Isolated.tsx` / `Cards/Bridges.tsx` / `Cards/Surprises.tsx` / `Cards/Sparse.tsx`
  - [ ] `DeepResearchDialog.tsx` — 主题生成 + 可编辑 + 提交到 `/api/agent/dispatch`
  - [ ] 共用 `DismissButton`（乐观更新 + 失败回滚 toast）
  - [ ] 新增 `MiniGraph.tsx`（**用户确认入 v1**）：接受 `{seedAssetId, neighborAssetIds[]}`，渲染 80×80 SVG 径向布局（种子在中心、邻居环绕）；每条卡片右侧嵌入一个 MiniGraph；复用 `DetailGraph.tsx` 的节点圆圈 + 连线绘制风格但**不含交互**（static 呈现，避免引入新依赖）；在 `surprises` 卡片里的 MiniGraph 双节点并列展示；在 `sparse` 卡片里的 MiniGraph 展示 community core 前 3 节点构成的小集群
- [ ] `apps/web/src/components/Layout.tsx` 左栏导航加"洞察"项
- [ ] 路由注册 `/knowledge/insights`
- [ ] `degraded=true` 时展示 WARN banner（"图谱规模较大，部分洞察已降级"）

### Phase I · 测试

- [ ] 新增 `apps/qa-service/src/__tests__/graphInsights.algo.test.ts`：
  - [ ] isolated 阈值边界（degree 0 / 1 / 2）
  - [ ] isolated 年龄阈值（3d / 7d / 10d）
  - [ ] bridges Louvain 启用（distinct community count 1 / 3 / 4）
  - [ ] bridges HAS_TAG 回退
  - [ ] surprises 跨社区判定 + topN 截断
  - [ ] surprises 权重 env 覆盖生效
  - [ ] sparse 阈值边界（size 2 / 3；cohesion 0.14 / 0.15 / 0.16）
  - [ ] keys.makeKey 稳定性（同输入同输出）
- [ ] 新增 `apps/qa-service/src/__tests__/graphInsights.cache.test.ts`：
  - [ ] TTL 命中 / 过期
  - [ ] signature 变化触发重算
  - [ ] advisory lock 并发 — 仅一侧重算（用 fake timer + spy）
- [ ] 新增 `apps/qa-service/src/__tests__/graphInsights.routes.test.ts`：
  - [ ] 401 匿名 / 403 越权 / 400 缺 spaceId
  - [ ] 200 happy path + payload shape 校验
  - [ ] dismiss 幂等 + DELETE 恢复
  - [ ] dismissed 过滤生效（同一 key 对 A 隐藏对 B 可见）
  - [ ] refresh Admin 限制
- [ ] 新增 `apps/qa-service/src/__tests__/graphInsights.degrade.test.ts`：
  - [ ] AGE 不可达 → 503
  - [ ] |E| 超限 → degraded=true
  - [ ] Louvain 异常 → degraded=true + bridges 回退
  - [ ] Space 无资产 → 空数组 + degraded=false
- [ ] 新增 `apps/web/src/__tests__/Insights.test.tsx`（或 e2e）：
  - [ ] 四类卡片渲染
  - [ ] dismiss 乐观更新
  - [ ] Deep Research 对话框 → dispatch 流
- [ ] 本机 `pnpm -r exec tsc --noEmit` 全绿
- [ ] 本机 `pnpm --filter qa-service test` 全绿
- [ ] 本机 `pnpm --filter web test` 全绿

### Phase J · 验收（执行方在 PR 填写）

- [ ] 冷启响应 p95 ≤ 1200ms（|V|=500/|E|=2000 Space）
- [ ] 热启 p95 ≤ 50ms
- [ ] Louvain 在 |E|=10_000 边界 ≤ 2000ms；超限自动降级
- [ ] 两 Admin 并发 refresh 同 space：仅一次重算，另一读旧 cache + WARN
- [ ] `pnpm eval-recall eval/gm-liftgate32-v2.jsonl` recall@5 = 1.000（无回归）
- [ ] qa-service 冷启 30s 无错误（ADR-37）
- [ ] `docker logs qa_service` 干净

### Phase K · 归档

- [ ] 验证通过后：
  - [ ] 复制 `openspec/changes/graph-insights/*` 到 `docs/superpowers/archive/graph-insights/`
  - [ ] 新增 `docs/superpowers/archive/graph-insights/ARCHIVED.md`
  - [ ] `openspec/changes/graph-insights/` 保留作为活契约
- [ ] 新增 ADR：`.superpowers-memory/decisions/2026-04-24-41-graph-insights.md`
- [ ] `.superpowers-memory/MEMORY.md` 索引更新
- [ ] `.superpowers-memory/open-questions.md` 新增 / 关闭相关 OQ：
  - [ ] 新增 `OQ-GI-FUTURE-1`：跨 Space 全局洞察（Admin 视图）触发条件
  - [ ] 新增 `OQ-GI-FUTURE-2`：Notebook 级洞察触发条件
- [ ] 新增 PROGRESS-SNAPSHOT-2026-04-XX-graph-insights.md

## 不动

- `services/knowledgeGraph.ts`（AGE 写入侧）
- `services/ragPipeline.ts`（Deep Research 直接复用既有签名）
- `services/hybridSearch.ts`
- `agent/dispatchHandler.ts`（不新增 intent）
- `apps/web/src/knowledge/Assets/DetailGraph.tsx`（SVG 环形布局保留）
- AGE schema 本身（ADR-27）
- pgvector / MySQL 真相源职责边界
