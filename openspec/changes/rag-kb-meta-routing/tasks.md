# Tasks · D-002.2 RAG kb_meta 路由 asset_catalog

## B-1 Explore (✅ Done)
- [x] EXP-1 / docs/superpowers/specs/rag-kb-meta-routing/design.md

## B-2 OpenSpec Lock (✅ Done)
- [x] OS-1 / proposal.md
- [x] OS-2 / specs/kb-meta-handler-spec.md
- [x] OS-3 / tasks.md（本文件）

## B-3 Execute
- [ ] BE-1 新建 apps/qa-service/src/services/kbMetaHandler.ts
  - [ ] BE-1a isObviousKbMeta 正则 + 单测 ≥ 14 case
  - [ ] BE-1b extractKbMetaKeywords + 单测
  - [ ] BE-1c queryAssetCatalog（PG SQL `name ILIKE ANY` + ACL filter + LIMIT 50）
  - [ ] BE-1d renderKbMetaAnswer（0 / ≤ 10 / > 10 三分支 + LLM 失败兜底）
  - [ ] BE-1e runKbMetaHandler 编排 + emit 完整 SSE 序列
  - [ ] BE-1f isKbMetaHandlerEnabled() env 守卫
- [ ] BE-2 修 apps/qa-service/src/services/ragPipeline.ts
  - [ ] BE-2a runRagPipeline 入口短路（isObviousKbMeta + enabled → runKbMetaHandler + return）
  - [ ] BE-2b generateAnswer 内档 B fallback（intent === 'kb_meta' → runKbMetaHandler + return）
- [ ] BE-3 单元测试 apps/qa-service/src/__tests__/kbMetaHandler.test.ts ≥ 18 case
- [ ] BE-4 `pnpm -C apps/qa-service test` 零回归
- [ ] BE-5 `npx tsc --noEmit` exit 0
- [ ] DOC-1 docs/superpowers/plans/rag-kb-meta-routing-impl-plan.md 倒推
- [ ] EVAL-1 修 eval/multidoc-set.jsonl 两处占位错（sop-中英 expected_asset_ids → [19]；cn-fact pattern_type → list）

## B-4 Verify (用户在 macOS)
- [ ] V-1 重启 qa-service（确保 KB_META_HANDLER_ENABLED 默认 on 生效）
- [ ] V-2 `node scripts/eval-multidoc.mjs --doc-type classical_chinese` → kbmeta-test PASS
- [ ] V-3 `node scripts/eval-multidoc.mjs --doc-type table_xlsx` → V3D PASS
- [ ] V-4 `node scripts/eval-multidoc.mjs` 全集 → kb_meta intent 通过率 0/2 → 2/2，整体 must_pass 5/5 不掉
- [ ] V-5 KB_META_HANDLER_ENABLED=false 重跑 → 退回老行为（V3D 仍 fail，证明开关有效）

## Archive (B-4 验证通过后)
- [ ] AR-1 docs/superpowers/specs/rag-kb-meta-routing/ → archive/
- [ ] AR-2 看板 Done
- [ ] AR-3 合并 PR；kbMetaHandler 公共 API freeze
- [ ] AR-4 通知下游：D-002.4 资产细粒度 filter 可继承 queryAssetCatalog
