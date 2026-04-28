# Spec: AnswerPrompts 模板层

## 模块：services/answerPrompts.ts

### 公开函数

```ts
import type { AnswerIntent } from './answerIntent.ts'

export function buildSystemPromptByIntent(
  intent: AnswerIntent,
  context: string,
  inlineImageRule?: string,    // 默认 ''
): string
```

---

## 通用契约

### Scenario: 5 个 intent 都返回非空 prompt 包含 context

- For each `intent in ANSWER_INTENTS`:
- Given `context = '[1] doc1\n召回内容样例'`
- When 调用 `buildSystemPromptByIntent(intent, context)`
- Then 返回字符串非空
- And 包含 `context` 字串

### Scenario: 5 模板首句声明模式名（让 LLM 一眼锁定行为）

- For each `intent in ANSWER_INTENTS`:
- When 调用 `buildSystemPromptByIntent(intent, context)`
- Then 返回字符串包含 `'你是知识库助手 · **<模式名>**'` 形式：
  - `factual_lookup` → `'事实查询模式'`
  - `language_op` → `'语言层转换模式'`
  - `multi_doc_compare` → `'对比/分项模式'`
  - `kb_meta` → `'目录元查询模式'`
  - `out_of_scope` → `'超范围声明模式'`

### Scenario: 禁词 —— 5 模板都不含 hardcoded 文档形态词

- For each `intent in ANSWER_INTENTS`:
- When 调用 `buildSystemPromptByIntent(intent, context, '')`
- Then 返回字符串**不**包含以下任一词：
  - `'道德经'`、`'老子'`（古典文献绑定）
  - `'缓冲块'`、`'COF'`、`'B&R'`、`'Swing'`、`'油漆变差'`、`'铰链公差'`（工业制造绑定）
- 这条契约由 `answerPrompts.test.ts` 用循环锁住

### Scenario: inlineImageRule 默认为空字符串

- When 调用 `buildSystemPromptByIntent(intent, context)` 不传第三个参数
- Then 返回字符串**不**包含 `'图片内嵌'`

### Scenario: inlineImageRule 仅拼到 factual_lookup / language_op / multi_doc_compare

- Given `inlineImageRule = '\n6. **图片内嵌（可选）**：测试占位规则'`
- When 调用 `buildSystemPromptByIntent('factual_lookup', context, inlineImageRule)` →
  返回字符串包含 `'图片内嵌'`
- When 调用 `buildSystemPromptByIntent('language_op', context, inlineImageRule)` →
  返回字符串包含 `'图片内嵌'`
- When 调用 `buildSystemPromptByIntent('multi_doc_compare', context, inlineImageRule)` →
  返回字符串包含 `'图片内嵌'`
- When 调用 `buildSystemPromptByIntent('kb_meta', context, inlineImageRule)` →
  **不**包含 `'图片内嵌'`（kb_meta 不需要图）
- When 调用 `buildSystemPromptByIntent('out_of_scope', context, inlineImageRule)` →
  **不**包含 `'图片内嵌'`（out_of_scope 不需要图）

### Scenario: 共享输出格式段

- For each `intent in [factual_lookup, language_op, multi_doc_compare]`:
- Then 返回字符串包含 `'【输出格式】'`
- And 包含 `'数字 + 单位写在一起'`
- And 包含 `'答案末尾**不**写"以上信息来源于'`

---

## factual_lookup · 关键约束

### Scenario: 含 verbatim 强制 + 找不到诚实声明

- When 调用 `buildSystemPromptByIntent('factual_lookup', context)`
- Then 返回字符串包含 `'verbatim'`
- And 包含 `'数值'`、`'规格'`、`'单位'`、`'缩写'`、`'专有名词'`
- And 包含 `'禁止使用模糊措辞'`
- And 包含 `'每个事实陈述后加 [N] 引用'`
- And 包含 `'复合答案不要漏组件'`

### Scenario: 不含语言层例外（语义已转移到 language_op）

- When 调用 `buildSystemPromptByIntent('factual_lookup', context)`
- Then 返回字符串**不**包含 `'语言层操作'` / `'语言层转换'` 例外条款

---

## language_op · 关键约束

### Scenario: 必须执行 + 不能拒答 + 透明度声明

- When 调用 `buildSystemPromptByIntent('language_op', context)`
- Then 返回字符串包含 `'必须执行'`
- And 包含 `'不能拒答'`（明确反指"知识库中没有解释" 这种错误回答）
- And 包含 `'透明度声明'`（要求末尾标注"以上仅就文档原文做..."）

### Scenario: 罗列允许的转换类型

- When 调用 `buildSystemPromptByIntent('language_op', context)`
- Then 返回字符串包含 `'翻译'`、`'释义'`、`'白话'`、`'总结'`、`'改写'`、`'列表化'`、`'提炼要点'`

### Scenario: 仍禁止引入外部知识

- When 调用 `buildSystemPromptByIntent('language_op', context)`
- Then 返回字符串包含 `'不可'` 补充 `'背景'`、`'作者意图'`、`'注疏'`、`'历史源流'`、`'评价'`、`'推断'`

### Scenario: 数值 verbatim 仍生效

- When 调用 `buildSystemPromptByIntent('language_op', context)`
- Then 返回字符串包含 `'保留原文事实精度'` 或类似措辞
- And 包含 `'verbatim'` 或 `'不近似'`

---

## multi_doc_compare · 关键约束

### Scenario: 强制结构化 + 不漏组件 + 同维度对齐

- When 调用 `buildSystemPromptByIntent('multi_doc_compare', context)`
- Then 返回字符串包含 `'结构化分项'` 或 `'对比表格'`
- And 包含 `'不漏组件'`
- And 包含 `'同维度对齐'`

### Scenario: 缺资产时显式声明

- When 调用 `buildSystemPromptByIntent('multi_doc_compare', context)`
- Then 返回字符串包含 `'文档未提及'` 或类似显式声明（不能假装某对象有该信息）

---

## kb_meta · 关键约束

### Scenario: 只列资产标题，不进文档内容

- When 调用 `buildSystemPromptByIntent('kb_meta', context)`
- Then 返回字符串包含 `'只列召回的文档标题'` 或 `'asset_name'`
- And 包含 `'不进文档内容描述'` 或 `'不要总结文档内容'`
- And 包含 `'不加 [N] 引用'`（这类问题用引用反而冗余）

### Scenario: 召回少时引导用户

- When 调用 `buildSystemPromptByIntent('kb_meta', context)`
- Then 返回字符串包含 `'资产目录'` 或 `'建议在「资产目录」里用关键词搜索'` 类引导

---

## out_of_scope · 关键约束

### Scenario: 直接说找不到 + 不发挥

- When 调用 `buildSystemPromptByIntent('out_of_scope', context)`
- Then 返回字符串包含 `'知识库中没有'`
- And 包含 `'不要凭外部知识回答'`
- And 包含 `'不要发挥'`
- And 包含 `'不加 [N] 引用'`

### Scenario: 列沾边资产供用户参考

- When 调用 `buildSystemPromptByIntent('out_of_scope', context)`
- Then 返回字符串包含 `'以下文档可能相关'` 或 `'建议查阅原文'` 类引导
