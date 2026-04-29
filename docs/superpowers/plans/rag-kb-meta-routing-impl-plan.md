# Impl Plan · D-002.2 RAG kb_meta 路由 asset_catalog

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B-3）
> OpenSpec：`openspec/changes/rag-kb-meta-routing/`
> Explore：`docs/superpowers/specs/rag-kb-meta-routing/design.md`

## 已完成清单

| Task | 文件 | 改动 |
|---|---|---|
| BE-1 | `apps/qa-service/src/services/kbMetaHandler.ts`（新建，~270 行） | isObviousKbMeta 双锚定正则；extractKbMetaKeywords 反复剥前后缀；queryAssetCatalog PG ILIKE ANY；renderKbMetaAnswer 三分支（0/≤10/>10）+ LLM 失败兜底；runKbMetaHandler 编排 + omitDoneAndTrace/omitIntentEmit option；isKbMetaHandlerEnabled env 守卫 |
| BE-2a | `apps/qa-service/src/services/ragPipeline.ts` runRagPipeline 入口 | 数据管理员检测后 + condenseQuestion 之前插入：`if (isKbMetaHandlerEnabled() && isObviousKbMeta(q)) → runKbMetaHandler({ assetIds }) → return` |
| BE-2b | 同上 generateAnswer 内 | 档 B answerIntent='kb_meta' 时：`runKbMetaHandler({ assetIds: docs.map(asset_id), omitDoneAndTrace, omitIntentEmit }) → return`，跳过 chatStream + buildKbMetaPrompt |
| BE-3 | `apps/qa-service/src/__tests__/kbMetaHandler.test.ts`（新建，~ 240 行 / 22 case） | 7 个 describe block：命中 8 / 不误伤 9 / 抽词 5 / SQL 5 / 渲染 6 / 编排 4 / env 4 |
| BE-4 | `pnpm -C apps/qa-service test` | 待用户在 macOS 跑（沙箱缺 rollup-linux 二进制） |
| BE-5 | `npx tsc --noEmit` | exit 0 ✓（沙箱 tsc 验证） |
| BE-9 | 沙箱 inline smoke 15 断言 | 8 命中 + 7 不误伤 + 5 keyword 抽词回归全过 |
| EVAL-1 | `eval/multidoc-set.jsonl` 修两处占位 | sop-中英 expected_asset_ids:[1,5]→[19]；cn-fact pattern_type:verbatim→list |
| DOC-1/2 | Explore design + OpenSpec proposal/spec/tasks | 已写 |
| DOC-3 | 本文件 | 已写 |

## 沙箱 smoke 关键结果（15/15 pass）

```
✓ HIT  "我这库里有道德经吗"
✓ HIT  "知识库中包不包含 LFTGATE 的资料"
✓ HIT  "库里有没有汽车工程相关的资料"      ← V3D 关键修复
✓ HIT  "列出所有 pdf 文档"
✓ HIT  "找一下汽车制造相关的文件"
✓ HIT  "有哪些跟尾门设计相关的资料"
✓ HIT  "list documents about cars"
✓ HIT  "do you have any documents on liftgate design"
✓ MISS "知识中台的核心模块有哪些"            ← D003-cn-fact 不能被抢的关键回归
✓ MISS "道德经的作者是谁"
✓ MISS "LFTGATE 的间隙参数"
✓ MISS "翻译第一章"
✓ MISS "总结一下要点"
✓ MISS "为什么作者要这么写"
✓ MISS "alpha angle and beta angle clearance requirements"

extractKbMetaKeywords:
  "我这库里有道德经吗"           → ["道德经"]
  "列出汽车工程相关的资料"        → ["汽车工程"]
  "列出所有 pdf 文档"            → []                  (类型词不当 keyword，正确)
  "find documents about cars"   → ["cars"]
  "知识库中包不包含 LFTGATE 的资料" → ["lftgate"]
```

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 命令 | 期望 |
|---|---|---|
| V-1 | `pnpm -C apps/qa-service test kbMetaHandler` | 22 case 全过；现有套件零回归 |
| V-2 | 重启 qa-service | KB_META_HANDLER_ENABLED 默认 on 自动生效 |
| V-3 | `node scripts/eval-multidoc.mjs --doc-type table_xlsx` | D003-V3D PASS（不再 short-circuit；改走 📚 → 📋 → 🎭 → content + asset_list） |
| V-4 | `node scripts/eval-multidoc.mjs --doc-type classical_chinese` | D003-kbmeta-test PASS（命中 archetype "我这库里有 X 吗"） |
| V-5 | `node scripts/eval-multidoc.mjs` 全集 | 按 intent kb_meta 通过率 0/2 → 2/2；按维度 intent ≥ 86% 不掉；must_pass 5/5 不掉 |
| V-6 | 直接前端聊天："我这库里有什么资料" | 看到 📚 emoji + bullet 列表 + 后缀 .pdf/.md/.xlsx |
| V-7 | `KB_META_HANDLER_ENABLED=false` 重启 + 重跑 | V3D 重新 fail（证明开关有效） |

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| isObviousKbMeta 误判抢正常 RAG 问题 | 双锚定正则 + 排除"X 的属性"句式 + 沙箱 7 case 不误伤回归 |
| extractKbMetaKeywords 抽错关键词 → SQL 召不到 | renderKbMetaAnswer 0 候选时给"似乎没有 + 资产目录建议"的 graceful empty answer |
| LLM 语义筛超时 / 无 key | renderKbMetaAnswer LLM 失败 → 退化前 8 条 markdown |
| metadata_asset 大表 ILIKE 慢 | LIMIT 50；后续可加 `metadata_asset_name_trgm_idx` GIN |
| 整套 D-002.2 revert | env `KB_META_HANDLER_ENABLED=false` 即可，零代码改动 |
| ragPipeline 双路径状态污染 | omitDoneAndTrace + omitIntentEmit 覆盖了顶层短路 vs 档 B fallback 两种调用方语义；单测 4 case 验证 |

## 与 N-* + D-* 系列协同

- **D-003 eval**：本特性的回归基线；V-3 / V-4 / V-5 是验证门槛
- **D-002（档 B 意图分类）**：复用 `classifyAnswerIntent` + `kb_meta` 枚举值
- **D-002.3（language_op function tool）**：正交，互不冲突
- **D-002.4（资产细粒度 filter）**：可继承 `queryAssetCatalog` API（按 asset_type / ingest_status 加 where）
- **N-006 notebook 模板**：notebook 内的 chat 也走同一 ragPipeline，自动受益
- **D-003 eval-multidoc.mjs SSE 修复**（前一轮）：V3D 失败后的"answer prefix 截断"现象会被本特性根治（kb_meta 不再走 short-circuit 兜底）

## Archive（B-4 验证通过后）
- [ ] AR-1 docs/superpowers/specs/rag-kb-meta-routing/ → archive/
- [ ] AR-2 看板 Done
- [ ] AR-3 合并 PR；kbMetaHandler 公共 API freeze
- [ ] AR-4 通知下游：D-002.4 资产细粒度 filter 可继承 queryAssetCatalog
