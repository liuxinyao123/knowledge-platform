# Explore · RAG Intent Routing（档 B 第 1 步设计草稿）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore（不进主分支，仅作 Lock 阶段输入）
> 倒推说明：本文档由 2026-04-28 实地调优后回补，用于支撑同日 OpenSpec lock。

## 背景

实地测试中两类 user-facing 现象暴露 monolithic system prompt 的根本缺陷（见 ADR
2026-04-28-46）：

| 现象 | 旧 prompt 行为 | 真根因 |
|---|---|---|
| "那你把原文发我"（接道德经 history） | rerank top-1 = 0.027 → short-circuit 兜底 | retrieval 没用 history |
| "给他的原文的解释"（接第一章原文 history） | LLM 拒答 "知识库中没有具体解释内容" | LLM 把"对召回原文做翻译"误判为"需要外部知识" |

第一类已经用 A condense（结构化机制）解决。

第二类的两次直觉修复路径都被否决：
- **方案 1**：prompt 加"语言层例外"+ 道德经古文示例 4 → 实测有效但绑定古典中文文献语境
- **方案 2**：删示例 4，保留例外条款 → 例外条款本身是抽象边界（不绑定文档形态）但仍是
  软约束，且整段 prompt monolithic 越改越大

User 明确反馈："任意上传的文档都要兼容"。这意味着——

## 核心洞察

**纯 prompt 调优不是真解**。具体三层论证：

1. **prompt 是概率约束不是规则约束**。同一条 prompt 同一题不同次回答可能不一致；强模型
   zero-shot 也能 follow 抽象规则，弱模型给再多示例也飘。
2. **跨文档形态时 prompt 永远写不完**。每加一个领域（古文 / 合同 / 医疗 / 英文 paper /
   财报 / 表格 / 多模态），就要加一类示例 / 一条规则；累积到一定程度互相冲突。
3. **prompt 掩盖真问题**。本来应该走"路由 + 专用 handler"的请求被一份 monolithic
   prompt 一把梭，导致下游分析不出哪类 case 在退化。

## 设计候选 (4 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A**：prompt 数据化 | `config/prompts/*.yaml` 热加载 + per-tenant override + A/B | 复杂度高、收益不直接、本质仍是 prompt 调优 |
| **C-B**：意图分类 + 专用 handler / prompt 模板 | fast LLM 把 question×docs 分到 N 类意图，每类用短而专一的 prompt 模板 | **选中**：复用现有 agent 分类思路（KnowledgeQaAgent / DataAdminAgent 已经在做顶层路由），子层级延伸；改动 contained 在 ragPipeline.generateAnswer 内部 |
| **C-C**：Retrieval 分层决策 | 按 rerank top-1 score 分支：高 → 直接 generate；中 → multi-query rewrite；低 → web search / 兜底 | 跟 C-B 正交；下一阶段做（不在本 change） |
| **C-D**：full agentic loop | LLM 自己决定查什么、怎么回答（ReAct 风格） | 改动量过大、流式难做、可解释性差 |

**结论**：本 change 走 C-B；C-A 列入 D-004 候选；C-C 独立 change。

## 5 类意图设计

为什么是 5 类（而不是 3、7、10）：

- **覆盖率**：5 类能覆盖 ≥ 90% 实际 RAG 用户场景（事实 / 翻译释义总结 / 对比 /
  目录元查询 / 文档外问题）
- **可分性**：fast LLM 在 5 类闭集上分类准确率 > 95%（参考 agent 顶层 4 类的实测）
- **prompt 收益**：每类 prompt 可压到 < 800 字符（vs monolithic ~3500 字符），LLM
  注意力更集中

| Intent | 触发场景 | prompt 关键约束 |
|---|---|---|
| `factual_lookup` | 用户在文档里找事实（数值/规格/定义/位置/时间/人物） | 严格 verbatim，找不到就说没有 |
| `language_op` | 对召回原文做翻译/释义/总结/改写/列表化 | **必须执行**，不能拒答；末尾透明度声明 |
| `multi_doc_compare` | 对比/罗列多个对象（信号词："和/与/区别/分别/对比"） | 强制分项 + 同维度对齐 + 不漏组件 |
| `kb_meta` | 询问"库里有什么 X 资料"（问目录不是问内容） | 只列 asset_name，不进文档内容 |
| `out_of_scope` | 文档外的背景/历史/原因/评价/作者意图 | 直接说找不到 + 列沾边资产标题供参考 |

**边界判定难点**：

- `factual_lookup` vs `out_of_scope`：取决于文档**实际**是否包含该事实——
  让 fast LLM 看召回 docs preview 后判定（不要只看问题文本）
- `language_op` vs `factual_lookup`：用户问"道德经第一章原文" → factual_lookup
  （找内容）；问"给上面这段做白话解释" → language_op（对召回原文做转换）
- `kb_meta` vs `factual_lookup`：用户问"库里有道德经吗" → kb_meta（问目录）；
  问"道德经的作者" → factual_lookup（问内容）

## 风险

| 风险 | 缓解 |
|---|---|
| **意图分类失误** → 走错 prompt 模板 → 答案质量下降 | 任何分类失败 / 异常 → 回落 `factual_lookup`（最安全默认，等价老 monolithic 的严格 RAG 行为）；env `B_HANDLER_ROUTING_ENABLED=false` 全局关 |
| **+1 次 fast LLM 调用** → 延迟增加 | fast model（默认 Qwen2.5-7B），1.5s 硬超时；与 condense 的 LLM 调用并发性等价；典型延迟 ~200-400ms |
| **language_op "必须执行"过强** → 模型可能强行翻译无关原文 | prompt 加约束："文档里有原文素材就要做" 暗示无原文时仍然要诚实说找不到；末尾透明度声明 |
| **kb_meta / out_of_scope 类问题召回往往低分** → rerank short-circuit 把它们提前兜底了 | short-circuit 仍在 generation 之前；这两类意图天生召回弱，需要后续 D-002.1 检讨阈值；本 change 不动 short-circuit |
| **跨文档类型回归未量化** | D-003 prerequisite：先补多类型文档 eval 集再做 D-002 优化迭代；本 change 上线前至少手测 5 类文档（古文 / 工业 SOP / 合同 / 英文 paper / 财报 / 元查询） |
| **web 模式（hasWeb）路径** | 不接入意图分类（联网检索特有的"两类来源优先级"语义跟意图正交），保留原有 prompt 结构 |

## 与现有架构的契合

- **agent 顶层 4 类分类**（KnowledgeQaAgent / DataAdminAgent / StructuredQueryAgent /
  MetadataOpsAgent）已经在 `agent/classify.ts` 用 fast LLM + tool calling 做了；
  本 change 是**子层级延伸**——KnowledgeQaAgent 内部对"答案生成"再做一层 5 类分流
- 复用 `services/llm.ts` 的 `chatComplete` + `OAITool` 模式，零新依赖
- 不动 `condenseQuestion` / `retrieveInitial` / `gradeDocs` / `rewriteQuestion` /
  `recordCitations` 等其它环节
- 不动前端协议（emit `rag_step` 用 `🎭` icon 让前端可见，不是新事件类型）

## Out of Scope（明确不做）

- **专用 language_op handler**：本 change 把 language_op 接入也走 generateAnswer
  + LLM stream（只是换 prompt）；下一轮 D-002.1 才考虑用专用 translate / summarize
  函数调用，输出确定性更强
- **kb_meta 真正路由到 asset_catalog API**：本 change 仍走 LLM generation（用召回的
  asset_name 当数据源）；下一轮 D-002.2 接入 asset_catalog 真路由
- **C-A prompt 数据化** / **C-C retrieval 分层** / **C-D full agentic loop**：见上文
- **multi-tenant prompt override**：D-004 候选

## 后续路径

1. **本 change 锁契约 + 实施 + 实测**（B 工作流 4 步走完）
2. **D-003 eval 集补全**（多文档类型回归）
3. **D-002.1**：language_op 进一步走 function tool（translate/summarize 确定性 handler）
4. **D-002.2**：kb_meta 路由到 asset_catalog API
5. **D-004（可选）**：prompt as data，per-tenant override
