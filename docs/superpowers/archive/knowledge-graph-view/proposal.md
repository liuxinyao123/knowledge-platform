# Proposal: knowledge-graph-view —— 全 Space 力导向图

## Problem

ADR-27 把 AGE 写入跑通；ADR-41 把统计型洞察以文本卡片暴露在 `/insights`。但**全图可视化**仍只有 `apps/web/src/knowledge/Assets/DetailGraph.tsx` 的 720×360 SVG 环形——per-asset 1-hop，看不出整体结构。

用户参考 llm_wiki Knowledge Graph 视图（GPL-3，仅借概念、不引源代码），要一个**新页面 `/knowledge-graph`**：力导向布局 + 节点按 Asset.type 着色 + hover 邻居高亮 + 缩放控件。详细 Explore 见 `docs/superpowers/specs/knowledge-graph-view/design.md`。

## Scope

1. **后端新端点 `GET /api/kg/graph?spaceId=N`**（`apps/qa-service/src/routes/kg.ts` 追加）：
   - 鉴权：`requireAuth + enforceAcl({action:'READ', resource:{space_id:N}})`
   - 返回 Space 内 `:Asset` + `:Tag` 节点 + `CO_CITED` + `HAS_TAG` 边
   - 上限 `KG_GRAPH_MAX_NODES=800` / `KG_GRAPH_MAX_EDGES=3000`，超限按节点度数降序截断 + `truncated:true`
   - 不返 `:Source` / `:Space` / `:Question` 节点（v1 减噪）
   - 老 Space 在 AGE 无 `:Space` 节点时返 `200 + {empty:true, hint:'space_not_in_graph'}`，前端 banner 引导重 ingest

2. **新服务 `services/kgGraphView/loader.ts`**：
   - `loadSpaceGraphForViz(spaceId, opts): Promise<GraphPayload>`
   - 与 `services/graphInsights/loader.ts` 并存；前者面向洞察统计、后者面向渲染（Asset.type/label/degree 等），**不互相依赖**
   - 内部用相同的 AGE Cypher 模式拉子图

3. **前端新模块 `apps/web/src/knowledge/KnowledgeGraph/`**：
   - `index.tsx` —— 主页面（Space 选择器 + stats bar + 链接到 `/insights` + 缩放按钮）
   - `SigmaGraph.tsx` —— 真正的 sigma 渲染容器（`React.lazy` 懒加载）
   - `NodeLegend.tsx` / `HoverTooltip.tsx` / `types.ts`
   - 着色：Asset.type 8 种文件类型固定色板 + Tag 节点单独色
   - 交互：单击 tooltip + 双击跳 `/assets/:id`；hover 邻居 alpha 1.0、其余 0.2 + 邻边高亮

4. **前端依赖追加（apps/web）**：`sigma`、`graphology`、`graphology-layout-forceatlas2`（共 ~250KB minified gz；通过 `React.lazy` 切到 `/knowledge-graph` 时才下载，**首屏不受影响**）

5. **Layout / 路由**：
   - `apps/web/src/components/Layout.tsx` 的 `NAV_MANAGE` 加项 "知识图谱"，位于"图谱洞察"和"内容治理"之间
   - `apps/web/src/App.tsx` 加 `<Route path="knowledge-graph" element={<KnowledgeGraph />} />`

6. **环境变量**（`.env.example` 追加）：
   ```
   KG_GRAPH_MAX_NODES=800
   KG_GRAPH_MAX_EDGES=3000
   KG_GRAPH_FORCE_ATLAS_ITER=100
   ```

7. **可观测性**：结构化日志 `kg_graph_loaded{space_id, node_count, edge_count, truncated, duration_ms}`

8. **Insights 链接**：`/knowledge-graph` 顶部 stats bar 加链接 "查看 N 条洞察 →"，N 来自现有 `/api/insights?spaceId=N` 的 `isolated+bridges+surprises+sparse` 长度之和（v1 用单独 query，不嵌入抽屉）

## Out of Scope

- **Type / Community 双着色切换** —— 需要前端跑 Louvain 或 payload 带 `community_id`；推 v2
- **节点拖拽 / 位置缓存** —— 每次重布局，不持久化（v1 简单）
- **右侧 detail 面板** —— v1 仅 hover tooltip + 双击跳 `/assets/:id`
- **Insights 抽屉** —— stats bar 链接到 `/insights` 即可
- **跨 Space 全局视图** —— 防 ACL 泄露；推 v2 与 OQ-GI-FUTURE-1 合流
- **`/api/kg/graph?notebookId=N`** —— Notebook 级图视图；推 v2 与 OQ-GI-FUTURE-2 合流
- **替换 `DetailGraph.tsx`** —— per-asset 1-hop 视图保留，本 change 不动
- **AGE 老 Space 数据 backfill** —— v1 只读 + banner 提示，不改写图（避免 GET 带写副作用）
- **边的 hover 信息显示** —— sigma 默认不显示边 hover，写 reducer 工程量不值；v2 再说
- **graphology-layout-forceatlas2/worker（多线程）** —— 100 iter @ 800 nodes 主线程 < 500ms，OK；不引 worker 减 bundle

## Success Metrics

- `GET /api/kg/graph?spaceId=N` 冷启 p95 ≤ **800ms**（|V|=800, |E|=3000 极限）
- 前端 sigma 首次渲染 + ForceAtlas2 100 iter ≤ **500ms** 主线程（800 节点）
- bundle 增量：`/knowledge-graph` 路由懒加载 chunk ~250KB gz；**首屏 main bundle 增加 0KB**
- 匿名 → `401`；越权 Space → `403`；老 Space 无 AGE 数据 → `200 + empty:true`
- `pnpm -r exec tsc --noEmit` / `pnpm --filter qa-service test -- kgGraphView` 全绿
- `pnpm eval-recall eval/gm-liftgate32-v2.jsonl` recall@5 = 1.000（不改 RAG 链路，必须验证）
- qa-service 冷启 30s 内无 kgGraphView 相关错误（ADR-37）
