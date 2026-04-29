# Explore · Notebook Artifact 接入档 B 意图分流（N-005）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore
> 上游依赖：N-002 notebook-artifact-types-expansion（已 B-3 · ArtifactSpec.intent
> 字段已预留）+ rag-intent-routing（已 freeze · buildSystemPromptByIntent + 5 类模板 + footnote）

## 背景

N-002 引入 `ArtifactSpec.intent?: AnswerIntent` 字段但**不消费**（默认全 undefined，
artifact 仍用 `spec.promptTemplate` 自带的 system prompt）。N-005 让 artifact
真的走档 B：享受档 B 5 类模板的"任意文档兼容 + 严格通用规则"约束。

但 artifact 跟 chat 答案有本质差异：
- **chat 答案**：流式、短、对话型、用户体验导向（"白话翻译" / "事实查询" 等场景）
- **artifact**：非流式、长（800-3500 字）、文档型、有**强格式约束**（4 段式简报 /
  markdown 表格 / 8-15 张幻灯片 等）

直接用档 B 5 类 prompt 替换 spec.promptTemplate **会丢失格式约束**——
buildSystemPromptByIntent('language_op', ctx, '', 'footnote') 给的是"对召回原文做
翻译/释义/总结"的指令，没有"4 段式简报" / "markdown 表格" 等具体格式。

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 整体替换**：spec.promptTemplate → buildSystemPromptByIntent(intent) | 最简单 | **致命缺陷**：丢失 artifact 格式约束（briefing 不会按 4 段式输出，slides 不会分页等）|
| **C-B 拆 prompt 为"通用规则段" + "格式要求段"**（选中）：system prompt = 档 B 5 类模板（提供边界 + footnote + 通用规则）；user message = `请按以下格式生成{label}：\n${spec.promptTemplate}` | 最优雅：通用规则统一管理 + 格式约束保留 | 需要把 artifact 格式描述从 system 移到 user message |
| **C-C 双 prompt 拼接**：system = `${档 B 模板}\n\n${spec.promptTemplate}` | 简单但 prompt 巨大、可能矛盾 | 风险：档 B 的"严格不引入外部知识" + artifact 的"基于召回生成 markdown 表格" LLM 容易混乱 |

**结论**：走 C-B。把 artifact 格式描述移到 user message 后：
- system prompt 单一职责：通用规则 + 边界 + footnote 引用样式
- user message 单一职责：本次 artifact 的具体格式约束
- 跟 ChatGPT API 设计哲学一致（system = 角色 / user = 任务）

## 8 个 artifact → 5 个 intent 映射

| artifact kind | intent | 理由 |
|---|---|---|
| `briefing` | `language_op` | 对召回原文做"提炼总结"，是语言层操作 |
| `faq` | `language_op` | 基于原文重组成 Q&A，是改写 |
| `mindmap` | `language_op` | 层级化重组，是 list 类语言操作 |
| `outline` | `language_op` | 提取标题层次 + 简介，是总结 |
| `timeline` | `language_op` | 时间序列重组，是按维度提炼 |
| `comparison_matrix` | **`multi_doc_compare`** | 字面对应：多对象/维度对比 |
| `glossary` | `factual_lookup` | 术语 + 定义，要 verbatim 提取定义而不是改写 |
| `slides` | `language_op` | 演示稿是总结 + 重组 |

## 实现方式

### `executeArtifact` 改造

```ts
const spec = getArtifactSpec(kind)

let systemPrompt: string
let userMessage: string

if (spec.intent) {
  // N-005：走档 B 5 类模板（通用规则 + footnote）
  const inlineImageRule = ''  // artifact 不接 inline image（V1）
  systemPrompt = buildSystemPromptByIntent(spec.intent, ctx, inlineImageRule, 'footnote')
  // 把 artifact 格式描述塞 user message
  userMessage = `请基于上面的文档生成「${spec.label}」，按以下格式：

${spec.promptTemplate.replace('{标题}', notebookName)}`
} else {
  // 兜底（N-002 行为）：用 spec.promptTemplate 当 system prompt
  systemPrompt = `${spec.promptTemplate.replace('{标题}', notebookName)}\n\n# 文档：\n${ctx}`
  userMessage = `请生成${spec.label}。`
}

const result = await chatComplete(
  [{ role: 'user', content: userMessage }],
  { system: systemPrompt, maxTokens: spec.maxTokens, ... },
)
```

注意：**spec.intent 存在 → context 在 system prompt 里**（buildSystemPromptByIntent
内部已拼 context）；**不存在 → context 跟 N-002 老方式一样在 system prompt 里**。
两条路径都把 context 放 system，避免 user message 过长被 LLM 截断。

### ArtifactSpec.intent 填值

直接在 ARTIFACT_REGISTRY 内联：

```ts
export const ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec> = {
  briefing:          { ..., intent: 'language_op', ... },
  faq:               { ..., intent: 'language_op', ... },
  mindmap:           { ..., intent: 'language_op', ... },
  outline:           { ..., intent: 'language_op', ... },
  timeline:          { ..., intent: 'language_op', ... },
  comparison_matrix: { ..., intent: 'multi_doc_compare', ... },
  glossary:          { ..., intent: 'factual_lookup', ... },
  slides:            { ..., intent: 'language_op', ... },
}
```

### env 开关

`B_ARTIFACT_INTENT_ROUTING_ENABLED`（默认 on）：
- on → 按 spec.intent 走档 B
- off → 强制 spec.intent 视为 undefined → 走 N-002 老路径（promptTemplate）

回滚成本零。

## 风险

| 风险 | 缓解 |
|---|---|
| **档 B 模板是聊天对话风格，artifact 是文档风格** → user message "请按格式生成" 可能不够强 | user message 加显式提示 "请严格按以下格式输出 markdown 文档"；V-2 实测确认 LLM 真按格式生成 |
| **spec.promptTemplate 跟档 B 5 类模板规则冲突**（如 timeline "如果文档没有时间数据..." vs language_op "必须执行不能拒答"）| 这是合理冲突——artifact 自己的诚实约束（无时间数据时停止）应优先；user message 段的指令权重 LLM 一般给得高于 system 通用规则 |
| **glossary 走 factual_lookup 太严** → LLM 可能拒答"文档没有完整术语表" | factual_lookup prompt 已含"找不到说没有"是诚实表现；glossary spec.promptTemplate 已写"文档只用了缩写但没解释的词，定义写'文档未给出明确定义'+[^N]"——已对齐 |
| **comparison_matrix 走 multi_doc_compare 但 single source notebook**（只 1 个文档）| spec.promptTemplate 已写"如果只能找到 1 个对象，输出'文档只涉及单一对象，无法生成对比矩阵'"；档 B multi_doc_compare 模板 + 这个降级提示组合应能 work |
| **N-002 的"timeline 无时间数据时停止"等诚实兜底丢失** | 这些都在 spec.promptTemplate（user message）里保留，不丢 |
| **整套 N-005 不如 N-002** | env `B_ARTIFACT_INTENT_ROUTING_ENABLED=false` 回滚到 N-002 行为 |

## V-3 实测设计（B-4 前置）

| Case | 当前 N-002 行为 | N-005 期望 |
|---|---|---|
| 古文 notebook 触发 mindmap | 走 PROMPT_MINDMAP，可能引入外部哲学背景 | 走 language_op，严格基于原文做层级化 + 透明度声明 |
| 工业 SOP notebook 触发 comparison_matrix | 走 PROMPT_COMPARISON_MATRIX | 走 multi_doc_compare，强制分项 + 同维度对齐 |
| 中文产品 notebook 触发 glossary | 走 PROMPT_GLOSSARY | 走 factual_lookup，verbatim 定义不发挥 |
| 触发 briefing | 走 PROMPT_BRIEFING | 走 language_op + 4 段式格式（user message）|
| env off → 全部回到 N-002 | — | 跟 N-002 完全一致 |

## Out of Scope

- 自定义 artifact intent 映射 / 用户配置 → N-006 templates 候选
- artifact 流式生成 → 后续
- artifact 跟 condense / adaptiveTopK 联动（artifact 不走 ragPipeline，跟这两个无关）

## 后续路径

1. **N-005 落地** = artifact 享受档 B 通用规则 + footnote
2. **N-003** sources 变更 → artifact stale → 触发重生成（依赖本 change 的注册表）
3. **N-006** Notebook templates → 模板预设 artifact 套件 + 推荐 intent
