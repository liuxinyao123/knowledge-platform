# Spec: D-003 评估集 case schema

## 文件：eval/multidoc-set.jsonl

每行一条 JSON 对象（兼容 `//` 和 `#` 开头的注释行，跟现有 `eval-recall.mjs` 一致）。

## 必填字段

```jsonc
{
  "id": "string",                    // 唯一 ID，建议 D003-Q01 / D003-V3A 等
  "doc_type": "string",              // 6 选 1 枚举
  "question": "string"               // 用户问题
}
```

## 可选字段

```jsonc
{
  "history": [                       // follow-up 模拟，最多 20 轮
    { "role": "user" | "assistant", "content": "string" }
  ],
  "expected_intent": "string|null",  // 5 选 1 或 null（跳过断言）
  "expected_pattern_type": "string|null",  // 5 选 1 或 null
  "expected_keywords": ["string", ...],    // 必须出现的关键词，AND
  "expected_must_not_contain": ["string", ...],  // 不能出现的词，AND
  "expected_asset_ids": [number, ...],     // 资产召回，向后兼容现有 eval
  "expected_recall_top_k": 3,              // recall@K 用，默认 3
  "must_pass": false,                      // 是否核心 case，true 时 strict 模式必须通过
  "data_version": "2026-04-28",           // 数据快照日期，用于 drift 检测
  "comment": "string"                      // 给自己看的备注
}
```

## 枚举约束

### `doc_type`

```
classical_chinese    古典中文文献
industrial_sop_en    英文工业 SOP
cn_product_doc       中文产品文档
table_xlsx           表格类
presentation_pptx    演示稿
short_news_md        短资讯
```

### `expected_intent`

```
factual_lookup       事实查询
language_op          语言层操作
multi_doc_compare    多对象对比
kb_meta              库元查询
out_of_scope         超范围
null                 跳过本维度断言
```

（与 `apps/qa-service/src/services/answerIntent.ts` `AnswerIntent` 一致）

### `expected_pattern_type`

```
verbatim     答案含数值/规格 verbatim 提取
bilingual    答案中英对照（翻译类）
list         答案分点编号
refusal      答案明示找不到
asset_list   答案列资产标题
null         跳过本维度断言
```

---

## 行为契约

### Scenario: 注释行被 runner 跳过

- Given jsonl 文件含 `// 注释` 或 `# 注释` 行
- When runner 解析 jsonl
- Then 注释行被跳过，不视为 case

### Scenario: 必填字段缺失 → runner 报错退出

- Given case 缺 `id` 或 `doc_type` 或 `question`
- When runner 启动
- Then 输出 `❌ Case [行号] 缺必填字段：[字段名]` 并退 1

### Scenario: doc_type 非合法枚举 → runner 报错

- Given case `doc_type = "unknown_type"`
- When runner 启动
- Then 输出 `❌ Case [id] doc_type 非法：[unknown_type]` 并退 1

### Scenario: expected_intent 非合法枚举 → runner 报错

- 同上，限合法 5 类 + null

### Scenario: expected_pattern_type 非合法 → 报错

- 同上，限合法 5 类 + null

### Scenario: 可选字段缺省 → 该维度跳过断言（不影响其它维度）

- Given case 不含 `expected_keywords`
- When runner 跑该 case
- Then `assertKeywords` 返回 `{ pass: true, reason: 'skipped (no expected_keywords)' }`
- And 其它维度照常跑

### Scenario: data_version drift 检测

- Given case 标 `data_version = "2026-04-28"`
- And 当前库里 `metadata_asset` 最大 `indexed_at` < case data_version
- When runner 启动
- Then 输出 WARN：`⚠ data drift: case D003-Q15 标 2026-04-28，库内最大 indexed_at 2026-04-25`
- And 继续跑（不阻塞，只警告）

### Scenario: must_pass case 失败时严格模式退 1

- Given case `must_pass = true`
- And runner 加 `--strict` flag
- And 该 case 任一断言 fail
- When runner 结束
- Then `process.exit(1)`
- And 输出 `❌ MUST-PASS case D003-V3B fail (strict mode)`

### Scenario: must_pass 失败但非 strict 模式 → 仅警告

- Given 同上但无 `--strict`
- When runner 结束
- Then `process.exit(0)`
- And 输出 `⚠ MUST-PASS case D003-V3B fail (non-strict, exit 0)`