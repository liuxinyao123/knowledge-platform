# Design: RAG Answer Generation 意图分类 + Handler 分流

## 架构总览

```
┌─────── ragPipeline.runRagPipeline ─────────┐
│  Step 0  condenseQuestion (A condense)     │
│  Step 1  retrieveInitial + rerank          │
│  Step 2  gradeDocs (option)                │
│  Step 3  rewriteQuestion (cond < 3)        │
│          (short-circuit: top-1 < 0.05)     │
│  Step 4  generateAnswer ▼                  │
└────────────┬───────────────────────────────┘
             │
             ▼ 本 change 改造点
┌─────── generateAnswer ─────────────────────┐
│  if (hasWeb)  → web prompt (不变)          │
│  else:                                     │
│    intent = await classifyAnswerIntent(   │
│      question, docs                        │
│    )                                       │
│    emit rag_step icon=🎭                   │
│    sysPrompt = buildSystemPromptByIntent( │
│      intent, context, inlineImageRule     │
│    )                                       │
│    chatStream(messages, { system: ... })   │
└────────────────────────────────────────────┘
                    │
                    ▼
┌─────── 5 个 prompt 模板 ──────────────────┐
│  factual_lookup    严格 verbatim          │
│  language_op       必须执行翻译/释义/总结  │
│  multi_doc_compare 强制分项 + 同维度       │
│  kb_meta           只列 asset_name        │
│  out_of_scope      直接说找不到           │
└────────────────────────────────────────────┘
```

## 模块边界

| 文件 | 职责 | 公开符号 |
|---|---|---|
| `services/answerIntent.ts` | 意图分类 | `type AnswerIntent` / `ANSWER_INTENTS` / `isAnswerIntent` / `isHandlerRoutingEnabled` / `classifyAnswerIntent` / `IntentClassification` |
| `services/answerPrompts.ts` | prompt 模板 | `buildSystemPromptByIntent(intent, context, inlineImageRule)` |
| `services/ragPipeline.ts` | 接入点（`generateAnswer` 内部） | 不新增公开符号；`generateAnswer` 签名不变 |

`ragPipeline.ts` 对外签名（`generateAnswer / runRagPipeline / retrieveInitial /
gradeDocs / rewriteQuestion / retrieveExpanded / toCitation` 等）**全部不变**，
本 change 只在 `generateAnswer` 内部加路由层。

## classifier 调用约束

- **Model**：`getLlmFastModel()`（默认 `Qwen/Qwen2.5-7B-Instruct`）
- **Tool calling 强制**：`tool_choice = { type: 'function', function: { name: 'classify_answer_intent' } }`
- **Tool schema**：
  ```json
  {
    "intent": {"enum": ["factual_lookup", "language_op", "multi_doc_compare", "kb_meta", "out_of_scope"]},
    "reason": {"type": "string"}
  }
  ```
- **maxTokens**：80（够 tool args 用）
- **temperature**：0.1（分类任务低发散）
- **AbortController 1.5s 硬超时**
- **prompt 输入**：question + 召回前 3 段 chunk preview（每段 ≤ 200 字符）
  + 5 类意图定义 + 边界例子

## emit 事件

```ts
emit({
  type: 'rag_step',
  icon: '🎭',
  label: `答案意图分类 → ${intent}（${reason}）`,
})
```

- **不新增 SseEvent type**（沿用 `rag_step`），老前端 zero-impact
- **fallback 时不 emit**（避免污染日志，让用户看到时只代表"分类成功"）

## prompt 模板设计原则

| 原则 | 实现 |
|---|---|
| 0 个具体示例 | 不含古文 / mm / COF / 任何文档形态词；`answerPrompts.test.ts` 用禁词检查锁住 |
| 短而专一 | 每模板 < 800 字符（含 context 占位符前） |
| 共享尾部 | `COMMON_OUTPUT_FORMAT` 常量（verbatim 数字 + 不写"以上信息来源于"） |
| inline image 按需 | factual_lookup / language_op / multi_doc_compare 拼接；kb_meta / out_of_scope 不拼（这两类不需要图） |
| 模式名头部声明 | 每模板首句 "你是知识库助手 · **<模式名>**" 让 LLM 一眼锁定行为 |

## env 行为矩阵

| `B_HANDLER_ROUTING_ENABLED` | `LLM_API_KEY` | `hasWeb` | 实际行为 |
|---|---|---|---|
| `true`(默认) | 有 | false | classify → 按 intent 选 prompt |
| `true` | 无 | false | classifier 立即 fallback factual_lookup（=老严格 RAG） |
| `false` | 有/无 | false | classifier 立即 fallback factual_lookup |
| 任意 | 任意 | true | 走 web prompt（不接入意图分类） |
| 任意 | 任意 | classifier 抛 / timeout | fallback factual_lookup |

## 失败模式 + 回滚

| 故障 | 行为 | 回滚 |
|---|---|---|
| classifier LLM 5xx | catch + return `{intent: 'factual_lookup', fallback: true}` | 自动；用户无感 |
| classifier 返回非法 intent | 同上 | 自动 |
| classifier 超 1.5s | AbortController 触发 + catch | 自动 |
| prompt 模板有 bug 导致 LLM 行为漂移 | env `B_HANDLER_ROUTING_ENABLED=false` + 重启 | 全局回滚 |
| 整套 change 要 revert | revert 单 commit；`generateAnswer` 签名不变 → 调用方零适配 | 干净回滚 |

## 测试策略

- **单元测试**：
  - `answerIntent.test.ts`：env 开关 / LLM 未配置 / 空问题 / tool 无返回 / 非法 intent / 异常 / 5 类 intent 正确返回 / prompt 含 question + 前 3 段 preview
  - `answerPrompts.test.ts`：5 模板含 context、模式名、inline image 按需拼接、禁词检查（不含 hardcoded 文档形态）、关键约束（必须执行 / verbatim / 不漏组件 等）
- **不动**：`ragPipeline.shortCircuit.test.ts` / `ragPipeline.test.ts`（generateAnswer 签名不变 → mock chatComplete 自动覆盖 classifier 异常分支 → 走 fallback；老用例零回归）
- **smoke 验证**：tsx 直跑 26 断言（intent enum / env / 5 模板 / 禁词 / 关键约束）
- **E2E 实测**（D-003 之前 manual）：
  - case2a "给他的原文的解释"（道德经 history）→ 期望 intent=`language_op`，输出逐句白话
  - 至少手测 5 类文档（古文 / 工业 SOP / 合同 / 英文 paper / 财报）的"翻译/解释" 类问题
  - 至少手测 5 类文档的"事实查询"类问题（确认 factual_lookup 没回归）

## 与其它 ADR 的关系

- **ADR-46（本 change 的母 ADR）**：本 change 是 D-001 + D-002 的实施
- **ADR-45 inline image**：本 change `buildSystemPromptByIntent` 接受 `inlineImageRule`
  参数，按需拼到 factual_lookup / language_op / multi_doc_compare 模板尾部；行为不变
- **ADR-35 web search**：本 change 在 `hasWeb=true` 分支跳过意图分类，保留原有 web prompt
- **A condense（同 PR）**：condense 在 retrieval 之前改写问题；本 change 在 generation
  之前分类意图——两者各管一段，零交互
- **C adaptiveTopK（同 PR）**：micro tuning，跟本 change 完全独立
