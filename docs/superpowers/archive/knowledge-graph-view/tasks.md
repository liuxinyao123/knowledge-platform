# Tasks: knowledge-graph-view

> 工作流 B · Lock 完成后 Execute。每条任务尽量原子；同 Phase 内可并行。
> ADR-37 纪律：无 enum / parameter property / namespace / decorator。

## Lock（已完成）

- [x] proposal.md / design.md / specs/*.md / tasks.md（本文件）
- [x] OQ-KGV-1（双击跳） / OQ-KGV-3（800 上限） / OQ-KGV-4（banner 提示）确认；OQ-KGV-2（边 hover）默认 v1 不做

## Phase A · 后端 loader + 路由

- [ ] 新增 `apps/qa-service/src/services/kgGraphView/loader.ts`：
  - [ ] `loadSpaceGraphForViz(spaceId, opts: { maxNodes; maxEdges }): Promise<GraphPayload>`
  - [ ] 流程：先查 `MATCH (sp:Space {id:$spid}) RETURN sp.id LIMIT 1` → 无返回直接给 empty payload
  - [ ] 拉 :Asset：`MATCH (sp:Space {id:$spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset) RETURN DISTINCT a.id, a.name, a.type`
  - [ ] 拉 CO_CITED：仅两端都在 Space 内（与 graphInsights/loader 同模式）
  - [ ] 拉 HAS_TAG + Tag：`MATCH (sp:Space {id:$spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)-[:HAS_TAG]->(t:Tag) RETURN a.id, t.name`
  - [ ] 计算 degree（CO_CITED + HAS_TAG），按 D-004 截断
  - [ ] 归一化输出 GraphPayload（详见 design.md §D-003）

- [ ] 修改 `apps/qa-service/src/routes/kg.ts`：
  - [ ] 追加 `GET /graph` 路由，参数 `spaceId`
  - [ ] `requireAuth + enforceAcl({action:'READ', resourceExtractor:(req)=>({space_id})})`
  - [ ] 调 `loadSpaceGraphForViz` 并返回；错误处理同 `routes/insights.ts`（503 `KG_UNAVAILABLE` / 503 `FEATURE_DISABLED` / 400 `SPACE_ID_REQUIRED`）

- [ ] `.env.example` 追加：
  ```
  KG_GRAPH_MAX_NODES=800
  KG_GRAPH_MAX_EDGES=3000
  KG_GRAPH_FORCE_ATLAS_ITER=100
  ```

## Phase B · 后端测试

- [ ] 新增 `apps/qa-service/src/__tests__/kgGraphView.loader.test.ts`：
  - [ ] mock runCypher → 给定合成数据，验证 nodes / edges 结构
  - [ ] 老 Space → empty payload
  - [ ] 节点超限 → 按 degree 截断
  - [ ] 边超限 → 按 weight 截断 + 两端必须在保留节点集

- [ ] 新增 `apps/qa-service/src/__tests__/kgGraphView.routes.test.ts`：
  - [ ] 401 / 403 / 400 / 200 happy path / 503 KG_UNAVAILABLE
  - [ ] payload shape 校验（每节点字段、每边字段）

## Phase C · 前端依赖 + 模块脚手架

- [ ] `pnpm --filter web add sigma graphology graphology-layout-forceatlas2`
- [ ] 新增 `apps/web/src/api/kg.ts` 追加 `getKgGraph(spaceId): Promise<GraphPayload>`
- [ ] 新增 `apps/web/src/knowledge/KnowledgeGraph/`：
  - [ ] `types.ts` —— GraphPayload 等类型（与后端等价）
  - [ ] `index.tsx` —— 主页面：Space 选择器 + stats bar + banner（empty / truncated）+ `<React.lazy SigmaGraph />`
  - [ ] `SigmaGraph.tsx` —— sigma 容器；ForceAtlas2 100 iter；nodeReducer / edgeReducer for hover
  - [ ] `NodeLegend.tsx` —— 类型颜色图例（pdf/md/docx/xlsx/pptx/image/url/other + tag）
  - [ ] `HoverTooltip.tsx` —— sigma canvas 上方浮窗
  - [ ] `colors.ts` —— Asset.type → 颜色映射（design.md §D-005）

## Phase D · 路由 + Layout

- [ ] `apps/web/src/App.tsx` 追加：
  - [ ] `import KnowledgeGraph from '@/knowledge/KnowledgeGraph'`（注意 KnowledgeGraph 内部用 React.lazy 包 SigmaGraph）
  - [ ] `<Route path="knowledge-graph" element={<KnowledgeGraph />} />`
- [ ] `apps/web/src/components/Layout.tsx`：
  - [ ] `Ico.knowledgeGraph` 新增 SVG 图标（与 `Ico.insights` 风格匹配）
  - [ ] `NAV_MANAGE` 在"图谱洞察"和"内容治理"之间插入 `{to:'/knowledge-graph', label:'知识图谱', icon:Ico.knowledgeGraph}`

## Phase E · 前端测试

- [ ] `apps/web/src/knowledge/KnowledgeGraph/__tests__/colors.test.ts`：
  - [ ] Asset.type 枚举 → 期望颜色（pdf/md/docx/xlsx/pptx/image/url/unknown）
- [ ] `apps/web/src/knowledge/KnowledgeGraph/__tests__/index.test.tsx`：
  - [ ] empty payload 显示 banner
  - [ ] truncated 显示黄色 banner
  - [ ] non-empty 触发 SigmaGraph lazy load（mock 之）

## Phase F · 验收

- [ ] 本机 `pnpm install` 成功（sigma + graphology + graphology-layout-forceatlas2）
- [ ] `pnpm -r exec tsc --noEmit` 全绿
- [ ] `pnpm --filter qa-service test -- kgGraphView` 全绿
- [ ] `pnpm --filter web test -- KnowledgeGraph` 全绿
- [ ] `pnpm dev:up` 冷启 30s 无错误（ADR-37）
- [ ] `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 = 1.000（不改 RAG，验证）
- [ ] 浏览器手测：
  - [ ] `/knowledge-graph` 路由 200 渲染
  - [ ] 力导向布局节点不重叠
  - [ ] hover 节点邻居高亮 + 非邻居 dim
  - [ ] 双击 asset 节点跳 `/assets/:id`
  - [ ] 顶部 "查看 N 条洞察" 链接跳 `/insights`
- [ ] bundle size 检查：`pnpm --filter web build` 后 main bundle 不增（lazy chunk 单独）
  - 命令参考：`du -sh apps/web/dist/assets/*.js | sort -rh | head -5`

## Phase G · 归档

- [ ] 复制 `openspec/changes/knowledge-graph-view/{proposal,design,tasks,specs}/...` → `docs/superpowers/archive/knowledge-graph-view/`
- [ ] 新增 `ARCHIVED.md`（含 verification checkboxes）
- [ ] 新增 ADR：`.superpowers-memory/decisions/2026-04-25-42-knowledge-graph-view.md`
- [ ] `MEMORY.md` 索引更新（日期维度 + 主题维度 + 未解问题）
- [ ] `open-questions.md` 新增 `OQ-KGV-FUTURE-1`（AGE 老 Space backfill 触发条件）+ 已关闭表追加本 change
- [ ] PROGRESS-SNAPSHOT-2026-04-25-knowledge-graph-view.md（与 graph-insights snapshot 同模板）

## 不动

- `services/knowledgeGraph.ts`（AGE 写入侧）
- `services/graphInsights/*`
- `routes/insights.ts`
- `apps/web/src/knowledge/Insights/*`
- `apps/web/src/knowledge/Assets/DetailGraph.tsx`
- AGE schema（ADR-27 冻结）
- pgvector / RAG 链路
