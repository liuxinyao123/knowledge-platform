# knowledge-graph-view · Explore 阶段设计草稿

> 工作流 B · Step 1。Explore 产物，**不进主分支**。Lock 阶段会被 `openspec/changes/knowledge-graph-view/design.md` 替代。
> 来源：用户截图 llm_wiki Knowledge Graph 视图（GPL-3，仅借概念，不引源代码）

## 0. 背景

ADR-27 把 AGE 写入侧（5 节点 / 5 边）跑通；ADR-41 把"算法层洞察"用文本卡片暴露在 `/insights`；但**全图可视化**仍只有 `DetailGraph.tsx` 的 per-asset 720×360 SVG 环形（ADR-27 的初版交付物）。

用户要的是 llm_wiki 那种 **全 Space 力导向图**：sigma.js + ForceAtlas2 + 节点按类型着色 + hover 邻居高亮。

## 1. Goals / Non-Goals

### Goals（v1 MVP）
- G1. 新路由 `/knowledge-graph` —— 与 `/insights`、`/assets`、`/governance` 同级
- G2. 后端 `GET /api/kg/graph?spaceId=N` 返回完整 Space 子图（nodes + edges）
- G3. 前端用 sigma.js + graphology + graphology-layout-forceatlas2 渲染力导向布局
- G4. 节点按 `Asset.type`（pdf / md / docx / xlsx / png / url …）着色；半径按度数缩放
- G5. Hover 节点：邻居 + 邻边高亮，非邻居 dim 50%
- G6. 缩放控件（放大 / 缩小 / 适配屏幕）
- G7. 顶部 stats bar（nodes / edges / 上次刷新时间）+ 可选刷新按钮
- G8. ACL 同 graph-insights：`enforceAcl({action:'READ', resource:{space_id}})`

### Non-Goals（推 v2）
- NG1. Type / Community 切换着色（v2，需要前端跑 Louvain 或后端把 community_id 写进 payload）
- NG2. 社区图例（依赖 NG1）
- NG3. 右侧 detail 面板（点击节点弹出资产预览）—— v1 只 hover tooltip
- NG4. Insights N 徽章里嵌入 4 卡片 —— 顶部加链接跳 `/insights` 即可
- NG5. 节点拖拽 / 位置缓存
- NG6. 跨 Space 全局视图
- NG7. 替换 `DetailGraph.tsx` —— 它仍是 per-asset 1-hop 视图，本 change 不动

## 2. 上游 OpenSpec 依赖

| 依赖 | 状态 | 关系 |
|---|---|---|
| AGE schema（ADR-27） | 已锁 | 读 `:Asset / :Tag / CO_CITED / HAS_TAG` |
| Space 一级实体（ADR-26） | 已锁 | `enforceAcl resource={space_id:N}` |
| graph-insights（ADR-41） | Archived | 复用 `loadSpaceSubgraph`（loader.ts） |
| Permissions V2 | 已锁 | Viewer 角色门禁 |

## 3. 关键决策（待 Lock 阶段确认）

### D-001 选 sigma.js + graphology
- **决策**：apps/web 添加 `sigma`、`graphology`、`graphology-layout-forceatlas2` 三个依赖。
- **bundle 影响**：~250KB minified gz。在主 SPA 之外通过 `React.lazy(() => import('@/knowledge/KnowledgeGraph'))` 做代码分割，**首屏不受影响**。
- **备选被拒**：cytoscape（更重、API 与项目风格不合）、react-force-graph（依赖 three.js 反而更重）、自写 d3-force + SVG（工程量太大、ForceAtlas2 落地需自实现）。
- **同源**：qa-service 已用 `graphology + graphology-communities-louvain`，前后端 graph 表示同构。

### D-002 新端点 `GET /api/kg/graph?spaceId=N`
- 返回的 nodes/edges 是**渲染就绪**形态，不是分析结构。
- 与 `/api/insights` 正交：洞察是统计摘要，graph 是原始拓扑。

**Payload 形态**：
```jsonc
{
  "space_id": 12,
  "generated_at": "2026-04-25T...",
  "stats": { "node_count": 312, "edge_count": 1247 },
  "nodes": [
    { "id": "asset:103", "label": "架构总览.md", "type": "md", "degree": 8 },
    { "id": "tag:云原生", "label": "云原生", "type": "_tag", "degree": 5 }
  ],
  "edges": [
    { "source": "asset:103", "target": "asset:271", "kind": "CO_CITED", "weight": 4 },
    { "source": "asset:103", "target": "tag:云原生", "kind": "HAS_TAG" }
  ],
  "truncated": false
}
```

### D-003 渲染规模上限 + 截断策略
- `KG_GRAPH_MAX_NODES`（默认 800）+ `KG_GRAPH_MAX_EDGES`（默认 3000）
- 超限：按节点度数降序保留 top-N，标 `truncated:true`，前端 banner 提示
- 大图保护：浏览器力导向跑 1000+ 节点会卡，必须有上限

### D-004 节点着色 by Asset.type（v1）
| Asset.type | 颜色 | 备注 |
|---|---|---|
| pdf | `#0ea5e9` (blue) | 与 DetailGraph KIND_COLOR.source 同色调 |
| md | `#10b981` (green) | |
| docx / doc | `#3b82f6` (deep blue) | |
| xlsx / xls / csv | `#f59e0b` (amber) | |
| pptx / ppt | `#ef4444` (red) | |
| png / jpg / image | `#a855f7` (purple) | |
| url / web | `#06b6d4` (cyan) | |
| 其他 | `#94a3b8` (slate) | unknown 兜底 |
| `_tag`（Tag 节点专用） | `#fbbf24` (light amber) | 与资产类型色调差异化 |

### D-005 ForceAtlas2 + 节点位置稳定化
- mount 时 `forceAtlas2(graph, { iterations: 100, settings: ... })` 同步跑完
- `graphology-layout-forceatlas2/worker` v1 不引（多线程 bundle 更重；100 iters @ 800 nodes 在主线程 < 500ms）
- 位置不缓存（NG5）；每次进页面重布局；ACL 安全（不泄露上次别 user 看到的布局）

### D-006 Hover 行为
- 鼠标悬停某节点 N：
  - N 与其邻居：`highlight = true`，正常 alpha 1.0
  - 其它节点：alpha 0.2
  - 入边/出边连接到 N 的：粗细 +1px、绿色高亮
- 离开后恢复
- 通过 sigma 的 `enterNode` / `leaveNode` 事件 + reducer

### D-007 ACL 与多 Space
- `GET /api/kg/graph?spaceId=N`：Viewer 门禁
- payload 里 nodes 的 `id` 含 `asset:N`；前端点击节点要走 `/api/assets/:id` 标准路由（二次 ACL，纵深防御）
- v1 不做"无 spaceId 全局视图"

### D-008 与 graph-insights 的关系
- 顶部 stats bar 加一个**指向 `/insights` 的链接** "查看 N 条洞察"
- N = 调 `/api/insights?spaceId=N` 拿 isolated/bridges/surprises/sparse 长度之和
- v1 不做 Insights 抽屉嵌入（NG4）

## 4. 架构草图

```
apps/web
└─ knowledge/KnowledgeGraph/
   ├─ index.tsx           # 页面：Space 选择 + stats bar + sigma 容器
   ├─ SigmaGraph.tsx      # sigma.js 渲染容器（lazy loaded）
   ├─ NodeLegend.tsx      # 类型颜色图例
   ├─ HoverTooltip.tsx    # 浮于 sigma canvas 上方的 tooltip
   └─ types.ts            # GraphPayload 类型

apps/web/src/api/kg.ts      # 追加 getKgGraph(spaceId)（已有 getAssetNeighbors）

apps/qa-service
└─ services/graphInsights/loader.ts        # 复用已有 loadSpaceSubgraph
└─ services/kgGraphView/loader.ts          # 新：加 source/space/tag 节点（loadSpaceSubgraph 只返 asset+tag），返渲染就绪 payload
└─ routes/kg.ts                            # 追加 GET /graph
```

## 5. 风险

| # | 风险 | 级别 | 缓解 |
|---|------|------|------|
| R1 | sigma.js 在大图（>800 nodes）卡顿 | 🔴 | D-003 上限 + 截断 |
| R2 | ForceAtlas2 收敛差时节点重叠 | 🟡 | iterations=100 + scaling 微调；超大图自动 iter 减半 |
| R3 | 标签字符宽度差异大（中英文 + emoji） | 🟢 | sigma 默认 Canvas 渲染 OK，必要时 ellipsis 截 12 字符 |
| R4 | bundle +250KB 影响首屏 | 🟡 | `React.lazy` 代码分割，仅在用户访问 `/knowledge-graph` 时下载 |
| R5 | AGE 拉子图含 Source/Space 节点会显得很乱 | 🟡 | v1 只渲染 Asset + Tag + CO_CITED + HAS_TAG；Source/Space 不进图 |
| R6 | 老 Space 没 `linkSpaceSource` 写入 AGE | 🔴 | 路由先查"该 Space 在 AGE 是否有 :Space 节点"；没有给 banner 引导用户重 ingest |

## 6. Open Questions（Lock 前要确认）

- **OQ-KGV-1**：节点点击行为？v1 弹 tooltip 即可，还是直接跳 `/assets/:id`？建议 v1 = tooltip + 双击跳。
- **OQ-KGV-2**：边的 hover 信息要不要显示？sigma 默认不显示，要写 reducer。建议 v1 不做。
- **OQ-KGV-3**：`KG_GRAPH_MAX_NODES` 默认值 500 还是 800？
- **OQ-KGV-4**：要不要在 `linkSpaceSource` 缺失时由路由 lazy fix（现场补建 SCOPES 边）？建议**否**——会有写权限副作用，留 ADR 跟踪。

## 7. 下一步（Lock 阶段产物）

- `openspec/changes/knowledge-graph-view/proposal.md`
- `openspec/changes/knowledge-graph-view/design.md`（≤ 200 行）
- `openspec/changes/knowledge-graph-view/specs/knowledge-graph-view-spec.md`
- `openspec/changes/knowledge-graph-view/tasks.md`

Lock 前要敲定 OQ-KGV-1~4。
