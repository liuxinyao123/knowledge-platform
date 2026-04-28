# Spec: AnswerIntent 分类层

## 模块：services/answerIntent.ts

### 公开类型

```ts
export type AnswerIntent =
  | 'factual_lookup'
  | 'language_op'
  | 'multi_doc_compare'
  | 'kb_meta'
  | 'out_of_scope'

export const ANSWER_INTENTS: readonly AnswerIntent[]

export interface IntentClassification {
  intent: AnswerIntent
  reason: string         // ≤ 60 字符
  fallback: boolean      // true = 走了默认值，没真分类成功
}
```

### 公开函数

```ts
export function isAnswerIntent(s: unknown): s is AnswerIntent
export function isHandlerRoutingEnabled(): boolean
export function isObviousLanguageOp(question: string): boolean
export async function classifyAnswerIntent(
  question: string,
  docs: AssetChunk[],
): Promise<IntentClassification>
```

---

## 行为契约 · classifyAnswerIntent

### Scenario: env B_HANDLER_ROUTING_ENABLED=false 直接 fallback

- Given env `B_HANDLER_ROUTING_ENABLED=false`
- When 调用 `classifyAnswerIntent('给我翻译一下', docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'B_HANDLER_ROUTING_ENABLED=false', fallback: true }`
- And **不调用** `chatComplete`（成本 0）

### Scenario: env 关闭也接受 false / 0 / off / no（大小写不敏感）

- Given env `B_HANDLER_ROUTING_ENABLED` 取以下任一值：`false`, `0`, `off`, `no`,
  `FALSE`, `Off`
- When 调用 `isHandlerRoutingEnabled()`
- Then 返回 `false`

### Scenario: env 未设 / 设为其它值 → 默认 on

- Given env `B_HANDLER_ROUTING_ENABLED` 未设
- When 调用 `isHandlerRoutingEnabled()`
- Then 返回 `true`

### Scenario: LLM 未配置直接 fallback

- Given `isLlmConfigured()` 返回 `false`
- When 调用 `classifyAnswerIntent('Q', docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'llm not configured', fallback: true }`
- And **不调用** `chatComplete`

### Scenario: 空问题直接 fallback

- Given `question = ''` 或 `question = '   '`（trim 后空）
- When 调用 `classifyAnswerIntent(question, docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'empty question', fallback: true }`

### Scenario: tool 调用无返回值 → fallback

- Given `chatComplete` 返回 `{ content: '', toolCalls: [], rawMessage: ... }`
- When 调用 `classifyAnswerIntent('Q', docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'no tool call returned', fallback: true }`

### Scenario: tool 返回非合法 intent → fallback

- Given `chatComplete` 返回 `toolCalls: [{ function: { name: '...', arguments: '{"intent":"foo","reason":"x"}' } }]`
- When 调用 `classifyAnswerIntent('Q', docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'invalid intent "foo"', fallback: true }`

### Scenario: tool 返回合法 intent → 该 intent，fallback=false

- Given `chatComplete` 返回 `toolCalls: [{ function: { arguments: '{"intent":"language_op","reason":"asks for translation"}' } }]`
- When 调用 `classifyAnswerIntent('给我翻译一下', docs)`
- Then 返回 `{ intent: 'language_op', reason: 'asks for translation', fallback: false }`

### Scenario: LLM 抛异常 → fallback，error 写入 reason 前 40 字

- Given `chatComplete` 抛 `Error('LLM 502 bad gateway')`
- When 调用 `classifyAnswerIntent('Q', docs)`
- Then 返回 `{ intent: 'factual_lookup', reason: 'classify failed: LLM 502 bad gateway', fallback: true }`
- And 不抛错

### Scenario: 1.5s 硬超时

- Given `chatComplete` 永不返回（模拟挂起）
- When 调用 `classifyAnswerIntent('Q', docs)`
- Then 1.5s 内必定返回（AbortController 触发 + catch）
- And 返回 `{ intent: 'factual_lookup', fallback: true }`

### Scenario: prompt 内容包含 question + 召回前 3 段 preview

- Given 召回 `docs = [doc1(content="AAA..."), doc2(content="BBB..."), doc3(content="CCC..."), doc4(content="DDD...")]`
- When 调用 `classifyAnswerIntent('给我 A 的内容', docs)`
- Then 发给 LLM 的 prompt 包含 `'给我 A 的内容'`
- And 包含 `'AAA'`、`'BBB'`、`'CCC'`
- And **不**包含 `'DDD'`（前 3 段截断生效）
- And 每段 preview ≤ 200 字符（DOC_PREVIEW_CHARS）

### Scenario: prompt 含强判定规则（动作动词 + meta 词 → language_op）

- When 调用 `classifyAnswerIntent`
- Then 发给 LLM 的 prompt 包含强判定规则段：
  - "看用户语气是查询还是指令"
  - "动作动词（给/做/帮/请/把）+ meta 词（解释/翻译/释义/总结/白话/...）" 组合 → language_op
  - "指代代词（它/这/那/上面/这段/他的/这个）+ meta 词" → language_op
- And 包含至少一条针对 follow-up 指代型 meta 指令的边界例子（如
  `"给他的原文的解释" → language_op` / `"翻译一下这段" → language_op`）

### Scenario: classifier 把 "给他的原文的解释" 类指令分到 language_op

- Given `question = '给他的原文的解释'`（含指代 "他的" + meta 词 "解释"）
- And 召回 docs 含相关原文（如《道德经》第一章）
- When 调用 `classifyAnswerIntent(question, docs)`
- Then 应当返回 `intent = 'language_op'`（强判定规则触发）
- And 不应误判为 factual_lookup（这是 V-2 实测发现的回归点）

### Scenario: tool schema 强制 5 类 enum

- When 调用 `classifyAnswerIntent`
- Then 发出的 OAITool 定义中 `parameters.properties.intent.enum` =
  `["factual_lookup", "language_op", "multi_doc_compare", "kb_meta", "out_of_scope"]`
- And `tool_choice = { type: 'function', function: { name: 'classify_answer_intent' } }`（强制调用此 tool）

### Scenario: maxTokens=80 / temperature=0.1 / model=fast

- When 调用 `classifyAnswerIntent`
- Then `chatComplete` 入参 `model = getLlmFastModel()`（默认 `Qwen/Qwen2.5-7B-Instruct`）
- And `maxTokens = 80`
- And `temperature = 0.1`

---

## 规则前置 · isObviousLanguageOp（V3B 修复）

背景：fast LLM (Qwen 7B) 在 prompt 强判规则下仍偶尔把 "把上面这段翻译成中文" 误判到
`factual_lookup`（看到 chunks 是英文 LFTGATE 内容就误以为"在找事实"）。规则前置
绕过 LLM 概率执行，确定性 100%。

### Scenario: meta 动词 + 祈使 → true

- Given `question = '把上面这段翻译成中文'`
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `true`（含 "翻译" + "把" + "上面" 三重命中）

### Scenario: meta 动词 + 指代 → true

- Given `question = '给他的原文的解释'`
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `true`（含 "解释" + "给" + "他的"）

### Scenario: meta 动词 + 短句 → true（≤30 字符兜底）

- Given `question = '翻译'` / `'解释一下'` / `'请总结'`
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `true`

### Scenario: 英文 meta 动词 → true

- Given `question = 'translate the above answer to english'` /
  `'summarize the report'`
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `true`

### Scenario: 无 meta 动词 → false

- Given `question = '道德经的作者是谁'` / `'缓冲块设计间隙是多少'` / `'什么是道？'`
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `false`

### Scenario: 长句含 meta 词但无祈使/指代 → false（避免误触发查询型）

- Given `question = '我想了解机器翻译这门技术的发展历史详细情况和当下的应用场景'`
  （长 + 含 "翻译" 但是查询型语气）
- When 调用 `isObviousLanguageOp(question)`
- Then 返回 `false`

### Scenario: classifyAnswerIntent 规则前置命中 → 不调 LLM

- Given `question = '把上面这段翻译成中文'`（规则命中）
- When 调用 `classifyAnswerIntent(question, docs)`
- Then 返回 `{ intent: 'language_op', reason: 'rule:meta+imperative', fallback: false }`
- And **不调用** `chatComplete`（成本节约）

### Scenario: classifyAnswerIntent 规则不命中 → 走 LLM

- Given `question = '道德经的作者是谁'`（规则不命中）
- And `chatComplete` 返回 `{ intent: 'factual_lookup', reason: '...' }`
- When 调用 `classifyAnswerIntent(question, docs)`
- Then 调用 `chatComplete` 一次
- And 返回 LLM 给的 intent

---

## 守卫 · isAnswerIntent

### Scenario: 5 个合法值返回 true

- When 调用 `isAnswerIntent(intent)` for each `intent in ANSWER_INTENTS`
- Then 全部返回 `true`

### Scenario: 其它字符串 / 非字符串返回 false

- When 调用 `isAnswerIntent('foo' | '' | null | undefined | 42 | {})`
- Then 全部返回 `false`
