# Spec: D-003 意图分类断言

## 模块：scripts/eval-multidoc-lib.mjs · `assertIntent`

```ts
function assertIntent(
  c: EvalCase,
  o: Observed,
): { pass: boolean; reason: string }
```

## 行为契约

### Scenario: expected_intent = null → skip

- Given `c.expected_intent = null`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: true, reason: 'skipped (no expected_intent)' }`

### Scenario: short-circuit + expected_intent 非 null → 特例处理

- Given `o.shortCircuited = true`（命中 ⛔ 阈值兜底）
- And `c.expected_intent = 'kb_meta'`（V3D 这类）
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: false, reason: 'expected kb_meta but short-circuit fallback (top-1 too low)' }`
- And 该 case 在报告中归到 "short-circuit before classify" 分类（便于统计 D-002.2 待修 case 数量）

### Scenario: 档 B 意图分类正确 → pass

- Given `o.answerIntent = 'language_op'`
- And `c.expected_intent = 'language_op'`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: true, reason: 'matched: language_op' }`

### Scenario: 档 B 意图分类错 → fail

- Given `o.answerIntent = 'factual_lookup'`
- And `c.expected_intent = 'language_op'`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: false, reason: 'expected language_op got factual_lookup' }`

### Scenario: 档 B 没 emit 🎭（fallback factual_lookup）→ 当 factual_lookup 算

- Given `o.answerIntent = null`（classifier 走 fallback）
- And `c.expected_intent = 'factual_lookup'`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: true, reason: 'matched factual_lookup (via fallback)' }`

### Scenario: 顶层 agent 误路由 → 优先报顶层错

- Given `o.topIntent = 'metadata_ops'`
- And `c.expected_intent = 'language_op'`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: false, reason: 'top-level routed to metadata_ops, not knowledge_qa (V3B class)' }`

### Scenario: web 模式 case → expected_intent 必须 null

- Given `o.answerIntent = null`（web 模式跳过档 B）
- And `c.expected_intent = null`
- When 调用 `assertIntent(c, o)`
- Then 返回 `{ pass: true, reason: 'skipped (web mode, no answer-intent)' }`