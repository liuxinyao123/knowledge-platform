# ARCHIVED — graph-insights

- **Archived at**: 2026-04-25（Verify 完成后用户填实际日期）
- **ADR**: `.superpowers-memory/decisions/2026-04-25-41-graph-insights.md`
- **Progress Snapshot**: `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-25-graph-insights.md`
- **Verification**（用户本机 macOS · 待填）：
  - [ ] `pnpm --filter qa-service add graphology graphology-communities-louvain` 成功
  - [ ] `pnpm -r exec tsc --noEmit` clean in `apps/qa-service` · `apps/web`
  - [ ] `pnpm --filter qa-service test -- graphInsights` · **Tests <N> passed**（预期 ~35 case 全绿）
  - [ ] `pnpm dev:up` 冷启 30s · 日志无 graph-insights / AGE / pg 异常（ADR-37 纪律）
  - [ ] `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 = 1.000（无回归）—— 前提：qa-service 已在本机运行（脚本调 `/api/qa/ask`）
  - [ ] 冒烟：`curl http://localhost:3001/api/insights?spaceId=N` 返回 200 + payload shape 校验（端口随 `QA_BASE` env，默认 3001）
  - [ ] 前端冒烟：`/insights` 渲染四张卡片 + dismiss 乐观更新 + Deep Research 弹窗
- **Live contract**（frozen，后续扩展在此追加）: `openspec/changes/graph-insights/`
- **交付摘要**：
  - **Phase A · DB**：`pgDb.ts` 追加 `metadata_graph_insight_cache` + `metadata_graph_insight_dismissed` 两表 + FK + 索引（+59 行）
  - **Phase B · 图加载 + Louvain**：`services/graphInsights/loader.ts`（138 行，AGE Cypher 查 Space 子图 + PG 富化时间戳） + `louvain.ts`（86 行，graphology-communities-louvain 包装 + GraphTooLarge / LouvainFailure 错误类）
  - **Phase C · 四算法**：`isolated.ts` / `bridges.ts`（双口径：Louvain + HAS_TAG 回退） / `surprises.ts` / `sparse.ts` + `keys.ts`（稳定 sha256）（共 ~280 行）
  - **Phase D · 编排**：`config.ts`（11 个 env） + `cache.ts`（PG UPSERT + isFresh） + `dismissed.ts` + `index.ts`（编排器：TTL + signature + advisory lock + degrade）（共 ~330 行）
  - **Phase E · Deep Research**：`deepResearchPrompt.ts`（chatComplete + 模板兜底，~150 行）
  - **Phase F · 路由**：`routes/insights.ts`（5 个端点：GET/POST/POST refresh/POST dismiss/DELETE dismiss/POST topic + health，~210 行）+ `index.ts` 挂载
  - **Phase G · env**：`.env.example` 追加 11 个 `GRAPH_INSIGHTS_*`
  - **Phase H · 前端**：`api/insights.ts` typed client + `knowledge/Insights/` 9 个组件（index + 4 Cards + MiniGraph + DismissButton + DeepResearchDialog）+ `Layout.tsx` nav + `App.tsx` 路由（共 ~720 行）
  - **Phase I · 测试**：`graphInsights.algo.test.ts`（18 case） + `graphInsights.cache.test.ts`（8 case） + `graphInsights.routes.test.ts`（9 case）共 35 case
- **已裁剪进 Phase L（follow-up）**：
  1. **Notebook 级洞察**（OQ-GI-FUTURE-2）—— v1 严格按 Space 分片
  2. **跨 Space 全局视图**（OQ-GI-FUTURE-1）—— v1 不做（防 ACL 泄露）
  3. **Dismissed 列表管理 UI**（OQ-GI-FUTURE-3）—— "我关掉的 N 条" 反向恢复入口
  4. **历史趋势 / 时间序列**——v1 只快照
  5. **主动通知**（邮件 / 站内信）——v1 用户进页面才看到
  6. **MiniGraph 升级到交互式**（缩放 / 悬停高亮）——v1 静态 SVG 64×64 即可
  7. **Louvain 增量算法**——v1 全量重算 + advisory lock 兜并发
  8. **`pnpm eval-graph-insights`**（覆盖率 / 算法准确率金标集）——等真实数据 ≥ 200 节点再立项
  9. **DetailGraph 反链"在洞察中查看"**——v2 议题
- **关联 ADR**：
  - 上游：ADR-27（AGE schema） / ADR-26（Space 一级实体 + ACL） / ADR-33（OAG Phase 1，runRagPipeline 集成点） / ADR-37（ts-strip-types 纪律） / ADR-39（WeKnora 借鉴 + 项目纪律范本）
  - 下游：暂无
