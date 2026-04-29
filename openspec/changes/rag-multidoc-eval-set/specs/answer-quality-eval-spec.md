# Spec: D-003 答案质量断言

## 模块：scripts/eval-multidoc-lib.mjs · 4 个 assertion fn

```ts
function assertPatternType(c, o): { pass: boolean; reason: string }
function assertKeywords(c, o): { pass: boolean; reason: string }
function assertMustNotContain(c, o): { pass: boolean; reason: string }
function assertTransparencyDeclaration(c, o): { pass: boolean; reason: string }
function assertNonRefusalForLangOp(c, o): { pass: boolean; reason: string }
```

---

## assertPatternType · 5 类抽象模板检测

### `verbatim` 检测规则

- 答案 includes 至少 1 个数字 + 单位组合
- 检测 regex：`/\d+(\.\d+)?\s*(mm|cm|m|°|deg|degrees?|%|kg|g|ms|s)\b/i`

### Scenario: verbatim case 含数字 + 单位 → pass

- Given `c.expected_pattern_type = 'verbatim'`
- And `o.answer = '设计间隙 2.0mm，键槽朝下 [1]'`
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: true, reason: 'verbatim: matched 1 numeric+unit' }`

### Scenario: verbatim case 无数字 → fail

- Given `c.expected_pattern_type = 'verbatim'`
- And `o.answer = '塑料对金属的最小间隙要求'`（无数字单位）
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: false, reason: 'verbatim: no numeric+unit found' }`

### `bilingual` 检测规则

- 答案中文字符数 ≥ 30% AND ASCII 字符数 ≥ 30%
- 中文字符：`/[\u4e00-\u9fa5]/`

### Scenario: bilingual 答案 → pass

- Given `c.expected_pattern_type = 'bilingual'`
- And `o.answer = '根据 LFTGATE-32 的最佳实践，摆动间隙由 alpha 角和 beta 角定义...'`
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: true, reason: 'bilingual: cn ≥ 30% & ascii ≥ 30%' }`

### `list` 检测规则

- 答案行数 ≥ 3
- 至少 2 行以 `[·\-\d]+\.?\s+` 开头（编号或项目符号）

### Scenario: list 答案 → pass

- Given `c.expected_pattern_type = 'list'`
- And `o.answer = '1. 第一点\n2. 第二点\n3. 第三点'`
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: true, reason: 'list: 3 numbered lines' }`

### `refusal` 检测规则

- 答案 includes 任一：
  - `知识库中没有`
  - `暂时没有`
  - `没有相关`
  - `not found in the knowledge`
  - `no relevant content`

### Scenario: refusal 答案 → pass

- Given `c.expected_pattern_type = 'refusal'`
- And `o.answer = '知识库中没有相关内容 [1][2]'`
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: true, reason: 'refusal: matched marker' }`

### `asset_list` 检测规则

- 答案 includes ≥ 1 个文档扩展名：`.pdf` / `.xlsx` / `.md` / `.pptx` / `.docx`
- 或 includes "找到以下" / "以下文档" 类引导词

### Scenario: asset_list 答案 → pass

- Given `c.expected_pattern_type = 'asset_list'`
- And `o.answer = '找到以下相关文档：\n· LFTGATE-32.pdf\n· Bumper.pdf'`
- When 调用 `assertPatternType(c, o)`
- Then 返回 `{ pass: true, reason: 'asset_list: 2 doc extensions' }`

---

## assertKeywords · all-of AND

### Scenario: 全部 keywords 命中 → pass

- Given `c.expected_keywords = ['1.0mm', '0.3mm', '0.7mm']`
- And `o.answer = '1.0mm = 0.3mm（油漆变差）+ 0.7mm（铰链公差）[1]'`
- When 调用 `assertKeywords(c, o)`
- Then 返回 `{ pass: true, reason: 'all 3 keywords hit' }`

### Scenario: 任一 keyword 缺 → fail

- Given `c.expected_keywords = ['1.0mm', '0.3mm', '0.7mm']`
- And `o.answer = '1.0mm = 0.3mm + 油漆变差'`（缺 0.7mm）
- When 调用 `assertKeywords(c, o)`
- Then 返回 `{ pass: false, reason: 'missing: ["0.7mm"]' }`

### Scenario: expected_keywords = [] → skip

- Given `c.expected_keywords = []` 或字段缺
- When 调用
- Then 返回 `{ pass: true, reason: 'skipped (no keywords)' }`

### Scenario: keyword 大小写不敏感（英文）

- Given `c.expected_keywords = ['LFTGATE']`
- And `o.answer = 'lftgate-32 best practice'`
- When 调用
- Then 返回 `{ pass: true, reason: 'all 1 keywords hit (case-insensitive)' }`

---

## assertMustNotContain · none-of AND

### Scenario: 任一禁词出现 → fail

- Given `c.expected_must_not_contain = ['大约', '可能', '似乎']`
- And `o.answer = '设计间隙大约 2.0mm'`
- When 调用 `assertMustNotContain(c, o)`
- Then 返回 `{ pass: false, reason: 'forbidden: ["大约"]' }`

### Scenario: 全部禁词都不出现 → pass

- Given `c.expected_must_not_contain = ['大约', '可能']`
- And `o.answer = '设计间隙 2.0mm [1]'`
- When 调用
- Then 返回 `{ pass: true, reason: '0 forbidden words found' }`

---

## assertTransparencyDeclaration · 仅 language_op case

### Scenario: 仅 language_op 走此断言

- Given `c.expected_intent !== 'language_op'`
- When 调用 `assertTransparencyDeclaration(c, o)`
- Then 返回 `{ pass: true, reason: 'skipped (not language_op)' }`

### Scenario: language_op 答案末尾有透明度声明 → pass

- Given `c.expected_intent = 'language_op'`
- And `o.answer` 末尾 200 字符 includes `'以上仅就'` 或 `'未引入外部'` 或
  `'based on the original'` 或 `'document only'`
- When 调用
- Then 返回 `{ pass: true, reason: 'transparency declaration found' }`

### Scenario: language_op 答案缺透明度声明 → fail

- Given `c.expected_intent = 'language_op'`
- And `o.answer` 末尾 200 字符**不**含上述 markers
- When 调用
- Then 返回 `{ pass: false, reason: 'missing transparency declaration in last 200 chars' }`

---

## assertNonRefusalForLangOp · 仅 language_op case

### Scenario: 仅 language_op 走此断言

- Given `c.expected_intent !== 'language_op'`
- When 调用
- Then 返回 `{ pass: true, reason: 'skipped (not language_op)' }`

### Scenario: language_op 答案含 refusal 标识 → fail

- Given `c.expected_intent = 'language_op'`
- And `o.answer` includes `'知识库中没有'` 或 `'暂时没有'`
- When 调用
- Then 返回 `{ pass: false, reason: 'language_op refused (V3B class regression)' }`

### Scenario: language_op 答案不含 refusal → pass

- Given `c.expected_intent = 'language_op'`
- And `o.answer` 是真实翻译/释义/总结
- When 调用
- Then 返回 `{ pass: true, reason: 'no refusal markers' }`