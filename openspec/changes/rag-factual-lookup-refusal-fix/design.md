# Design · D-002.6 factual_lookup 拒答倾向修复

> 工作流 B-2 (Lock)。Explore: `docs/superpowers/specs/rag-factual-lookup-refusal-fix/design.md`

## 上游依赖

- `apps/qa-service/src/services/answerPrompts.ts` `buildFactualLookupPrompt`
- D-002.1 5-template 路由（不动其它 4 个模板）
- D-003 评测集（sop-数值 是回归基线）

## 关键决策

### D-1 · prompt 改造点：仅第 1 条规则前置加"先尝试 verbatim 提取"

不动第 2-5 条（禁模糊 / verbatim 数值 / [N] 引用 / 不漏组件）。理由：第 2-5 条是输出形态约束，与"是否拒答"正交。

### D-2 · env 守卫策略

`FACTUAL_STRICT_VERBATIM_ENABLED` 默认 `true`，false 走旧 prompt。沿用 D-002.x 系列守卫风格。`KB_META_HANDLER_ENABLED` / `INTENT_MULTI_TOOL_ENABLED` / `B_HANDLER_ROUTING_ENABLED` 互相正交。

### D-3 · 不加 chain-of-thought 步骤

CoT 在 fast LLM 7B 上不稳定且增加 token。直接靠 prompt 文字引导即可。

### D-4 · 不改单测的 mock LLM

answerPrompts.test.ts 现有结构是测 prompt 字符串内容，不调真 LLM。改造只需 assert prompt 含/不含特定段落。

## Acceptance Tests

| ID | 场景 | 期望 |
|---|---|---|
| FL-1 | env on（默认）prompt 含 "先尝试 verbatim 提取" 段 | assert contains |
| FL-2 | env on prompt 含 "完全没有出现问题的关键实体或同义实体时才说" 改造词 | assert contains |
| FL-3 | env off prompt 是旧版（含 "找不到就说" 但不含 "先尝试 verbatim"）| assert legacy |
| FL-4 | 5 类 intent 路由不变（factual_lookup 走改造，其它 4 个不变）| assert other 4 unchanged |
| FL-5 | citationStyle='footnote' 时新 prompt 也正确 footnote 化 | assert [^N] in prompt prefix |
