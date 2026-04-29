# Proposal · D-002.2 RAG kb_meta 路由 asset_catalog

## What

让 kb_meta 类问题（"我这库里有道德经吗"/"列出汽车工程相关的文档"）走 metadata_asset 表直查 + LLM 语义筛 + 列表渲染，绕过 retrieval/rerank/generateAnswer，修复 D-003 eval 的 V3D / kbmeta-test 两条 fail。

## Why

D-003 baseline 4 实测：

- `D003-V3D` "库里有哪些汽车工程相关的资料" → top-1 rerank 0.028 → short-circuit 兜底，**不到档 B**
- `D003-kbmeta-test` "我这库里有道德经吗" → 档 B 误判 factual_lookup（retrieval 命中相关注释 → 当成内容查）

共同根因：kb_meta 是**目录元查询**，不应该依赖内容相似度。retrieval 凉就被截断 / retrieval 命中就被当内容 ——两条路都错。

## What changes

1. **新增** `apps/qa-service/src/services/kbMetaHandler.ts`：
   - `isObviousKbMeta(question): boolean` —— 顶层规则前置（双锚定正则：目录前缀 + 文档名词）
   - `extractKbMetaKeywords(question): string[]` —— 抽 1-3 个 LIKE 关键词
   - `queryAssetCatalog({ keywords, sourceIds, limit }): Promise<AssetCatalogRow[]>` —— SQL `name ILIKE`
   - `runKbMetaHandler(question, emit, signal, opts): Promise<void>` —— 编排查询 + 渲染 + emit

2. **修改** `apps/qa-service/src/services/ragPipeline.ts`：
   - `runRagPipeline` 入口加短路：在 condenseQuestion 之前，`if (isObviousKbMeta(q) && KB_META_HANDLER_ENABLED) { await runKbMetaHandler(); return }`
   - `generateAnswer` 内部档 B 路径：`if (intent === 'kb_meta' && KB_META_HANDLER_ENABLED) { await runKbMetaHandler(question, emit, signal, { docs }); return }` —— 替代 buildKbMetaPrompt + LLM 流

3. **新增** env `KB_META_HANDLER_ENABLED`（默认 `true`）—— 关闭时回到老路径（buildKbMetaPrompt + 普通 LLM 流），方便回滚。

4. **新增** `apps/qa-service/src/__tests__/kbMetaHandler.test.ts`：
   - isObviousKbMeta 命中 ≥ 8 case（中英 / 短长 / 句首句尾）
   - isObviousKbMeta 不误伤 ≥ 6 case（"知识中台的核心模块有哪些"/"道德经的作者是谁"）
   - extractKbMetaKeywords 抽词正确性
   - queryAssetCatalog SQL 形状（mock pool）
   - 渲染含 `\.pdf|.xlsx|.md|.pptx|.docx` 后缀 + "找到以下"/"以下文档" 引导词

## Out of scope

- Top-level `AgentIntent` 不动（kb_meta 仍只在 answer-intent 层）
- 跨空间 / 跨用户检索
- 细粒度 filter（asset_type / ingest_status）

## Acceptance

- D003-V3D / D003-kbmeta-test 在 D-003 eval 里通过率从 0/2 → 2/2
- 现有 vitest 套件零回归
- env `KB_META_HANDLER_ENABLED=false` 完整回到老行为
