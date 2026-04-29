# Proposal: Notebook Artifact 接入档 B 意图分流（N-005）

## Problem

N-002 引入 `ArtifactSpec.intent?: AnswerIntent` 字段但**不消费**（默认全 undefined）。
artifact 仍用各自的 `spec.promptTemplate` 当 system prompt——**不享受档 B 5 类
模板的"任意文档兼容"通用规则**（没有"对召回原文做语言层操作"的明确边界声明，
没有"verbatim/不引入外部知识"的统一约束）。

而 8 类 artifact 实际上都是基于召回文档的**语义重组**（briefing 总结 / mindmap
层级化 / glossary 提取定义 / comparison_matrix 对比），跟档 B 5 类意图有清晰映射：

| artifact | intent 映射 |
|---|---|
| briefing / faq / mindmap / outline / timeline / slides | language_op（语言层重组）|
| comparison_matrix | multi_doc_compare（多对象对比）|
| glossary | factual_lookup（术语 verbatim 提取）|

## Scope（本 Change）

1. **`services/artifactGenerator.ts` `ARTIFACT_REGISTRY`**：给 8 个 spec 填 `intent`
2. **`executeArtifact` 改造为双路径**：
   - `spec.intent` 存在 → 走档 B：system prompt = `buildSystemPromptByIntent(intent, ctx, '', 'footnote')`；user message = `请基于上面的文档生成「${spec.label}」，按以下格式：\n${spec.promptTemplate}`
   - `spec.intent` 缺省 → 走 N-002 老路径：`spec.promptTemplate` 作 system，`'请生成{label}。'` 作 user
3. **新增 env `B_ARTIFACT_INTENT_ROUTING_ENABLED`**（默认 on）；off 时强制 spec.intent 视为 undefined → 回退 N-002 行为
4. **不动 N-002 接口**：ArtifactSpec / ARTIFACT_REGISTRY 类型签名不变（只 intent 字段从 undefined 填值）
5. **不动**：`routes/notebooks.ts` / 前端 StudioPanel / 数据库 schema / SSE 事件
6. **单元测试**：8 个 spec 的 intent 字段非空 + executeArtifact 双路径行为（用 mock chatComplete 断言传给 LLM 的 system / user message 形态）

## Out of Scope（后续 Change）

- 自定义 artifact intent 映射（用户配置）→ N-006 templates
- artifact 流式生成
- artifact 接入 condense / adaptiveTopK（artifact 不走 ragPipeline，无关）

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | C-B 拆 prompt：system=档 B 通用规则；user=artifact 格式要求 | C-A 整体替换 / C-C 双 prompt 拼接 | 单一职责清晰；保留 artifact 强格式约束；跟 ChatGPT system/user 设计哲学对齐 |
| D-002 | 6/8 走 language_op；1/8 multi_doc_compare；1/8 factual_lookup | 全 language_op / 更细分映射 | 按 artifact 实际语义匹配；多了无收益少了不够准 |
| D-003 | env `B_ARTIFACT_INTENT_ROUTING_ENABLED` 默认 on | 默认 off + 灰度 | env off 等价 N-002，回滚成本零；档 B 已 V-* 验证过 |
| D-004 | spec.intent 字段从 N-002 预留升级为消费 | 不动等下一轮 | N-002 已铺接口，N-005 工作量极小（填值 + executeArtifact 加 if 分支）|
| D-005 | context 仍放 system prompt（不放 user message）| 放 user message | 避免 user message 过长被某些 LLM 截断；保持档 B 的 context 拼接策略 |
| D-006 | 当 intent 存在时，用户消息额外加 "按以下格式" 引导段 | 直接发 spec.label | 显式提示 LLM 注意格式，提高 follow rate |

## 接口契约（freeze 项）

详见 `specs/intent-mapping-spec.md` + `specs/executeArtifact-routing-spec.md`。

下游消费者：
- N-006 Notebook templates 引用 ARTIFACT_REGISTRY[kind].intent 决定模板套件的 prompt 风格
- 未来 D-002.1 language_op function tool 落地后，artifact 的 language_op 路径可顺势升级为 function call
