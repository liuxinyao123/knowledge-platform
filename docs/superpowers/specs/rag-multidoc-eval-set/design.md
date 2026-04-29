# Explore · RAG 多文档类型评估集（D-003）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore（不进主分支，仅作 Lock 阶段输入）
> 上游依赖：rag-followup-condensation + rag-intent-routing（刚 freeze）
> 后续消费：D-002.2 kb_meta 路由 + D-002.3 language_op function tool 都需要本评估集做回归

## 背景

rag-intent-routing change 的 V-3 实测（手动 7 case）暴露两个核心矛盾：

1. **手动实测覆盖率低**：每次代码改动都要人工跑 6-10 个 case 看输出，无法量化。
2. **现有 `eval/` 只评 recall@K**：只看资产级召回（"对的文档有没有进 top-K"），
   不评意图分类正确率、答案质量、language_op 输出格式、拒答率等档 B 引入的新维度。

V-3 的 V3C / V3D 已知 limitation 也是因为**没有量化基线**——不知道 limitation 的
影响面有多大、改进后多少 case 能修。

D-002.2（kb_meta 路由）和 D-002.3（language_op function tool）要落地，必须先有
**多文档类型 + 多维度评估集**做回归基线。

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 全新评估框架**（Promptfoo / Ragas / 自建 SaaS）| 引入第三方评估库 + 多维度 metrics + 自动 LLM judge | 复杂度高、引入新依赖、跟现有 `eval/` jsonl 重复 |
| **C-B 扩展现有 `eval/`**（选中）| 复用 jsonl schema + 加新字段（expected_intent / expected_pattern_type / expected_keywords / expected_must_not_contain）+ 扩展 runner 跑端到端 dispatch 抽 SSE 多维度断言 | 改动 contained、复用现有运维路径、可增量扩 |
| **C-C eval-as-vitest**（把 case 写成 vitest 集成测试）| 每 case 一个 test，断言 SSE 事件 / 答案关键词 | 跑得慢（每 case 调真实 LLM）、CI 不友好、跟单元测试混淆 |

**结论**：走 C-B。复用 `eval/` 的 jsonl + 扩 schema + 扩 runner。

## 文档类型选取（覆盖率证明）

按"任意文档兼容"目标，挑 6 类已入库文档（参考 V-3 期间从 `/api/knowledge/documents`
拿到的 13 个文档清单）：

| 文档类型 | 代表样本（库内已有）| 测试维度重点 |
|---|---|---|
| 古典中文文献 | #20 道德经.pdf | language_op 白话翻译 / 元指令分类 |
| 工业 SOP 英文 | #5 LFTGATE-32 / #1 LFTGATE-3 / #2 Bumper Integration | factual_lookup verbatim 数值 / 中英翻译 |
| 中文产品需求 | #18 知识中台产品需求文档.md | language_op 总结 / multi_doc_compare |
| 表格类 | #19/#17/#16/#12 GM_尾门工程评测集.xlsx | factual_lookup 跨行查询 / kb_meta 列资产 |
| 演示稿 | #13 报价汇总.pptx | factual_lookup 数字提取 / out_of_scope 推断 |
| 短资讯 | #4 今日头条.md | 极少数据下的 language_op 退化处理 |

**每类 ≥ 8 case**，覆盖 5 类意图（factual_lookup / language_op / multi_doc_compare /
kb_meta / out_of_scope），共 50-60 case。

## 评估维度

| 维度 | 现有 eval | D-003 新增 |
|---|---|---|
| 资产召回率 | recall@1/3/5 ✓ | 保留 |
| **意图分类正确率** | — | **新**：emit `🎭` intent vs expected_intent |
| **答案模式符合度** | — | **新**：expected_pattern_type ∈ {verbatim/bilingual/list/refusal/asset_list} |
| **关键词命中** | — | **新**：expected_keywords[] 必须出现 |
| **禁词检测** | — | **新**：expected_must_not_contain[] 不能出现（如 "知识库中没有"对 language_op 是禁词）|
| **透明度声明覆盖** | — | **新**：language_op case 末尾必须含"以上仅就...未引入..."类声明 |
| **延迟统计** | — | **新（可选）**：每 case end-to-end ms |
| **拒答率** | — | **新（聚合）**：每意图类的 refusal 比例 |

## eval case schema

```jsonc
{
  "id": "D003-Q15-light",            // 必填，唯一
  "doc_type": "industrial_sop_en",   // 必填，6 选 1
  "question": "...",                 // 必填
  "history": [                       // 可选，模拟 follow-up
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "expected_intent": "factual_lookup",  // 5 选 1，allow null = 不评估
  "expected_pattern_type": "verbatim",  // verbatim / bilingual / list / refusal / asset_list / null
  "expected_keywords": ["1.0mm", "0.3mm"],  // 答案必须 includes 全部
  "expected_must_not_contain": ["大约", "可能"],  // 答案不能 includes 任一
  "expected_asset_ids": [35],        // 资产召回（向后兼容现有 eval）
  "expected_recall_top_k": 3,        // recall@K 用
  "comment": "§1.1.1 p.[6] · basic_fact/medium"
}
```

**字段约定**：
- `expected_intent: null` → 跳过意图分类断言（如 short-circuit case）
- `expected_pattern_type` 是抽象模板分类：
  - `verbatim`：含数值/规格 verbatim 提取（factual_lookup 标准）
  - `bilingual`：中英对照（language_op 翻译）
  - `list`：分点编号（language_op 总结 / multi_doc_compare）
  - `refusal`：明示找不到（factual_lookup / out_of_scope 真实没有）
  - `asset_list`：列资产标题不进内容（kb_meta）

## eval runner 架构

```
┌─── apps/qa-service/scripts/eval-multidoc.mjs ───┐
│ 1. 读 eval/multidoc-set.jsonl                  │
│ 2. 拿 admin token（自动登录）                   │
│ 3. 对每条 case：                                │
│    ├ POST /api/agent/dispatch（含 history）     │
│    ├ 抽 SSE 事件流：                            │
│    │   - 🤖 agent_selected.intent              │
│    │   - 🪄 condense rewrite                   │
│    │   - 🎭 answer intent                      │
│    │   - 📊 trace.citations[].asset_id         │
│    │   - 💬 content tokens 拼接                │
│    └ 跑 7 类断言：                              │
│       - assertIntent                            │
│       - assertPatternType                       │
│       - assertKeywords                          │
│       - assertMustNotContain                    │
│       - assertRecallTopK                        │
│       - assertTransparencyDeclaration（lang_op）│
│       - assertNonRefusalForLangOp               │
│ 4. 输出汇总：                                   │
│    - 每维度通过率                               │
│    - 按 doc_type / intent 分组                  │
│    - failed case 详情（带原 SSE）              │
└────────────────────────────────────────────────┘
```

## eval 报告输出格式

```
====== D-003 RAG Multi-doc Eval ======
Total: 60 cases × 7 dims = 420 assertions

按维度:
  intent_correct       │ 51/60  85.0%
  pattern_type_match   │ 47/60  78.3%
  keywords_hit         │ 49/60  81.7%
  must_not_contain     │ 58/60  96.7%
  recall_top_3         │ 53/60  88.3%
  transparency_decl    │ 14/15  93.3% (仅 language_op case)
  non_refusal_for_lop  │ 13/15  86.7% (仅 language_op case)

按 doc_type:
  classical_chinese    │ 8/8   100% ✓
  industrial_sop_en    │ 9/12  75.0%
  cn_product_doc       │ 8/8   100% ✓
  table_xlsx           │ 5/10  50.0%  ⚠️ kb_meta 类多，命中 short-circuit
  presentation_pptx    │ 4/6   66.7%
  short_news_md        │ 6/6   100% ✓

按 intent:
  factual_lookup       │ 22/25  88.0%
  language_op          │ 13/15  86.7%
  multi_doc_compare    │ 8/8   100%
  kb_meta              │ 4/8   50.0%   ⚠️ V3D 同根因，待 D-002.2
  out_of_scope         │ 4/4   100%

Failed cases:
  D003-Q22-light: kb_meta · expected_intent=kb_meta got=fallback (short-circuit)
  D003-Q31: industrial_sop_en · expected_keywords ["8.0mm"] not found in answer
  ...
```

## 风险

| 风险 | 缓解 |
|---|---|
| **eval 跑一次 ~3 分钟**（60 case × 真 LLM 调用 + retrieval）| 默认 manual 跑，不进 CI；可选 `--sample 10` 抽样模式 |
| **expected_keywords 太严** → 误报 | 用 OR 组合（任一命中即可）+ pattern_type 抽象兜底 |
| **LLM 答案有随机性** → flake | 多 case 反复跑取均值；temperature 0.1；critical case 标 `must_pass: true` 必须 100% |
| **case 造起来累** | V-3 已经手测了 7 case 可以直接转 jsonl；其它每类 8 case 半小时即可 |
| **data drift**（库里文档变了 expected 失效）| jsonl 加 `data_version` 字段；runner 启动校验 metadata_asset.indexed_at 跟 case 标注是否一致 |

## 与现有 eval 的关系

- **保留 `eval/golden-set.template.jsonl` + `eval/gm-liftgate*.jsonl`** 作为
  recall@K only 评测；不动 `scripts/eval-recall.mjs`
- **新增 `eval/multidoc-set.jsonl`** + `scripts/eval-multidoc.mjs` 跑多维度
- D-003 完成后，`eval-recall.mjs` 跟 `eval-multidoc.mjs` 共存（覆盖不同维度）

## Out of Scope（明确不做）

- **LLM-as-judge 自动评分**：本 change 用规则断言（keywords/pattern_type）保证
  确定性；judge 引入概率层后续再说
- **CI 集成**：默认 manual；CI 阶段可后续加 `--sample 5 --strict-must-pass`
- **multi-tenant case 隔离**：所有 case 用 admin token + 全库 search
- **跨语言回归集**：本 change 限中英；日 / 韩等语种数据不足

## 后续路径

1. **本 change 落地** = D-002.2 / D-002.3 的回归基线就绪
2. **D-002.2** kb_meta 路由 asset_catalog → 跑 D-003 看 kb_meta 通过率从 50% → 期望 ≥ 90%
3. **D-002.3** language_op function tool → 跑 D-003 看 language_op 通过率 + 透明度声明 100%
4. **D-005（候选）**：LLM-as-judge 评分（自动判断答案质量）
5. **D-006（候选）**：CI 跑 sample → 防回归
