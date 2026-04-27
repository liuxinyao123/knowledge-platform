# PROGRESS SNAPSHOT — 2026-04-25 · knowledge-graph-view

> 工作流 B 第二轮（紧接 graph-insights 后）：Explore → Lock → Execute → Archive。
> 上下游关系一览见 ADR-42 §Links。

## §一 · 起因

用户在 graph-insights 上线后发了一张 llm_wiki Knowledge Graph 截图："我想要这个"。该图是 llm_wiki 主视图：左 nav + 中央力导向图 + 右侧 detail 面板 + 顶部 Type/Community/Insights 9 切换。

诚实评估后给用户分级：
- v1（推荐）：力导向 + Asset.type 着色 + hover 高亮 ← 选定
- v2：Type/Community 双着色切换、社区图例
- v2+：右侧 detail 面板、Insights 抽屉、节点拖拽位置缓存

核心约束：与 ADR-41 同——**只看 README 概念，不引 llm_wiki 源代码**。色板、迭代次数、布局参数、交互逻辑全部公开描述级重写。

## §二 · 工作流四步执行

### Step 1 · Explore

- 扫了 `DetailGraph.tsx`（per-asset SVG 环形）+ `routes/kg.ts`（仅 `/status` / `/assets/:id/neighbors` / `/cypher`）+ `apps/web/package.json`（零图库）
- 关键发现：
  - apps/web 没装任何图库 → 必须新引依赖 + 必须 React.lazy 控 bundle
  - qa-service 已有 `graphInsights/loader.ts` 拉 Space 子图，但输出面向**算法**；需要并存一套**面向渲染**的 loader
  - DetailGraph.tsx 按 `kind`（asset/source/...）配色；本 change 按 `Asset.type`（pdf/md/...）配色 → 两套色板互不冲突
- 4 条 OQ 用户当场拍板：800 上限 / 双击跳转 / banner 引导（不 lazy fix）/ 边 hover v1 不做

### Step 2 · Lock

- 4 个 OpenSpec 文件落到 `openspec/changes/knowledge-graph-view/`
- D-001~D-010 十条决策；payload shape 一锤定型；Phase A–G 任务清单 30+ 条

### Step 3 · Execute

后端（5 文件 + 3 处改动）：
- `services/kgGraphView/{types,config,loader}.ts`：~290 行，与 graphInsights/loader 平行但输出 GraphPayload，截断算法**资产优先 + 边按 weight**
- `routes/kg.ts` 追加 `GET /graph` + `enforceAcl` 鉴权链
- `__tests__/kgGraphView.{loader,routes}.test.ts`：12 case（empty/happy/截断/越权/老 Space 等全覆）
- `.env.example` +6 行（3 env）

前端（5 文件 + 3 处改动）：
- `knowledge/KnowledgeGraph/{index,SigmaGraph,NodeLegend,HoverTooltip}.tsx + colors.ts`：~470 行
- `SigmaGraph.tsx` 通过 `React.lazy` 切独立 chunk —— 主 bundle 增量 0KB
- `api/kg.ts` 追加 `getKgGraph` + 新类型
- `Layout.tsx` 加 `Ico.kgGraph` 自绘 SVG icon 和 NAV_MANAGE 第二项
- `App.tsx` +2 行
- `__tests__/colors.test.ts`：9 case 覆盖所有色板分支（ADR-37 纪律层守严）

### Step 4 · Verify（待用户本机执行）

ARCHIVED.md 列了 9 项 checkbox。最关键三条：
1. `pnpm --filter web add sigma graphology graphology-layout-forceatlas2`
2. `pnpm -r exec tsc --noEmit` 全绿（潜在风险：vite 与 NodeNext 对 sigma 的 default import interop，若需用 createRequire 回退）
3. `pnpm --filter web build` 后看 sigma 那块是不是单独 chunk（`du -sh apps/web/dist/assets/*.js | sort -rh`）

## §三 · 关键决策回顾

| ADR-42 编号 | 决策 | 理由 |
|---|---|---|
| D-001 | sigma + graphology + forceatlas2 | bundle 同源 ADR-41；React.lazy 控制首屏 |
| D-002 | 新端点 `GET /api/kg/graph` 与既有 `/api/kg/*` 并存 | 不耦合 per-asset 视图 |
| D-003 | 渲染就绪 payload | 节点 id 类型前缀防碰撞；标签后端截 |
| D-004 | 800/3000 上限 + 资产优先截断 | 大图保护 |
| D-005 | Asset.type 8 色板 + Tag 单独色 | 与 DetailGraph KIND_COLOR 不冲突 |
| D-006 | sigma reducer 实现 hover dim | 无需 DOM 重渲染 |
| D-007 | 双击跳 /assets/:id | OQ-KGV-1 选定 |
| D-008 | 老 Space banner 引导，**不**lazy fix | OQ-KGV-4 选定，避免 GET 写副作用 |
| D-009 | ForceAtlas2 100 iter + Barnes-Hut for >200 | 800 节点 < 500ms |
| D-010 | stats bar 链接到 /insights | 与 ADR-41 通过链接互通，不抽屉嵌入 |

## §四 · 衍生 Open Questions

新增 1 条 `OQ-KGV-FUTURE-1`（AGE 老 Space backfill 触发条件）。仍开放的旧 OQ 不变。

## §五 · 复盘要点

- **流程纪律持续起作用**：用户给图后第一反应是 "我要这个"——ADR-39/41 范式让我没直接动手，而是评估了"这是新 change scope"、用 4 个 AskUserQuestion 把 v1 边界拆清。否则会卡在"v1 应该多大"上。
- **同期项目能复用大量基础设施**：`graphInsights/loader.ts` 的 Cypher 模式 + `enforceAcl({resource:{space_id}})` 鉴权模式 + `services/llm.ts` 的 chatComplete + `auth/index.ts` 的 mock 模板 + `routes/insights.ts` 的错误处理模板，全部直接照搬到 kgGraphView 里。Phase A–E 的"看上去重复"工作其实是项目积累在变现。
- **bundle 控制是真问题**：sigma + graphology + forceatlas2 ~250KB，Vite 默认会进 main bundle。`React.lazy` + `Suspense` 把它切到单独 chunk 是 v1 必做。Phase F 验收里有一条 `du -sh dist/assets/*.js`，这个数据点比 tsc 全绿更重要。
- **GPL-3 合规的工艺已经稳定**：连续两个 ADR（41、42）都"概念级重写、不引源代码"，色板/参数/交互逻辑全部自定。这个范式可以作为未来借鉴第三方项目的标准做法。
- **DetailGraph 与新视图的边界**：刻意不替换 DetailGraph.tsx；它仍是 per-asset 1-hop 视图。**两个视图各有用途**：知识图谱看全局、DetailGraph 看局部。前者按 type 配色、后者按 kind 配色——色板独立避免心智错位。

## §六 · 不动清单

- AGE schema（ADR-27 冻结）
- pgvector / RAG 链路
- ragPipeline / hybridSearch / agent dispatch
- DetailGraph.tsx
- routes/insights.ts + apps/web/src/knowledge/Insights/*
- services/knowledgeGraph.ts（写入侧）
- services/graphInsights/*（仅通过 stats bar 链接互通）
