# Tasks · D-002.3 RAG 答案意图分类 multi-tool function call

## B-1 Explore (✅ Done)
- [x] EXP-1 / docs/superpowers/specs/rag-intent-multi-tool/design.md

## B-2 OpenSpec Lock (✅ Done)
- [x] OS-1 / proposal.md
- [x] OS-2 / design.md
- [x] OS-3 / specs/answer-intent-multi-tool-spec.md
- [x] OS-4 / tasks.md（本文件）

## B-3 Execute
- [ ] BE-1 改 apps/qa-service/src/services/answerIntent.ts
  - [ ] BE-1a 新增 `INTENT_TOOLS` 常量（5 个 OAITool，name 用 `select_*` 前缀，每个含 description ≤120 字 + 1 例 + 边界提示）
  - [ ] BE-1b 新增 `TOOL_NAME_TO_INTENT` 反查表
  - [ ] BE-1c 新增 `isIntentMultiToolEnabled()`（默认 true，识别 false/0/off/no）
  - [ ] BE-1d 新增 `buildClassifyPromptMultiTool(question, docs)`（瘦身 prompt，去边界例子）
  - [ ] BE-1e 改 `classifyAnswerIntent` 控制流：guards → isObviousLanguageOp → isIntentMultiToolEnabled 分支
  - [ ] BE-1f multi-tool 解析：name 反查 + 兜底链（unknown tool → factual_lookup, 多 tool 取首, args 失败仍接受 name）
  - [ ] BE-1g 旧 `CLASSIFY_TOOL` + `buildClassifyPrompt` 完整保留（env=false 路径）
- [ ] BE-2 改 apps/qa-service/src/__tests__/answerIntent.test.ts
  - [ ] BE-2a 保留所有 RULE/FAIL/env-guard 旧 case
  - [ ] BE-2b 新增 multi-tool 路径 5 case（MT-1..5 各 intent）
  - [ ] BE-2c 新增 fallback 4 case（MT-6 unknown / MT-7 多 tool / MT-8 args 解析失败 / MT-9 0 tool）
  - [ ] BE-2d 新增 prompt 内容 case（MT-10 验证瘦身 prompt 不含旧边界例子段）
  - [ ] BE-2e 新增旧路径 2 case（LEG-1 / LEG-2）
- [ ] BE-3 `pnpm -F qa-service test` 零回归
- [ ] BE-4 `pnpm -F qa-service exec tsc --noEmit` exit 0
- [ ] DOC-1 docs/superpowers/plans/rag-intent-multi-tool-impl-plan.md（按实际改动倒推）

## B-4 Verify (用户在 macOS)
- [ ] V-1 重启 qa-service（确保 `INTENT_MULTI_TOOL_ENABLED` 默认 on 生效）
- [ ] V-2 `node scripts/eval-multidoc.mjs` 全集 → intent ≥ 14/14、must_pass ≥ 5/5
- [ ] V-3 V3E 单 case 跑 3 次：≥ 2 次返回 out_of_scope
- [ ] V-4 设 `INTENT_MULTI_TOOL_ENABLED=false` 重跑 → 行为完全等同 baseline 7（旧 single-tool 路径），证明守卫有效
- [ ] V-5 V-2/V-3 通过后清除 env，恢复默认 on

## B-5 Archive (V-2/V-3/V-4 全过后)
- [ ] AR-1 mv docs/superpowers/specs/rag-intent-multi-tool/ → docs/superpowers/archive/rag-intent-multi-tool/
- [ ] AR-2 更新 docs/superpowers/plans/SESSION-2026-04-29-progress.md 加 commit ④
- [ ] AR-3 看板 D-002.3 状态切 Done
- [ ] AR-4 PR 合并；INTENT_MULTI_TOOL_ENABLED 默认 on 进生产

## 完成判据（B-3/B-4 通过的硬门槛）

1. vitest answerIntent.test.ts ≥ 16 case 全过
2. tsc 零 error
3. eval intent 100%、must_pass 100%
4. V3E 三跑 ≥2 次 oos
5. env=false 旧行为零回归
