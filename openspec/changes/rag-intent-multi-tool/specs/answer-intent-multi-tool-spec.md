# Spec · classifyAnswerIntent multi-tool 路径

> 模块：`apps/qa-service/src/services/answerIntent.ts`
> 上游：D-002 答案意图分类（单 tool 路径）+ D-002.1 5 类 prompt 模板 + D-003 评测集
> 下游：D-002.2 kb_meta 路由（其 generateAnswer 内 fallback 入口依赖正确的 intent='kb_meta'）

## ADDED Requirements

### isIntentMultiToolEnabled

```ts
export function isIntentMultiToolEnabled(): boolean
```

**输入**：无（读 `process.env.INTENT_MULTI_TOOL_ENABLED`）。

**输出**：boolean。

**判定**：

- 未设、`'true'`、`'1'`、`'on'`、`'yes'`、空串 → `true`（默认 on）
- `'false'`、`'0'`、`'off'`、`'no'`（大小写不敏感）→ `false`

### INTENT_TOOLS 常量

```ts
export const INTENT_TOOLS: readonly OAITool[]  // 长度 5
```

**结构**：5 个 OAITool 对象，name 为 `select_factual_lookup` / `select_language_op` / `select_multi_doc_compare` / `select_kb_meta` / `select_out_of_scope`。

每个 tool 的 `parameters` schema 必须为：

```ts
{
  type: 'object',
  properties: {
    reason: { type: 'string', description: '≤30 字简短原因' },
  },
  required: ['reason'],
}
```

每个 tool 的 description 必须包含：

- 该 intent 的核心判定语义（≤120 字）
- 至少 1 个示例问句
- 与最易混淆的相邻 intent 的边界提示

### TOOL_NAME_TO_INTENT 反查

```ts
export const TOOL_NAME_TO_INTENT: Readonly<Record<string, AnswerIntent>>
```

5 项映射：

```
select_factual_lookup    → 'factual_lookup'
select_language_op       → 'language_op'
select_multi_doc_compare → 'multi_doc_compare'
select_kb_meta           → 'kb_meta'
select_out_of_scope      → 'out_of_scope'
```

## MODIFIED Requirements

### classifyAnswerIntent

```ts
export async function classifyAnswerIntent(
  question: string,
  docs: AssetChunk[],
): Promise<IntentClassification>
```

**控制流**（按顺序判定）：

1. `!isHandlerRoutingEnabled()` → `{ intent: 'factual_lookup', reason: 'B_HANDLER_ROUTING_ENABLED=false', fallback: true }`
2. `!isLlmConfigured()` → `{ intent: 'factual_lookup', reason: 'llm not configured', fallback: true }`
3. `question.trim().length === 0` → `{ intent: 'factual_lookup', reason: 'empty question', fallback: true }`
4. `isObviousLanguageOp(question)` → `{ intent: 'language_op', reason: 'rule:meta+imperative', fallback: false }`（**不变，规则前置不动**）
5. `isIntentMultiToolEnabled() === false` → 走旧 single-tool 路径（`CLASSIFY_TOOL` + `toolChoice: { type: 'function', function: { name: 'classify_answer_intent' } }`，从 args 解析 intent）
6. **multi-tool 路径**（默认）：
   - 调用 `chatComplete` 时 `tools: [...INTENT_TOOLS]`、`toolChoice: 'required'`
   - 解析 `toolCalls[0].function.name`：
     - 在 `TOOL_NAME_TO_INTENT` 里 → 接受 intent，尝试解析 args.reason，失败时 reason='args parse failed'
     - 不在 → fallback `factual_lookup`，reason=`unknown tool: <name>`
   - `toolCalls.length === 0` → fallback `factual_lookup`，reason='no tool call returned'
   - 多 tool calls → 取第 0 个，丢弃后续

**所有路径共同保证**：

- 1.5 秒硬超时（AbortController）
- 任何异常 catch → fallback `factual_lookup`，reason 含原 error message 前 40 字
- maxTokens=80, temperature=0.1
- 只在 multi-tool 路径下调 `buildClassifyPromptMultiTool`；旧路径仍调 `buildClassifyPrompt`

### buildClassifyPromptMultiTool

```ts
function buildClassifyPromptMultiTool(question: string, docs: AssetChunk[]): string
```

**输入**：用户问题 + 召回 docs。

**输出**：单个 user message 内容字符串。

**结构要求**：

1. 顶部一句指引："根据用户问题与召回文档预览，调用 5 个 select_* 工具中最匹配的一个。reason 字段填一句简短原因（≤30 字）。"
2. 用户问题段
3. 召回文档预览（前 3 段，每段 ≤ 200 字）
4. **不**在 prompt 里重复 5 类 intent 的判定规则（已下沉到 tool description）
5. **不**在 prompt 里给边界例子

期望 prompt 长度（不含 tool schema）：≤ 500 字。

## Acceptance Tests

模块 `apps/qa-service/src/__tests__/answerIntent.test.ts` 必须包含：

| ID | 场景 | 期望 |
|---|---|---|
| MT-1 | env on, LLM 调 select_factual_lookup | intent=factual_lookup, fallback=false |
| MT-2 | env on, LLM 调 select_language_op | intent=language_op, fallback=false |
| MT-3 | env on, LLM 调 select_multi_doc_compare | intent=multi_doc_compare, fallback=false |
| MT-4 | env on, LLM 调 select_kb_meta | intent=kb_meta, fallback=false |
| MT-5 | env on, LLM 调 select_out_of_scope | intent=out_of_scope, fallback=false |
| MT-6 | env on, LLM 调 unknown tool name | intent=factual_lookup, fallback=true, reason 含 'unknown' |
| MT-7 | env on, LLM 同调多 tool | intent=取第一个 |
| MT-8 | env on, args 解析失败但 name 合法 | intent 由 name 决定, fallback=false, reason 含 'parse failed' |
| MT-9 | env on, 0 tool calls | intent=factual_lookup, fallback=true |
| MT-10 | env on, prompt 不包含旧"边界例子"段 | 验证 prompt 内容 |
| LEG-1 | env=false, LLM 调 classify_answer_intent({intent:'factual_lookup'}) | intent=factual_lookup, fallback=false |
| LEG-2 | env=false, 调用使用 single-tool schema | mock.calls[0][1].tools[0].function.name === 'classify_answer_intent' |
| RULE-1 | "把上面这段翻译成中文" | intent=language_op, reason='rule:meta+imperative', mockChatComplete 不被调 |
| FAIL-1 | LLM 异常 | intent=factual_lookup, fallback=true, reason 含原 error 前 40 字 |
| FAIL-2 | env=on, llm not configured | intent=factual_lookup, fallback=true |
| FAIL-3 | env=on, B_HANDLER_ROUTING_ENABLED=false | intent=factual_lookup, fallback=true |

至少 16 case，覆盖 5 类 intent multi-tool 路径 + 旧 single-tool 路径 + 规则前置 + 4 种 fallback。
