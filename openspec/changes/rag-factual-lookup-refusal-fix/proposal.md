# Proposal · D-002.6 factual_lookup 拒答倾向修复

## What

把 `buildFactualLookupPrompt` 第 1 条规则从"找不到就说" 改造成"**先尝试 verbatim 提取，只有所有 chunks 完全无问题关键实体时才拒答**"。修复 D-003 eval 的 `D003-sop-数值` keywords 命中率 1/3 → ≥ 2/3 (LLM 不再过早走 escape)。

## Why

D-002.4 N=3 揭示 sop-数值 case："alpha angle and beta angle clearance requirements" 期望 keywords ["alpha","beta"]，2/3 跑里 LLM 输出 `知识库中没有相关内容 [1][2][3][4][5][6][7][8][9][10]` —— 引用 10 chunks 却说没内容。retrieval 已命中正确 docs (LFTGATE-32 + Bumper Integration BP)，问题出在 prompt 给的 escape 门槛过低。

## What changes

1. **修改** `apps/qa-service/src/services/answerPrompts.ts` `buildFactualLookupPrompt`：
   - 第 1 条规则改为两段式：先 verbatim 提取相关片段；只有所有 chunks 完全无问题关键实体时才拒答
   - 其它 4 条规则（禁模糊措辞 / verbatim 数值 / [N] 引用 / 不漏组件）不动
2. **新增** env `FACTUAL_STRICT_VERBATIM_ENABLED`（默认 `true`）—— 关闭时回到老 prompt，方便回滚
3. **修改** `apps/qa-service/src/__tests__/answerPrompts.test.ts`：加 case 验证新 prompt 含"先尝试 verbatim 提取"段落 + env=false 走老 prompt

## Out of scope

- 其它 4 个 intent prompt 模板（language_op / multi_doc_compare / kb_meta / out_of_scope）
- retrieval / rerank 算法
- D-002.3 V3E intent 抖动 / cn-fact intent 抖动

## Acceptance

1. sop-数值 `--repeat 3` keywords ≥ 2/3 命中 alpha + beta
2. V3C / V3B / sop-中英 等 industrial_sop_en 其它 case 不回归
3. env=false 重跑 → sop-数值 仍 1/3（守卫工作）
4. vitest answerPrompts.test.ts 全过 + 整套零回归
5. tsc exit 0
