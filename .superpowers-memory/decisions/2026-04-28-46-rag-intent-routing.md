# ADR 2026-04-28-46 · RAG generation 走意图分流 handler（取代 monolithic prompt patch）

## Context

实地调优 follow-up 问题失败 case 时发现两类现象：

1. **"那你把原文发我"被 short-circuit 兜底**（rerank top-1 = 0.027）—— 真根因
   是 retrieval 没用 history。**结构化解**：在 retrieval 之前用 fast LLM 把
   短/指代型问题改写成自洽问句（`services/condenseQuestion.ts`，A condense）。
   已落地，与本 ADR 无关。

2. **"给他的原文的解释"被拒答** —— LLM 把"对召回原文做翻译/释义"理解为
   "需要外部知识"，按 system prompt 规则 1 拒答。第一直觉是改 prompt：在规则 1
   加"语言层操作例外"条款 + 示例 4（道德经第一章 → 逐句白话）。实测有效。

但 user 当面反馈：**"上传的文档不能那么固定"** —— 知识库实际场景里文档形态
跨工业制造、合同、医疗、英文 paper、财报多种领域。示例 4 用道德经古文锚定
"翻译/释义"语义，对其他文档类型反而是偏置；同理，原有示例 1-3（mm 公差 /
0.3+0.7 偏移 / COF 缩写）是工业制造场景的具象案例，对法律/医疗文档同样偏置。

**核心洞察**：纯 prompt 调优是末梢治理。

- prompt 是概率约束不是规则约束，越长越漂
- 强模型 zero-shot 也能 follow，弱模型给再多示例也飘
- 为每个新场景打 prompt patch → prompt 永远在膨胀
- 真问题（数据缺失 / 召回不准 / 模型对元指令理解失败）被"语言层例外"
  这种条款掩盖在表面之下

## Decision

### D-001 移除 hardcoded 示例，但保留通用边界条款（即时执行 · 本 ADR 同分支）

**`apps/qa-service/src/services/ragPipeline.ts` `defaultSystem`**：

- **删除**示例 1-4（mm 公差 / 0.3+0.7 偏移 / COF 缩写 / 道德经白话）——
  全部绑定具体文档形态（工业制造 + 古典文献），对其他领域是偏置锚点
- **删除**作答步骤段（基本是规则的复述）
- **保留**硬性规则 1 的"语言层操作例外"条款 —— 这条**没有提到任何具体文档
  形态**，是对"语言层转换 vs 引入外部知识"边界的抽象定义，**完全通用**：
  无论文档是古文、合同、技术 SOP、英文 paper、财报，"对召回原文做翻译/释义/
  总结" 都成立
- **保留**：硬性规则 1-5（边界 + 输出精度）、输出格式段、ADR-45 的 inline image 规则 6

**关键区分**：
  - "语言层例外"是**抽象边界声明**（规则文本里只出现"翻译/释义/总结/改写/
    列表化"等通用动词，不出现任何具体文档/领域词）
  - "示例 4"是**具体场景示范**（用《道德经》第一章原文做 few-shot 锚定）
  - 前者是规则定义，后者是 hardcoded 偏置——撤回前者属于矫枉过正，
    会让 LLM 又回到拒答合理元指令的状态

变更后 prompt = 抽象规则（含语言层例外边界） + 文档形态无关的输出约束 +
0 个具体示例。

### D-002 长期方向：意图分类 + 专用 handler（待实施）

把 `KnowledgeQaAgent.run()` 内的 monolithic `runRagPipeline` 拆成：

```
question + retrieved_docs
  ↓ classify intent (fast LLM, 1 次 ~80 tokens)
  ├── factual_lookup     → 现有 ragPipeline (短而严的 prompt，不含语言层例外)
  ├── language_op        → 专用 handler：translate / paraphrase / summarize
  │                        参数化（source=retrieved_text, action=enum）
  │                        输出确定性高，不依赖 prompt 例外
  ├── multi_doc_compare  → 多文档结构化对比 handler
  ├── kb_meta            → 路由到 asset_catalog（"知识库里有什么道德经资料？"）
  └── out_of_scope       → 直接兜底，不调 LLM
```

每个 handler 的 prompt **短而专一**，不再用一个 prompt 扛所有场景。

**与现有架构的契合**：

- `agent/` 已有 `KnowledgeQaAgent / DataAdminAgent / StructuredQueryAgent /
  MetadataOpsAgent` 顶层意图分类——D-002 是在 `KnowledgeQaAgent` 子层级延伸
  同一思路
- 复用 `agent/classify.ts` 模式：fast LLM + tool calling 结构化输出
- handler 之间共享 `retrieveInitial` / `condenseQuestion` 等已有模块

### D-003 eval 集前置（D-002 实施前必备）

D-002 之前先在 `eval/` 下补一组**多类型文档**回归集：

- 古典文献（已有道德经样本）
- 工业 SOP（已有汽车制造样本）
- 法律合同 / 医疗记录 / 财报 / 英文 paper / 代码注释 / 表格数据

每条 case 标注预期意图 + 预期答案模式（不要标精确字符串，标关键约束如"含数值
verbatim"/"逐句翻译"/"承认找不到"）。这样 D-002 任何 handler 改动都能跑回归。

## Why this is the right call

1. **D-001 立刻消除现存偏置**——本 PR 已经验证 condense (A) 通用机制可用，
   prompt 端不再绑定特定文档类型
2. **D-002 把"翻译/解释"这类元指令从 prompt 软约束升级为 handler 硬路由**
   —— 确定性强一个数量级
3. **D-003 把 prompt 调优从"为道德经赌一把"换成"有 eval 兜底的迭代"** ——
   每次改动都能量化评估

## 已知限制 / 后续路径

- **当前 D-001 + 规则 1 例外条款** 已经能 cover 用户实测的两类痛点（"把原文
  发我"靠 A condense / "给他的原文的解释"靠规则 1 例外）。但 prompt 端的
  "语言层操作"约束仍是软约束（LLM 概率执行），D-002 是真正的硬路由。
- **D-002 实施量**：1-2 周（intent classifier + 3-4 个 handler + eval + 灰度
  flag）
- **更激进的方向**（D-004 候选）：generation prompt 完全数据化（`config/prompts/
  *.yaml`），支持热加载 + per-tenant override + A/B 评测——D-002 落地后再评估
  必要性
- **C 候选**（adaptiveTopK 短查询 K 5→8）已合并入本 PR · 见 commit message

## Touched files (D-001)

- `apps/qa-service/src/services/ragPipeline.ts`（删示例 1-4 + 撤规则 1 例外
  + 删作答步骤段）

## Status

- D-001 · 本 PR 实施
- D-002 · 待规划（OpenSpec change 候选）
- D-003 · D-002 启动前必做
