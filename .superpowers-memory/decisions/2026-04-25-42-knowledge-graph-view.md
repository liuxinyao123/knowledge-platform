# ADR 2026-04-25-42 — Knowledge Graph View · 全 Space 力导向可视化

> 工作流 B · `superpowers-openspec-execution-workflow`。
> 契约：`openspec/changes/knowledge-graph-view/{proposal,design,tasks}.md + specs/knowledge-graph-view-spec.md`
> 归档：`docs/superpowers/archive/knowledge-graph-view/`
> 关联 Open Question：新增 `OQ-KGV-FUTURE-1`（老 Space backfill 触发条件）
> 上游：ADR-27（AGE schema）/ ADR-26（Space + ACL）/ ADR-37（TS 纪律）/ ADR-41（graph-insights，复用 loader 模式 + insights 链接）
> 来源：用户截图 llm_wiki Knowledge Graph 视图（GPL-3，仅借概念，不引源代码）

## Context

ADR-27 把 AGE 写入跑通；ADR-41 把统计型洞察以文本卡片暴露在 `/insights`；但**全图可视化**仍只有 `DetailGraph.tsx` 720×360 SVG 环形（per-asset 1-hop）。用户参考 llm_wiki Knowledge Graph 视图要一个**全 Space 力导向图**：sigma.js + ForceAtlas2 + 节点按 Asset.type 着色 + hover 邻居高亮。

合规边界：与 ADR-41 同——**只读 README 的概念，不引 llm_wiki 任何 .ts/.tsx 源码**；着色板、迭代次数、布局参数、交互逻辑全部从公开描述重写。

## Decision

### D-001 选 sigma.js + graphology + graphology-layout-forceatlas2
- **决策**：apps/web 加三个依赖；总 ~250KB minified gz；通过 `React.lazy(() => import('./SigmaGraph'))` 切独立 chunk，**主 bundle 增量 0KB**。
- **同源**：qa-service 已用 `graphology + graphology-communities-louvain`（ADR-41），前后端 graph 表示同构、心智一致。
- **备选被拒**：cytoscape.js（更重）、react-force-graph（依赖 three.js 反而更大）、自写 d3-force（工程量过大）。
- **不引 worker**：100 iter @ 800 nodes 主线程 < 500ms，多线程不值得加复杂度（现 NG）。

### D-002 新端点 `GET /api/kg/graph?spaceId=N`，与既有 `/api/kg/*` 并存
- 与 `/api/kg/assets/:id/neighbors`（per-asset）正交，前者面向 per-Space 渲染；
- 鉴权：`requireAuth + enforceAcl({action:'READ', resource:{space_id}})`（ADR-26 同款）；
- 与 `/api/insights` 也正交：本端点是原始拓扑、那个是统计摘要。

### D-003 渲染就绪 payload，不是分析结构
```typescript
GraphPayload = { space_id, generated_at, empty, hint?, truncated, stats, nodes[], edges[] }
GraphNode    = { id: 'asset:N' | 'tag:NAME', label, type, degree }
GraphEdge    = { source, target, kind: 'CO_CITED' | 'HAS_TAG', weight? }
```
节点 id 用类型前缀避免碰撞；标签后端截 12 字符 + 省略号，前端不再处理。

### D-004 渲染规模上限 + 截断策略
- env：`KG_GRAPH_MAX_NODES=800` / `KG_GRAPH_MAX_EDGES=3000`
- 节点：按 degree 降序保留 top-N；资产优先，tag 顶到剩余预算
- 边：先过滤"两端都在保留集"，再按 weight 降序截到 maxEdges；HAS_TAG 视 weight=0.5 劣后于 CO_CITED
- 任一被截 `truncated:true`，前端黄色 banner 提示

### D-005 节点着色 by Asset.type，与 DetailGraph KIND_COLOR 不冲突
8 类文件型 + 1 个 `_tag`：pdf/md/docx/xlsx/pptx/image/url/other + tag。色板与 DetailGraph 按 kind 配色独立（kind 是节点类别 asset/source/tag/...，type 是文件格式 pdf/md/...）。

### D-006 Hover 行为通过 sigma reducer
- 鼠标悬停节点 N：N + 邻居 alpha 1.0；其他节点 dim 至 `#e5e7eb` 并隐藏标签
- 涉及 N 的边变成绿色加粗；其他边 hidden:true
- 离开后清空 hovered，refresh 一次

### D-007 节点点击行为（OQ-KGV-1）
- 单击：tooltip pinned，含 label/type/degree/asset_id
- 双击：仅 `asset:N` 节点 → `navigate('/assets/N')`；Tag 节点双击 noop
- 实现：sigma `clickNode` + 自维护 `lastClickRef`，350ms 内同一节点二次单击视为双击

### D-008 老 Space 处理（OQ-KGV-4）—— banner 引导，不写副作用
- 路由先查 `MATCH (sp:Space {id:$spid}) RETURN sp.id LIMIT 1`
- 无返回：`200 + {empty:true, hint:'space_not_in_graph'}`，前端显示 banner "请重新 ingest 一份资料以触发图谱写入"
- **不**做 lazy fix（不让 GET 带写副作用）；登记 OQ-KGV-FUTURE-1 跟踪 backfill change 的触发条件

### D-009 ForceAtlas2 参数
```typescript
forceAtlas2.assign(graph, {
  iterations: 100,
  settings: {
    gravity: 1, scalingRatio: 10, strongGravityMode: false,
    barnesHutOptimize: nodes > 200, barnesHutTheta: 0.5, adjustSizes: false,
  },
})
```
每次 mount 重布局，不缓存（NG5）。

### D-010 与 graph-insights 链接
- stats bar 右侧加 `<Link to="/insights">查看 N 条洞察 →</Link>`
- N 通过独立 useQuery 调 `/api/insights?spaceId=N` 拿，失败则显 `?` 占位
- 不抽屉嵌入（v1 NG，避免 modal-in-modal 心智）

## Consequences

### 正向

- 用户首次有了**全 Space 拓扑视图**；之前的 DetailGraph 是 per-asset 1-hop，看不到整体结构
- 与 ADR-41 graph-insights 形成 "拓扑 + 统计" 双视图：一边看图、一边看洞察列表，stats bar 直链
- bundle 控制：sigma + graphology + ForceAtlas2 ~250KB 通过 React.lazy 切独立 chunk，主 bundle 增量 0KB；首屏不受影响
- 不改 AGE 写入侧 / RAG / hybridSearch / agent dispatch，零回归风险
- ADR-37 纪律严守：无 enum / parameter property / namespace / decorator
- 老 Space 在 AGE 无数据的情况有 graceful 引导，不强制 backfill

### 负向

- AGE 子图全量拉取：每次进页面都 4 次 Cypher（:Space exists / asset / CO_CITED / HAS_TAG），单次 ~50–200ms 视图规模而定。v1 不缓存（与 graph-insights 缓存策略不同）；高频访问场景可能要 v2 加缓存层
- ForceAtlas2 100 iter 在 800 节点上稳定，但 1500+ 节点会卡——D-004 截断兜底
- 节点位置不持久化，每次进页面重布局——风格上没法做"位置稳定"，仅靠 ForceAtlas2 收敛性
- 老 Space backfill 缺位：OQ-KGV-FUTURE-1 跟踪
- Web 端测试基础设施空白：项目历史未写过 .test.tsx；本 change 仅写 colors 纯函数 test，更高层测试待 Web 测试体系建立后补
- bundle gzipped ~80KB（lazy chunk）—— 用户首次访问 `/knowledge-graph` 有一次性下载延迟

### 归档后副本与活契约的差异治理

- 归档副本 = 完成时刻快照，**不再修改**
- 活契约 `openspec/changes/knowledge-graph-view/` 保留供下游引用；扩展（如 OQ-KGV-FUTURE-1 立项）须新开 change 引用本 ADR-42
- 与 ADR-41 同模式

## 代码清单

### 新增（apps/qa-service · 5 文件）

- `services/kgGraphView/{types,config,loader}.ts`（~290 行）
- `__tests__/kgGraphView.{loader,routes}.test.ts`（共 12 case）

### 新增（apps/web · 5 文件）

- `knowledge/KnowledgeGraph/{index,SigmaGraph,NodeLegend,HoverTooltip}.tsx + colors.ts`（~470 行）
- `knowledge/KnowledgeGraph/__tests__/colors.test.ts`（9 case）

### 修改

- `apps/qa-service/src/routes/kg.ts` —— +50 行（新 GET /graph 路由 + 鉴权链）
- `apps/qa-service/.env.example` —— +6 行（3 env 含注释）
- `apps/web/src/api/kg.ts` —— +33 行（KgGraph* 类型 + getKgGraph）
- `apps/web/src/App.tsx` —— +2 行（import + Route）
- `apps/web/src/components/Layout.tsx` —— +9 行（icon + NAV_MANAGE 项）
- `apps/web/package.json` —— 待用户运行 `pnpm --filter web add sigma graphology graphology-layout-forceatlas2`

### 不动

- `services/knowledgeGraph.ts`（AGE 写入侧）
- `services/graphInsights/*`（洞察统计；本 change 仅链接到 `/insights`）
- `routes/insights.ts`
- `apps/web/src/knowledge/Insights/*`
- `apps/web/src/knowledge/Assets/DetailGraph.tsx`（per-asset 1-hop 保留）
- AGE schema（ADR-27 冻结）
- pgvector / RAG 链路

## Links

- 上游 README：https://github.com/nashsu/llm_wiki/blob/main/README_CN.md（GPL-3）
- 关联 ADR：
  - ADR-27 `knowledge-graph-age` —— AGE schema 物质基础
  - ADR-26 `space-permissions-lock` —— ACL 投影
  - ADR-37 `ts-strip-types-discipline` —— 本 change 所有新代码遵守
  - ADR-41 `graph-insights` —— 复用 loader 模式（CO_CITED+HAS_TAG 拉取） + insights 链接 + 同源用户旅程
- 衍生 Open Questions：`OQ-KGV-FUTURE-1`（老 Space AGE backfill 触发条件，见 `.superpowers-memory/open-questions.md`）
