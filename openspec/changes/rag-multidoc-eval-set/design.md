# Design: RAG 多文档类型评估集（D-003）

## 架构总览

```
┌─── eval/multidoc-set.jsonl ────────────────────┐
│  60 case，每条：                                │
│  { id, doc_type, question, history?,           │
│    expected_intent?, expected_pattern_type?,   │
│    expected_keywords[], expected_must_not_     │
│    contain[], expected_asset_ids[],            │
│    expected_recall_top_k, data_version,        │
│    must_pass?, comment }                        │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌─── scripts/eval-multidoc.mjs ──────────────────┐
│ 1. parseJsonl(eval/multidoc-set.jsonl)         │
│    └ 跳过 // 注释行（兼容现有格式）             │
│ 2. login(admin@dsclaw.local) → token           │
│ 3. for each case:                              │
│    ├ POST /api/agent/dispatch                  │
│    │   { question, history, session_id }       │
│    ├ collect SSE events:                       │
│    │   - agent_selected.intent                 │
│    │   - rag_step icon='🪄'/'🎭'/'⛔'           │
│    │   - trace.citations[].asset_id            │
│    │   - content tokens 拼成 answer            │
│    └ runAssertions(case, observed):            │
│       7 个独立 assertion fn                    │
│ 4. aggregate report:                           │
│    - byDimension / byDocType / byIntent        │
│    - failed details with full SSE payload      │
└────────────────────────────────────────────────┘
```

## 模块边界

| 文件 | 职责 |
|---|---|
| `eval/multidoc-set.jsonl` | 评估数据 |
| `scripts/eval-multidoc.mjs` | runner（jsonl 解析 + dispatch + 断言 + 报告） |
| `scripts/eval-multidoc-lib.mjs` | 内部库：assertions / SSE 解析 / fetcher（拆出便于测试）|
| `eval/README.md` | 文档（"D-003 多维度评测怎么跑"段） |

## case schema

```jsonc
{
  // ── 必填 ──
  "id": "D003-Q15-light",
  "doc_type": "industrial_sop_en",
  "question": "尾门摆动研究中 Zone 1 和 Zone 2 向顶盖方向偏移多少？",
  
  // ── 期望意图断言（null = 跳过这一维）──
  "expected_intent": "factual_lookup",
  
  // ── 期望答案模式断言（null = 跳过）──
  "expected_pattern_type": "verbatim",
  
  // ── 期望关键词（all-of，AND）──
  "expected_keywords": ["1.0mm", "0.3mm", "0.7mm"],
  
  // ── 期望不出现的词（none-of，AND）──
  "expected_must_not_contain": ["大约", "可能", "似乎"],
  
  // ── 资产召回（向后兼容）──
  "expected_asset_ids": [35],
  "expected_recall_top_k": 3,
  
  // ── follow-up 模拟 ──
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  
  // ── 关键 case 必须 100% 通过（V-3 级核心 case）──
  "must_pass": true,
  
  // ── 库 schema 校验 ──
  "data_version": "2026-04-28",
  
  // ── 注释 ──
  "comment": "§1.1.1 p.[6] · basic_fact/medium · 期望: 1.0mm = 0.3mm油漆变差 + 0.7mm铰链公差"
}
```

### `doc_type` 枚举（6 类）

```
classical_chinese   古典中文（道德经类）
industrial_sop_en   英文工业 SOP（LFTGATE / Bumper）
cn_product_doc      中文产品文档（知识中台需求.md）
table_xlsx          表格类（GM 评测集）
presentation_pptx   演示稿（报价汇总）
short_news_md       短资讯（今日头条）
```

### `expected_pattern_type` 枚举（5 类抽象模板）

```
verbatim       含数值/规格 verbatim 提取（factual_lookup 标准）
bilingual      中英对照（language_op 翻译）
list           分点编号（language_op 总结 / multi_doc_compare）
refusal        明示找不到（factual_lookup / out_of_scope 真实没有）
asset_list     列资产标题不进内容（kb_meta）
```

## 7 类 assertion 实现

```ts
// 接口契约（runner 内部 lib）
interface Observed {
  topIntent: string                  // 顶层 agent_selected.intent
  answerIntent: string | null        // 档 B 🎭 emit
  rewriteByCondense: boolean         // 是否触发 🪄
  shortCircuited: boolean            // 是否走 ⛔ 兜底
  citations: { asset_id: number; rank: number }[]
  answer: string                     // 拼接后的完整答案
  rawSseLines: string[]              // 失败时附原始 SSE 便于调试
}

interface AssertResult {
  pass: boolean
  reason: string  // 失败时的原因
}

// 7 个 assertion fn
function assertIntent(c, o): AssertResult
function assertPatternType(c, o): AssertResult
function assertKeywords(c, o): AssertResult
function assertMustNotContain(c, o): AssertResult
function assertRecallTopK(c, o): AssertResult
function assertTransparencyDeclaration(c, o): AssertResult  // 仅 language_op
function assertNonRefusalForLangOp(c, o): AssertResult       // 仅 language_op
```

### Pattern type 检测规则

- `verbatim`：答案包含至少 1 个数字 + 单位（regex `/\d+(\.\d+)?\s*(mm|cm|m|°|deg|%|kg)/i`）
- `bilingual`：答案至少 30% 字符是中文 AND 至少 30% 是 ASCII（粗略中英对照）
- `list`：答案行数 ≥ 3 AND 至少 2 行以 `[·\-\d]+\.?\s+` 开头
- `refusal`：答案 includes 任一：`知识库中没有` / `暂时没有` / `not in the knowledge base`
- `asset_list`：答案 includes `.pdf` / `.xlsx` / `.md` / `.pptx` 标题字符 ≥ 1

### Transparency declaration 规则（language_op only）

答案末尾 200 字符内必须 includes 任一：
- `"以上仅就"` (中文常见样式)
- `"未引入外部"`
- `"based on the original"` (英文样式)
- `"document only"`

### Non-refusal-for-lang-op 规则

language_op case 的答案**不能** includes refusal 标识词（`知识库中没有` / `not in...`），
否则失败（语义：language_op 必须做转换不能拒答）。

## report 格式

```
====== D-003 RAG Multi-doc Eval ======
Date: 2026-04-28T17:30:00Z
Total: 60 cases × 7 dims (其中 must_pass: 8 cases must 100%)

按维度:
  intent_correct       │ 51/60  85.0%
  pattern_type_match   │ 47/60  78.3%
  keywords_hit         │ 49/60  81.7%
  must_not_contain     │ 58/60  96.7%
  recall_top_3         │ 53/60  88.3%
  transparency_decl    │ 14/15  93.3% (仅 language_op case)
  non_refusal_for_lop  │ 13/15  86.7% (仅 language_op case)

按 doc_type:
  classical_chinese    │  8/ 8  100%
  industrial_sop_en    │  9/12   75.0%
  cn_product_doc       │  8/ 8  100%
  table_xlsx           │  5/10   50.0%  ⚠ kb_meta 类多
  presentation_pptx    │  4/ 6   66.7%
  short_news_md        │  6/ 6  100%

按 intent (按 expected_intent 分组):
  factual_lookup       │ 22/25  88.0%
  language_op          │ 13/15  86.7%
  multi_doc_compare    │  8/ 8  100%
  kb_meta              │  4/ 8   50.0%  ⚠ V3D 同根因
  out_of_scope         │  4/ 4  100%

must_pass cases:
  PASS: D003-Q01-light (case2a 等价)
  PASS: D003-Q15 ...
  FAIL: D003-Q22-light :: assertIntent
        expected: kb_meta got: factual_lookup (fallback by short-circuit)

Failed cases (5):
  D003-Q22-light  kb_meta · expected_intent=kb_meta got=null (short-circuit)
                  raw SSE 节选: ...
  D003-Q31  industrial_sop_en · expected_keywords ["8.0mm"] not found
                  answer prefix: "塑料对金属的最小间隙..."
  ...
```

## env / 运行

```bash
# 默认跑全集（60 case，~3 分钟）
node scripts/eval-multidoc.mjs

# 抽样跑（debug）
node scripts/eval-multidoc.mjs --sample 10

# 指定数据集（默认 eval/multidoc-set.jsonl）
node scripts/eval-multidoc.mjs eval/some-other.jsonl

# 严格模式（must_pass 任一 fail 整体退 1）
node scripts/eval-multidoc.mjs --strict

# 仅跑某 doc_type
node scripts/eval-multidoc.mjs --doc-type industrial_sop_en

# 仅跑某 intent
node scripts/eval-multidoc.mjs --intent language_op
```

env 依赖：
- `EVAL_API`（默认 `http://localhost:3001`）
- `EVAL_ADMIN_EMAIL`（默认 `admin@dsclaw.local`）
- `EVAL_ADMIN_PASSWORD`（默认 `admin123`）

## 失败模式 + 回滚

| 故障 | 行为 | 回滚 |
|---|---|---|
| qa-service 没起 | runner 启动校验 fail，退 1 | 起 service 再跑 |
| token 拿不到 | 同上 | 检查 admin 凭据 |
| LLM 5xx | 单 case 标 `error`，继续跑其它 | 跳过失败 case；重跑只跑 failed |
| 单 case timeout | curl --max-time 60；超时标 fail | 同上 |

## 与现有架构关系

- **跟 `scripts/eval-recall.mjs` 共存**：两个 runner 互补；`eval-recall` 看
  recall 单一指标，`eval-multidoc` 看多维度
- **`eval/golden-set.template.jsonl` 不动**：现有用户继续用
- **新 case 用新 schema 写到 `eval/multidoc-set.jsonl`**：旧 case 也可以补字段升级
- **复用 `apps/qa-service/.dev-logs/qa-service.log`**：runner 出错时附本地 log 路径
- **不引入 npm 新依赖**：纯 Node 内置 fetch + JSON 解析

## V-3 期间 7 case 转 jsonl 起步

把上轮手测的 7 case 直接转成 D-003 起步 case：

```
D003-V3A → V3A 中文产品文档总结 (cn_product_doc / language_op / list)
D003-V3B → V3B 英→中翻译 (industrial_sop_en / language_op / bilingual) [must_pass]
D003-V3B-prime → V3B' 中→英 (cn_product_doc / language_op / bilingual)
D003-V3B-prime2 → V3B'' 总结今日头条 (short_news_md / language_op / list)
D003-V3C → V3C "what is over slam" (industrial_sop_en / factual_lookup / refusal) ⚠ 已知 lim
D003-V3D → V3D 库里有汽车资料 (table_xlsx / kb_meta / asset_list) ⚠ 待 D-002.2
D003-V3E → V3E 为什么 GM 写 (industrial_sop_en / out_of_scope / asset_list) [must_pass]
D003-case2a → case2a 给他的原文的解释 (classical_chinese / language_op / list) [must_pass]
```

剩下 ≥ 50 case 由 D-003 实施时按 doc_type 矩阵补全。
