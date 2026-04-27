# ARCHIVED — knowledge-graph-view

- **Archived at**: 2026-04-25（Verify 完成后用户填实际日期）
- **ADR**: `.superpowers-memory/decisions/2026-04-25-42-knowledge-graph-view.md`
- **Progress Snapshot**: `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-25-knowledge-graph-view.md`
- **Verification**（用户本机 macOS · 待填）：
  - [ ] `pnpm --filter web add sigma graphology graphology-layout-forceatlas2` 成功
  - [ ] `pnpm -r exec tsc --noEmit` clean in `apps/qa-service` · `apps/web`
  - [ ] `pnpm --filter qa-service test -- kgGraphView` · **Tests <N> passed**（预期 ~12 case 全绿）
  - [ ] `pnpm --filter web test -- colors` · 9 case 全绿
  - [ ] `pnpm dev:up` 冷启 30s · 日志无 kgGraphView / AGE / pg 异常（ADR-37 纪律）
  - [ ] `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 = 1.000（无回归）
  - [ ] 冒烟：`curl http://localhost:3001/api/kg/graph?spaceId=N` 返回 200 + payload shape（含 nodes/edges/stats/empty/truncated）
  - [ ] 前端冒烟：`/knowledge-graph` 渲染力导向图 + Asset.type 着色 + hover 邻居高亮 + 双击跳 `/assets/:id`
  - [ ] bundle 检查：`pnpm --filter web build` 后 main bundle 不增；`du -sh apps/web/dist/assets/*.js | sort -rh | head -5` 看 sigma 那块单独成 chunk
- **Live contract**（frozen）: `openspec/changes/knowledge-graph-view/`
- **交付摘要**：
  - **Phase A · 后端**：`services/kgGraphView/{types,config,loader}.ts`（共 ~280 行；复用 graphInsights/loader 的 AGE Cypher 模式但输出渲染就绪 GraphPayload）+ `routes/kg.ts` 追加 `GET /graph`（+50 行）+ `.env.example` 追加 3 个 env
  - **Phase B · 后端测试**：`__tests__/kgGraphView.loader.test.ts`（6 case：empty / happy / 节点截断 / 边过滤 / 边按 weight 截 / label 截断）+ `__tests__/kgGraphView.routes.test.ts`（6 case：401/403/400/200/503/老 Space empty）
  - **Phase C · 前端依赖 + 模块**：`apps/web/src/knowledge/KnowledgeGraph/{index,SigmaGraph,NodeLegend,HoverTooltip,colors}.tsx`（~470 行；SigmaGraph 走 React.lazy 切独立 chunk）+ `api/kg.ts` 追加 `getKgGraph` typed client
  - **Phase D · 路由 + Layout**：`App.tsx` 加 Route + import；`Layout.tsx` 加 `Ico.kgGraph` SVG icon + NAV_MANAGE 第二项
  - **Phase E · 前端测试**：`__tests__/colors.test.ts`（9 case：所有色板分支）；index.tsx smoke test 略（项目无既有 web 测试基础设施）
- **已裁剪进 Phase L（follow-up）**：
  1. **Type / Community 双着色切换**（v2，需要前端跑 Louvain 或 payload 带 community_id）
  2. **节点拖拽 / 位置缓存**（v1 重布局）
  3. **右侧 detail 面板**（v1 仅 hover tooltip + 双击跳 `/assets/:id`）
  4. **Insights 抽屉嵌入**（v1 stats bar 链接到 `/insights`）
  5. **跨 Space 全局视图**（防 ACL 泄露；与 OQ-GI-FUTURE-1 合流）
  6. **Notebook 级图视图**（与 OQ-GI-FUTURE-2 合流）
  7. **AGE 老 Space 数据 backfill**（OQ-KGV-FUTURE-1 登记）
  8. **边的 hover 信息**（sigma reducer 不值；v2）
  9. **graphology-layout-forceatlas2/worker**（多线程 v2，主线程 100 iter @ 800 nodes 已够用）
  10. **替换 `DetailGraph.tsx`**（per-asset 1-hop 视图保留）
- **关联 ADR**：
  - 上游：ADR-27（AGE schema） / ADR-26（Space + ACL） / ADR-37（TS 纪律） / ADR-41（graph-insights，复用 loader 模式 + insights 链接）
  - 下游：暂无
