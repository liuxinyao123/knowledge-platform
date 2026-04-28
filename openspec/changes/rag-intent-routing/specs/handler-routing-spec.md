# Spec: ragPipeline.generateAnswer · 意图分类接入点

## 接入点

`apps/qa-service/src/services/ragPipeline.ts` 中 `generateAnswer` 函数体内，
位于：
- `inlineImageRule` 计算之后
- `chatStream` 调用之前

`generateAnswer` 对外签名 **不变**。

---

## 行为契约

### Scenario: 默认 RAG 路径 · 调 classifier + 按 intent 选 prompt

- Given `extras?.webHits` 不存在或长度 = 0（即 `hasWeb = false`）
- And env `B_HANDLER_ROUTING_ENABLED` 默认 / `true`
- When `generateAnswer` 执行
- Then 调用 `classifyAnswerIntent(question, docs)`
- And emit 事件 `{ type: 'rag_step', icon: '🎭', label: '答案意图分类 → <intent>（<reason>）' }`
- And 调用 `buildSystemPromptByIntent(<intent>, context, inlineImageRule)`
- And 用结果作为 `chatStream` 的 `system` 参数

### Scenario: classifier fallback 时 emit 静默

- Given classifier 返回 `{ intent: 'factual_lookup', fallback: true }`（任何原因）
- When `generateAnswer` 执行
- Then **不**emit `🎭` rag_step 事件（避免污染日志）
- And 仍然调 `buildSystemPromptByIntent('factual_lookup', context, inlineImageRule)`
  （安全默认）
- And `chatStream` 用 factual_lookup 模板

### Scenario: web 模式跳过意图分类

- Given `extras?.webHits` 长度 ≥ 1（即 `hasWeb = true`）
- When `generateAnswer` 执行
- Then **不**调用 `classifyAnswerIntent`
- And **不**emit `🎭` rag_step 事件
- And `chatStream` 用原有 web prompt（包含 `[N]` + `[wN]` 来源 disambiguation 规则）

### Scenario: env B_HANDLER_ROUTING_ENABLED=false 全局回落

- Given env `B_HANDLER_ROUTING_ENABLED=false`
- And `hasWeb = false`
- When `generateAnswer` 执行
- Then `classifyAnswerIntent` 内部立即返回 `{ intent: 'factual_lookup', fallback: true }`
- And **不**调 fast LLM（成本 0）
- And `chatStream` 用 factual_lookup 模板（=老严格 RAG 行为，零回归）

### Scenario: systemPromptOverride 仍然优先

- Given 调用方传入 `systemPromptOverride = 'CUSTOM_PROMPT'`
- When `generateAnswer` 执行
- Then **不**调 classifier（override 有更高优先级）
- And `chatStream` 的 `system` = `'CUSTOM_PROMPT\n\n文档内容：\n${context}'`
- And 行为同 main（向后兼容）

### Scenario: 空 docs 仍然 classify + 选 prompt

- Given `docs = []`（无召回）
- And `hasWeb = false`
- When `generateAnswer` 执行
- Then 仍调 `classifyAnswerIntent(question, [])`
- And classifier 大概率分到 `out_of_scope`（无文档可参考）
- And `chatStream` 用 out_of_scope 模板（明说找不到）

### Scenario: image 附件路径不影响意图分类

- Given `extras?.image` 存在（VLM 路径）
- And `hasWeb = false`
- When `generateAnswer` 执行
- Then 仍调意图分类（图片附件跟意图正交）
- And `chatStream` 仍按 `extras?.image ? visionModel : getLlmModel()` 选模型

---

## emit 事件契约

### `🎭` rag_step（成功分类）

```ts
{
  type: 'rag_step',
  icon: '🎭',
  label: `答案意图分类 → ${intent}（${reason}）`,
}
```

- `intent` ∈ `ANSWER_INTENTS`
- `reason` 是 classifier 返回的 reason 字段（≤ 60 字符）；
  若 reason 为空字符串则显示 `'已分类'`（兜底文案）
- 仅在 `fallback = false` 时 emit
- **不新增 SseEvent type**，沿用 `rag_step`，前端零感知

### Scenario: emit 优先显示 LLM 真实 reason（V-2 修复）

- Given classifier 返回 `{ intent: 'language_op', reason: 'asks for translation', fallback: false }`
- When `generateAnswer` emit `🎭`
- Then label = `'答案意图分类 → language_op（asks for translation）'`
- And **不应**永远显示 `'已分类'` 兜底文案（这是 V-2 实测发现的 emit 三元 bug）

### Scenario: emit reason 兜底文案

- Given classifier 返回 `{ intent: 'factual_lookup', reason: '', fallback: false }`
- When `generateAnswer` emit `🎭`
- Then label = `'答案意图分类 → factual_lookup（已分类）'`

---

## 顶层 agent classifier 边界（V-3 实测追加）

### Scenario: "翻译/解释/总结/释义" 元指令必须进 knowledge_qa

- Given 用户问 `"把上面这段翻译成中文"` 或 `"解释一下这章"` 或 `"总结一下"` 或
  `"提炼要点"` 或 `"白话解释"`
- When 顶层 `agent/intentClassifier.ts` 分类
- Then 返回 `intent = 'knowledge_qa'`（**不是** metadata_ops 也不是 data_admin）
- And `dispatchHandler` 路由到 `KnowledgeQaAgent`
- And `KnowledgeQaAgent.run` 调 `runRagPipeline` → 进入档 B 意图分流 → 大概率分到
  `language_op` → 触发 language_op prompt 模板

### Scenario: metadata_ops 只针对元数据 CRUD

- Given 用户问 `"删除资产 12"` 或 `"把 asset 5 重命名为 X"` 或 `"给 user.email
  字段加 ACL 规则"`
- When 顶层 classifier 分类
- Then 返回 `intent = 'metadata_ops'`（这才是真实的元数据 CRUD）

### Scenario: prompt 含明确边界例子（不依赖 LLM 自己理解）

- When 调用 `classifyByLlm`
- Then SYSTEM_PROMPT 包含至少 3 条 knowledge_qa vs metadata_ops 的边界对比例子：
  - `"把上面这段翻译成中文" → knowledge_qa`
  - `"解释一下这章" / "总结一下" → knowledge_qa`
  - `"把 asset 5 改名为 X" / "删除 asset 12" → metadata_ops`

---

## 测试覆盖

- 单元测试：详见 `services/answerIntent.test.ts` + `services/answerPrompts.test.ts`
- ragPipeline 现有测试（`ragPipeline.test.ts` / `ragPipeline.shortCircuit.test.ts`）
  **零回归**——它们 mock `chatComplete` 返回空 toolCalls，刚好命中 classifier
  的 fallback 分支，`generateAnswer` 行为等价老 monolithic prompt

---

## 回滚

- env `B_HANDLER_ROUTING_ENABLED=false` → 进程内立即回落 factual_lookup（=老严格 RAG）
- revert 本 change 的 commit → `generateAnswer` 签名不变 → 调用方零适配
