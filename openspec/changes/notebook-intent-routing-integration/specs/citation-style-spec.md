# Spec: CitationStyle 类型 + buildSystemPromptByIntent 扩展

## 模块：services/answerPrompts.ts

### 公开类型

```ts
export type CitationStyle = 'inline' | 'footnote'
```

### 公开函数

```ts
export function buildSystemPromptByIntent(
  intent: AnswerIntent,
  context: string,
  inlineImageRule?: string,
  citationStyle?: CitationStyle,    // 新增可选参数，默认 'inline'
): string
```

---

## 行为契约

### Scenario: 默认 citationStyle = 'inline'，行为等价 main

- Given 调用 `buildSystemPromptByIntent('factual_lookup', context)` 不传第 4 参数
- When 拿到返回 prompt
- Then prompt 中所有引用规则用 `[N]` 字面（如 "每个事实陈述后加 [N] 引用"）
- And **不**包含 `[^N]` 形式
- And 跟 rag-intent-routing 已 freeze 行为完全一致

### Scenario: 显式传 'inline'，行为等价默认

- Given `buildSystemPromptByIntent(intent, ctx, '', 'inline')` for 5 个 intent
- When 拿到返回 prompt
- Then 5 个 prompt 都跟不传第 4 参数时**完全相同**

### Scenario: 'footnote' 模式，prompt 段所有 [N] → [^N]

- Given `buildSystemPromptByIntent('factual_lookup', context, '', 'footnote')`
- When 拿到返回 prompt
- Then prompt 引用规则段含 `[^N]` 而**不**含 `[N]`（如 "每个事实陈述后加 [^N] 引用"）
- And 同句多源用 `[^1][^2]` 而非 `[1][2]`

### Scenario: 'footnote' 模式，context 里的 [N] 不替换

- Given context = `'[1] doc1.pdf\nchunk content'`
- And 调用 `buildSystemPromptByIntent(intent, context, '', 'footnote')`
- When 拿到返回 prompt
- Then 返回字符串包含原样 `'[1] doc1.pdf'`（不替换为 `[^1]`）
- And prompt 段（"文档内容："之前）的 `[N]` 替换为 `[^N]`

  **理由**：context 段是给 LLM 看"哪个 chunk 编号几"，不是引用模板。LLM 看到
  `[1] doc1.pdf` 知道 doc 1，输出 `[^1]` 给前端。

### Scenario: 'footnote' 模式，5 个 intent 模板一致替换

- For each `intent in [factual_lookup, language_op, multi_doc_compare, kb_meta, out_of_scope]`:
- Given `buildSystemPromptByIntent(intent, ctx, '', 'footnote')`
- When 检查返回 prompt（拆掉 context 段后）
- Then 所有 `[N]` 引用模式都换成 `[^N]`
- And 模式名（如"事实查询模式"）+ 关键约束（如 verbatim / 必须执行 / 不能拒答）
  全部保留

### Scenario: 'footnote' 模式，inlineImageRule 不受影响

- Given `inlineImageRule = '\n6. ![alt](/api/assets/images/42) 图片内嵌测试'`
  （markdown image syntax，**不**含 `[N]`）
- And 调用 `buildSystemPromptByIntent('factual_lookup', ctx, inlineImageRule, 'footnote')`
- When 检查 prompt
- Then `inlineImageRule` 字串原样出现在结果中
- And 不会误伤 `![alt](...)` 这种 markdown image

### Scenario: 'footnote' 模式禁词检查（仍不含 hardcoded 文档形态词）

- Given 5 个 intent
- When 调用 `buildSystemPromptByIntent(intent, ctx, '', 'footnote')`
- Then 返回字符串**不**包含禁词（道德经 / 老子 / 缓冲块 / COF / B&R / Swing /
  油漆变差 / 铰链公差）
- 与 inline 模式同样禁词约束

### Scenario: 非法 citationStyle → 退化到 'inline'

- Given 调用 `buildSystemPromptByIntent(intent, ctx, '', 'invalid_style' as any)`
- When 检查 prompt
- Then 返回字符串与 'inline' 模式相同（TypeScript 严格类型，运行期不该出现非法值；
  但实现要 defensive）
