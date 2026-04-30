# Proposal · D-002.3 RAG 答案意图分类 multi-tool function call

## What

把 `classifyAnswerIntent` 的 LLM 分类路径从"1 个 tool + intent enum 字段"改造为"5 个独立 tool（每意图 1 tool）+ `tool_choice: required`"，让 LLM 在 tool selection 这一层决断而不是 enum 字段值。修复 D-003 eval 的 V3E（out_of_scope vs factual_lookup 边界震荡），目标 intent 92.9% → 100%、must_pass 4/5 → 5/5 稳。

## Why

D-003 baseline 7（D-002.2 落地后）剩 1 条 intent 误分：

- `D003-V3E` "为什么 GM 要写这份文档" 期望 `out_of_scope`，实际 `factual_lookup`（间歇性，3 跑 1 错）

根因猜测：OAI 兼容服务（含硅基 Qwen2.5-7B-Instruct）的 function calling 优化重点在"调哪个 tool"——tool selection；对 enum 字段值的稳定性投入相对弱。改造后每个 intent 对应一个 tool，tool description 可以编码该意图的具体判定要点（"call this when X"），LLM 在 tool selection 阶段的 P(correct) 通常更高。

不直接修复 V3A/V3D 的 keyword miss（generateAnswer 侧问题），但若 intent 稳，下游 prompt 路由更准，间接可能改善。

## What changes

1. **修改** `apps/qa-service/src/services/answerIntent.ts`：
   - 新增 5 个 tool 常量 `INTENT_TOOLS`（`select_factual_lookup` / `select_language_op` / `select_multi_doc_compare` / `select_kb_meta` / `select_out_of_scope`），每个只含 `reason: string` 参数
   - 新增 `TOOL_NAME_TO_INTENT` 反查表
   - 新增 `isIntentMultiToolEnabled()` env 守卫读 `INTENT_MULTI_TOOL_ENABLED`（默认 `true`）
   - `classifyAnswerIntent` 改为：`isIntentMultiToolEnabled()` 时走 multi-tool 路径（`tools: INTENT_TOOLS, toolChoice: 'required'`，从 `toolCalls[0].function.name` 反查 intent）；否则走旧 single-tool 路径（保留 `CLASSIFY_TOOL` + `toolChoice: { type: 'function', name: 'classify_answer_intent' }`）
   - `buildClassifyPrompt` 在 multi-tool 路径下使用瘦身版 prompt（去掉 inline 边界例子，依赖 tool description 编码）；旧路径仍用原 prompt
   - `isObviousLanguageOp` 规则前置完全不动

2. **修改** `apps/qa-service/src/__tests__/answerIntent.test.ts`：
   - 保留所有规则前置 / env / fallback / 异常 case 的旧测
   - 改 mock：原"1 个 tool 返回不同 intent enum 值"改为"5 个 mock 返回不同 tool name"
   - 新增 case：`tool_choice: 'required'` 时 LLM 调到 5 个 tool name 之一 → 各自映射到对应 intent
   - 新增 case：LLM 调到 unknown tool name（hallucination）→ fallback factual_lookup
   - 新增 case：LLM 多 tool calls → 取首个
   - 新增 case：env `INTENT_MULTI_TOOL_ENABLED=false` → 走旧 single-tool 路径，旧测 5 case 全过

3. **新增** env `INTENT_MULTI_TOOL_ENABLED`（默认 `true`）—— 关闭时回到 single-tool 旧行为，用于回滚。

## Out of scope

- `classifyAnswerIntent` 的 fast model 升级（Qwen2.5-7B → 14B/72B）
- 多次调用取众数 / confidence interval（属于 D-003 评测器侧改造）
- 顶层 AgentIntent classifier 改造（独立风险面）
- `condenseQuestion` / `gradeRelevance` 等其它 LLM 用例的 multi-tool 化
- 修复 V3A / V3D 的 keyword miss（generateAnswer 侧）
- 修改 5 类 intent 对应的 prompt 模板（`answerPrompts.ts`）

## Acceptance

1. vitest `answerIntent.test.ts` 全过（≥ 18 case，含改造后的新测）
2. `pnpm -F qa-service test` 零回归
3. D-003 eval 重跑 baseline 7 对比：
   - intent 维度 13/14 → ≥ 14/14（100%）
   - must_pass 4/5 → 5/5
   - V3E 跑 3 次至少 2 次返回 `out_of_scope`
4. env `INTENT_MULTI_TOOL_ENABLED=false` 重跑 vitest + eval：行为完全回到 baseline 7（旧 single-tool 路径），证明守卫有效
5. `npx tsc --noEmit` exit 0
