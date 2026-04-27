# Design: knowledge-graph-view

> Lock 阶段设计；Explore 全文在 `docs/superpowers/specs/knowledge-graph-view/design.md`，此处仅锁定技术抉择。

## 关键决策

### D-001 sigma.js + graphology + graphology-layout-forceatlas2
- **决策**：apps/web 加三个依赖，总 bundle ~250KB minified gz。
- **同源**：qa-service 已用 `graphology + graphology-communities-louvain`（ADR-41），前后端 graph 表示同构。
- **代码分割**：`React.lazy(() => import('./SigmaGraph'))` —— 用户访问 `/knowledge-graph` 时才下载，**主 bundle 增量 0KB**。
- **不引 worker**：`graphology-layout-forceatlas2/worker` 100 iter @ 800 nodes 主线程 < 500ms，多线程不值得加复杂度。

### D-002 新端点 `GET /api/kg/graph?spaceId=N` —— 不动既有 kg 路由
- 与 `/api/kg/assets/:id/neighbors` 并列，前者 per-Space、后者 per-asset。
- 鉴权：`requireAuth + enforceAcl({action:'READ', resource:{space_id}})`，与 graph-insights 同源。

### D-003 Payload 形态（渲染就绪，不是分析结构）
```typescript
interface GraphPayload {
  space_id: number
  generated_at: string         // ISO
  empty: boolean               // 老 Space 无 AGE 数据时 true
  hint?: 'space_not_in_graph'  // empty=true 时给前端的 banner 提示
  truncated: boolean
  stats: { node_count: number; edge_count: number }
  nodes: Array<{
    id: string                 // 'asset:N' | 'tag:NAME'
    label: string              // 显示名（已截 12 字符）
    type: string               // Asset.type | '_tag'
    degree: number             // 用于半径缩放
  }>
  edges: Array<{
    source: string             // node id
    target: string
    kind: 'CO_CITED' | 'HAS_TAG'
    weight?: number            // CO_CITED 才有
  }>
}
```

### D-004 渲染规模上限 + 截断策略
- env：`KG_GRAPH_MAX_NODES=800` / `KG_GRAPH_MAX_EDGES=3000`
- 加载流程：
  1. AGE 拉全 Space 子图 + HAS_TAG 边 + Tag 节点
  2. 计算每个 Asset 节点的度数（CO_CITED + HAS_TAG）
  3. 若 `nodes.length > MAX_NODES`：按 degree 降序保留 top-MAX_NODES 节点；过滤掉两端不全在保留集的边
  4. 若过滤后 `edges.length > MAX_EDGES`：按 weight 降序保留 top-MAX_EDGES
  5. `truncated = true`（任一被截）
- 前端：`truncated=true` 时顶部黄色 banner "图谱已截断，仅显示度数最高的 800 个节点"

### D-005 节点着色 by Asset.type
| Asset.type 模式 | 颜色 |
|---|---|
| `pdf` | `#0ea5e9` |
| `md` / `markdown` | `#10b981` |
| `docx` / `doc` | `#3b82f6` |
| `xlsx` / `xls` / `csv` / `ods` | `#f59e0b` |
| `pptx` / `ppt` | `#ef4444` |
| `png` / `jpg` / `jpeg` / `gif` / `webp` / `svg` / `image*` | `#a855f7` |
| `url` / `web` / `html` | `#06b6d4` |
| 其它 / unknown | `#94a3b8` |
| `_tag`（Tag 节点） | `#fbbf24` |

色板与 `DetailGraph.tsx KIND_COLOR` 不冲突：DetailGraph 按 `kind`（asset/source/tag/...）配色，本 change 按 `Asset.type`（pdf/md/...）配色，两个视图语义不同、各管各的。

### D-006 Hover 行为（sigma reducers）
```typescript
sigma.setSetting('nodeReducer', (node, attrs) => {
  if (!hoveredNode) return attrs
  const isHovered = node === hoveredNode
  const isNeighbor = neighbors.has(node)
  if (!isHovered && !isNeighbor) return { ...attrs, color: '#e5e7eb', label: '' }
  return attrs
})
sigma.setSetting('edgeReducer', (edge, attrs) => {
  if (!hoveredNode) return attrs
  const inv = graph.extremities(edge).includes(hoveredNode)
  return inv ? { ...attrs, color: '#10b981', size: (attrs.size ?? 1) + 1 } : { ...attrs, hidden: true }
})
```

### D-007 节点点击行为（OQ-KGV-1 锁定）
- 单击：弹 HoverTooltip 内容到固定位置（`pinned`），含 label/type/degree/asset_id
- 双击：`navigate('/assets/' + assetId)` —— 仅 `asset:N` 节点；Tag 节点双击 noop
- 实现：sigma `clickNode` 事件 + 自维护 `lastClickAt` 判定

### D-008 老 Space 处理（OQ-KGV-4 锁定）
- 路由先查 `MATCH (sp:Space {id: $spid}) RETURN sp.id`
  - 无返回：`200 + {empty:true, hint:'space_not_in_graph', nodes:[], edges:[]}`
  - **不**lazy fix（不带写副作用）
- 前端 `empty:true` 时显示 banner："此 Space 在知识图谱中暂无数据。请重新 ingest 一份资料以触发图谱写入。"
- ADR-42 要登记一条 OQ：未来要不要做 backfill change

### D-009 ForceAtlas2 参数
```typescript
forceAtlas2.assign(graph, {
  iterations: KG_GRAPH_FORCE_ATLAS_ITER, // 默认 100
  settings: {
    gravity: 1,
    scalingRatio: 10,
    strongGravityMode: false,
    barnesHutOptimize: nodes.length > 200, // 大图开启 Barnes-Hut 加速到 O(n log n)
    barnesHutTheta: 0.5,
    adjustSizes: false,
  },
})
```

每次 mount 重布局，不缓存（NG5）。

### D-010 与 graph-insights 链接
- 顶部 stats bar 右侧加 `<Link to="/insights">查看 N 条洞察 →</Link>`
- N 通过独立的 `useQuery(['insights-count', spaceId], () => insightsApi.get(spaceId).then(p => p.isolated.length + ...))` 拿
- 失败/未启用：链接显示但 N 占位 `?`

## 不变更

- `services/knowledgeGraph.ts`（AGE 写入侧）
- `services/graphInsights/*`（洞察统计）
- `routes/insights.ts`
- `apps/web/src/knowledge/Insights/*`
- `apps/web/src/knowledge/Assets/DetailGraph.tsx`（保留 SVG 环形）
- AGE schema（ADR-27 冻结）
- pgvector / RAG 链路

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| R1 大图卡顿 | D-004 截断；D-009 Barnes-Hut |
| R4 bundle | React.lazy 代码分割 |
| R5 Source/Space 节点污染 | v1 不渲染（只 Asset + Tag） |
| R6 老 Space 无 AGE 数据 | D-008 banner 提示，不强制 backfill |
