# Tasks · D-002.6 factual_lookup 拒答倾向修复

## B-1 Explore (✅)
- [x] `docs/superpowers/specs/rag-factual-lookup-refusal-fix/design.md`

## B-2 Lock (✅)
- [x] proposal.md / design.md / specs/factual-lookup-prompt-spec.md / tasks.md

## B-3 Execute
- [ ] BE-1 改 `apps/qa-service/src/services/answerPrompts.ts`
  - [ ] 加 `isFactualStrictVerbatimEnabled()` env 守卫
  - [ ] `buildFactualLookupPrompt` 内分支：env on → 新版 prompt；env off → 老版 prompt
  - [ ] 旧 prompt 字符串完整保留
- [ ] BE-2 改 `apps/qa-service/src/__tests__/answerPrompts.test.ts`
  - [ ] FL-1..FL-6 测试 case
- [ ] BE-3 tsc + vitest 沙箱内（tsc）+ macOS（vitest）

## B-4 Verify (用户在 macOS)
- [ ] V-1 重启 qa-service
- [ ] V-2 `node scripts/eval-multidoc.mjs --case D003-sop-数值 --repeat 3 --verbose`
  → keywords 期望 ≥ 2/3 命中 alpha + beta
- [ ] V-3 industrial_sop_en 全集回归: `node scripts/eval-multidoc.mjs --doc-type industrial_sop_en --repeat 3`
- [ ] V-4 全集 N=3 看整体不退步
- [ ] V-5 `FACTUAL_STRICT_VERBATIM_ENABLED=false node scripts/eval-multidoc.mjs --case D003-sop-数值 --repeat 3` 验证守卫

## B-5 Archive
- [ ] mv specs → archive
- [ ] 更新 SESSION 加 commit ⑦
