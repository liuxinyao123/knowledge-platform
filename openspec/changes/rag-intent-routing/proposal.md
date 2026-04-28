# Proposal: RAG Answer Generation 走意图分类 + Handler 分流

## Problem

当前 `apps/qa-service/src/services/ragPipeline.ts` 的 `generateAnswer` 用一份
**monolithic system prompt** 扛所有场景：事实查询、对召回原文做翻译/释义/总结、
多对象对比、知识库元查询、文档外问题——5 类需求语义截然不同，但被同一份 prompt
约束。

实地测试发现 user-facing 痛点：

1. **"给他的原文的解释"被拒答**——LLM 把"对召回原文做翻译"误判为"需要外部知识"，
   按 prompt 规则 1 拒答 "知识库中没有具体解释内容"。
2. **想 patch prompt → 走入死循环**：
   - 加"语言层例外"+ 道德经古文示例 4 → 实测有效，但绑定古典中文文献语境
   - 删示例 4，保留例外条款 → 例外条款抽象通用，但仍是软约束；且整段 prompt
     越改越大，对其它场景（合同 / 财报 / 英文 paper）全是偏置锚点

User 明确反馈："任意上传的文档都要兼容"。结论：**纯 prompt 调优是末梢治理**，
真"通用"靠架构分层（详见 ADR 2026-04-28-46）。

同时 ragPipeline 现有示例 1-3（mm 公差 / 0.3+0.7 偏移 / COF 缩写）也是工业制造
场景的具象案例，对其它领域文档同样是偏置——一并清理。

## Scope（本 Change）

1. **新增意图分类层**（`services/answerIntent.ts`）：
   - 5 类 `AnswerIntent` 枚举：`factual_lookup` / `language_op` /
     `multi_doc_compare` / `kb_meta` / `out_of_scope`
   - `classifyAnswerIntent(question, docs)` 函数：fast LLM + tool calling，
     1.5s 硬超时，任何失败回落 `factual_lookup`
   - env `B_HANDLER_ROUTING_ENABLED`（默认 on，false / 0 / off / no 关闭）

2. **新增 5 个 prompt 模板**（`services/answerPrompts.ts`）：
   - 每个模板短而专一（< 800 字符 vs 旧 monolithic ~3500 字符）
   - 0 个具体示例（不绑定任何文档形态）
   - 共享输出格式段（verbatim 数字 + 引用 [N] + 不写"以上信息来源于"）
   - inline image 规则按需拼接（ADR-45）

3. **改造 `ragPipeline.generateAnswer`**：
   - 在选 prompt 之前调 `classifyAnswerIntent`
   - 按返回的 intent 用 `buildSystemPromptByIntent` 选模板
   - emit `rag_step` 事件（icon `🎭`）让前端 / SSE 消费者可见
   - **web 模式（hasWeb）保留原有 prompt 结构**，不接入意图分类
     （联网检索特有的"两类来源优先级"语义跟意图正交）

4. **顺手清理 ragPipeline 现有 hardcoded 示例**：
   - 删除示例 1-3（mm / 0.3+0.7 / COF）—— 工业制造偏置
   - 撤回上一版加的示例 4（道德经白话释义）+ 规则 1 例外条款 ——
     例外条款的语义被 `language_op` prompt 模板内化（更精准、更专一）
   - 删除"作答步骤"段（基本是规则的复述）

5. **ADR-46 同步更新**：D-001 段落明确"删除全部示例 + 不再保留语言层例外"
   （因为 D-002 已经把例外语义路由到专用 handler）

6. **顶层 agent classifier 边界修正**（V-3 实测发现追加 · 2026-04-28）：
   `apps/qa-service/src/agent/intentClassifier.ts` 的 SYSTEM_PROMPT 把 "把上面
   这段翻译成中文" / "总结一下" 等元指令误判到 metadata_ops（"对资产做处理"被
   误解为元数据 CRUD），导致根本没进 KnowledgeQaAgent → 没机会触发档 B 意图分流。
   修法：明确 knowledge_qa **包含**"翻译/解释/总结/释义/改写/提炼"等语言层
   操作指令；metadata_ops **仅限**对元数据本身做 CRUD（删除资产/修改 ACL/重命名
   等）。加边界例子。
   严格说这一改动超出原 scope（"agent 顶层 4 类分类不动"），但属于 V-3 实测
   发现的核心阻塞 bug，纳入本 PR 处理避免拖到下一轮。

## Out of Scope（后续 Change）

- **D-002.1** language_op 进一步走 function tool（确定性 translate/summarize handler，
  不依赖 prompt 概率执行）
- **D-002.2** kb_meta 真正路由到 asset_catalog API（本 change 仍走 LLM generation）
- **D-003** 多文档类型 eval 集（古文 / 工业 SOP / 合同 / 英文 paper / 财报）
- **D-004** prompt 数据化（`config/prompts/*.yaml` 热加载 + per-tenant override）
- **D-002.3** retrieval 分层决策（按 rerank top-1 score 分支）
- **C-D** full agentic loop

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | 5 类意图（factual_lookup / language_op / multi_doc_compare / kb_meta / out_of_scope） | 3 类 / 7 类 / N 类 | 5 类 ≥ 90% 覆盖率，且 fast LLM 在 5 类闭集上分类准确率 > 95%（参考 agent 顶层 4 类实测） |
| D-002 | 任何分类失败回落 `factual_lookup` | 回落 monolithic / 抛错 | factual_lookup 是最严格的 prompt（=老 monolithic 严格 RAG 行为），最安全默认 |
| D-003 | env `B_HANDLER_ROUTING_ENABLED` 默认 on | 默认 off + 灰度 | 已经实测有效（实测见 plan）；off 等价于 fallback factual_lookup，回滚成本零 |
| D-004 | web 模式（hasWeb）不接入意图分类 | 也接入 | 联网检索特有的"两类来源优先级"语义跟意图分类正交，强行套反而损失 web prompt 的来源 disambiguation 能力 |
| D-005 | 清理示例 1-3（mm / COF / 0.3+0.7） | 保留 | 工业制造场景偏置；本 change 引入 5 个专用 prompt 模板已经覆盖 verbatim 数值约束 |
| D-006 | 不再保留规则 1"语言层例外"条款 | 保留作为 factual_lookup 的兜底 | 例外语义被 language_op 模板内化（更精准、更专一）；保留反而稀释 factual_lookup 的"严格 verbatim"语义 |

## 接口契约（freeze 项）

详见 `specs/answer-intent-spec.md` / `specs/answer-prompts-spec.md` /
`specs/handler-routing-spec.md`。

下游消费者（合并后才能开始消费）：
- 未来 `apps/web` 在 SSE 消费层显示意图标签：消费 `rag_step` 事件 icon=`🎭` 的 label
- 未来 `KnowledgeQaAgent` 子 handler（D-002.1）：复用 `AnswerIntent` 枚举 + classifier
- 未来 prompt 数据化（D-004）：替换 `buildSystemPromptByIntent` 内部实现，对外接口不变
