# Explore · D-002.3 RAG 答案意图分类 · 单 tool + enum → 5 个独立 tool

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore（B-1）
> 上游依赖：
> - D-002 档 B 意图分类（已落地，本特性改造其内部实现）
> - D-002.2 kb_meta 路由（已落地，复用其架构与 env 守卫风格）
> - D-003 评测集（已落地，本特性的回归基线）

---

## 问题陈述

**Baseline 7（D-002.2 落地后）**：

```
intent               │ 13/14  92.9%
must_pass            │  4/ 5  80%   ← V3E 拉低
expected_intent=out_of_scope │ 0/ 1  0%   ← V3E 单条
```

剩下来的 1 条 intent 误分：

| Case | 期望 | 实际 | 失败模式 |
|---|---|---|---|
| `D003-V3E` "为什么 GM 要写这份文档" | `out_of_scope` | `factual_lookup`（间歇性，3 次跑 1 次错） | LLM classifier 在 oos vs factual 边界震荡 |

**根因猜测**：当前 `classifyAnswerIntent` 用 1 个 tool + intent enum 字段（`classify_answer_intent({intent: "factual_lookup"|...|"out_of_scope", reason})`）。OAI 兼容服务（含硅基 Qwen2.5-7B-Instruct）的 function calling 优化重点在 **"调哪个 tool"**——tool selection；对 enum 字段值的稳定性投入相对弱。多次实测：同一 prompt + 同一 question + temperature=0.1，单 tool + enum 仍会偶发抖动；改成 5 个独立 tool 后，每个 tool 的 description 都能写得更具体（"call this when X"），LLM 在 tool selection 阶段的 P(correct) 通常更高。

**附带预期**：

- V3A/V3D 是 **keyword miss**，不是 intent miss——不在本特性直接修复范围。但若 intent classifier 全 5/5 稳，下游 prompt 路由更准，间接可能让 generateAnswer 在 V3A 上更稳定（"3 个治理子模块" → "数据权限/数据生命周期/..." 命中可能性提升）。**不承诺**直接修复 V3A/V3D。

---

## 方案概要

### 改造前（baseline 7 的 single-tool 实现）

```ts
const CLASSIFY_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'classify_answer_intent',
    description: 'Classify the user question into one of 5 answer intents...',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: [...ANSWER_INTENTS] },  // ← 模型挑值
        reason: { type: 'string' },
      },
      required: ['intent', 'reason'],
    },
  },
}

await chatComplete(messages, {
  tools: [CLASSIFY_TOOL],
  toolChoice: { type: 'function', function: { name: 'classify_answer_intent' } },  // 强制调这一个 tool
})
// 解析：parsed.intent
```

### 改造后（multi-tool）

```ts
// 5 个独立 tool，每个对应一个 intent
const INTENT_TOOLS: OAITool[] = [
  {
    type: 'function',
    function: {
      name: 'select_factual_lookup',
      description: '问"X 是什么/在哪/谁/多少"——在召回文档里找具体事实（数值/规格/定义/位置/时间/人物）。例：「缓冲块设计间隙是多少」「道德经的作者是谁」',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', description: '≤30 字' } },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_language_op',
      description: '指令型，要求**对召回文档原文做语言层转换**（翻译/释义/总结/改写/列表化/白话/提炼）。例：「把上面这段翻译成英文」「给道德经第一章做白话解释」「总结一下这份合同」',
      parameters: { /* 同 reason */ },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_multi_doc_compare',
      description: '对比/罗列**多个**对象、概念、文档之间的差异或分别情况。含「和/与/区别/分别/对比」等比较型信号。例：「CORS 和 CSRF 的区别」「分别说明 A B C」「列出所有 ≥5mm 的件」',
      parameters: { /* 同 */ },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_kb_meta',
      description: '问知识库**目录**——库里有什么资料 / 找某类文档（不是问内容）。例：「我这库里有道德经吗」「列出所有 PDF」「找一下汽车制造的文档」。注意 "X 的核心模块有哪些" 不是 kb_meta（问的是 X 这个具体对象的属性）',
      parameters: { /* 同 */ },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_out_of_scope',
      description: '问文档**外**的背景/原因/朝代/作者意图/历史源流——文档里找不到的信息。例：「为什么 GM 要写这份文档」「老子是哪个朝代的人」「道德经诞生的历史背景」。判定窍门：问"为什么 X 这么 Y"=out_of_scope；问"X 的 Y 是什么"=factual_lookup',
      parameters: { /* 同 */ },
    },
  },
]

await chatComplete(messages, {
  tools: INTENT_TOOLS,
  toolChoice: 'required',  // ← 强制调任一 tool，模型自己挑
})

// 解析：toolCalls[0].function.name → 反查 intent
const TOOL_NAME_TO_INTENT: Record<string, AnswerIntent> = {
  select_factual_lookup: 'factual_lookup',
  select_language_op: 'language_op',
  select_multi_doc_compare: 'multi_doc_compare',
  select_kb_meta: 'kb_meta',
  select_out_of_scope: 'out_of_scope',
}
```

### Prompt 缩短

multi-tool 之后，**判定准则下沉到 tool description 里**——`buildClassifyPrompt` 中长达 60 行的 inline 判定规则可以瘦身：保留必要的 question + 召回 preview，把"边界例子"留给 tool description 自己 encoded。

预估 prompt token：从 ~900 → ~400（不含 tool schema）。tool schema 多了 4 个 ~120 token，净省 ~100 token。

---

## 决策记录

### D-1 · `toolChoice: 'required'` 而不是 `'auto'`

**替代方案**：(a) `toolChoice: 'auto'`（模型可以选择不调任何 tool，直接回 plain text）。(b) 保留 single-tool 的 `function: { name }` 强制调一个固定 tool。

**选 D-1**：`required` 强制调任一 tool 但让模型挑哪个，恰好契合本特性目的；`auto` 允许零 tool call，多一种 fallback 失败模式；single-tool 是改造前的旧路径，不在改造目标里。硅基流动 Qwen2.5-Instruct 系列实测支持 `tool_choice: "required"`（与 OpenAI 对齐）。

### D-2 · 5 个 tool 都同名 reason 参数（不暴露 intent 字段）

**替代方案**：每个 tool 加 intent-specific 字段（如 `select_kb_meta` 多一个 `meta_query_type`）。

**选 D-2**：本特性目标是**让 LLM 在 tool name 这一层决断**，而不是在字段值上。任何额外字段（哪怕只是描述性）都会让模型注意力分散到字段填写上、降低 tool selection 稳定性。reason 字段保留供 trace 调试 + assertReason 单测断言。

### D-3 · 命名 `select_*` 而不是 `intent_*` / 或 5 个意图直名

**替代方案**：(a) `intent_factual_lookup` / `intent_language_op` / ... (b) `factual_lookup` / `language_op` / ...（直接复用 enum 名）。

**选 D-3**：动词前缀 `select_*` 在 OAI function calling 里更明显是个"动作"（选择某分类），LLM 对动词起手的 tool name 在 selection 阶段更稳定（多家 vendor 经验法则）。直接用 enum 名易跟代码侧 type 字面量混淆——日志/trace 看不出"这是 LLM 选的"还是"代码里枚举的"。

### D-4 · 错配 / 多调 tool 的兜底链

```
toolCalls.length === 0  → fallback factual_lookup
toolCalls[0].function.name 不在 5 个里 → fallback factual_lookup
toolCalls.length > 1（多 tool 调用）→ 取 toolCalls[0]，丢弃后续
toolCalls[0].function.arguments 解析失败 → 仍接受 tool name 决断的 intent，reason='parse failed'
```

**理由**：fallback 到 `factual_lookup` 跟旧路径一致——它是最安全的默认（强 RAG，宁可让 generateAnswer 自己说"知识库没相关内容"，也不要错判到 language_op 强行翻译奇怪文本）。

### D-5 · env 守卫 `INTENT_MULTI_TOOL_ENABLED`（默认 true）+ 保留 single-tool 旧实现

**替代方案**：直接覆盖旧实现。

**选 D-5**：D-002.2 的 `KB_META_HANDLER_ENABLED` 给了清晰的回滚路径——本特性沿用该模式。`INTENT_MULTI_TOOL_ENABLED=false` → 走旧的 `CLASSIFY_TOOL` 单 tool + enum 路径。生产环境一旦发现 fast LLM 在 multi-tool 上更糟（虽然预期相反），可以单 env 回滚。

### D-6 · 不动 `isObviousLanguageOp` 规则前置

`isObviousLanguageOp` 在 LLM 之前已经把 V3B 类（"把上面这段翻译成中文"）100% 截走，不进入 LLM。本特性只改 LLM 路径——规则前置原样保留。

### D-7 · 不动 `B_HANDLER_ROUTING_ENABLED` 顶层 env

顶层"是否走档 B 路由"开关与"档 B 内部用 single-tool 还是 multi-tool"是两个正交开关。`B_HANDLER_ROUTING_ENABLED=false` 时不调 LLM，整个 multi-tool 改造无关。

---

## 与 D-002.x / D-003 系列协同

- **D-002.1**（answerPrompts 5 类模板）：本特性不改 prompt 模板，只改 intent 决策；模板按返回的 intent 选模板，行为完全兼容。
- **D-002.2**（kb_meta 路由）：`runKbMetaHandler` 在 intent='kb_meta' 时被调用——本特性提升 kb_meta 分类正确率，间接帮助 D-002.2 的 fallback 入口更准。
- **D-003 eval**：本特性的回归基线 = D003-V3E 必过（intent must_pass）。**期望** intent 92.9% → 100%（14/14），must_pass 4/5 → 5/5 稳。
- **N-006/N-007 notebook**：notebook 内 chat 走同一 ragPipeline，自动受益。

---

## 风险与回滚

| 风险 | 评估 | 缓解 |
|---|---|---|
| Fast LLM (Qwen2.5-7B) 在 5 tool selection 上反而更差 | 中。7B 模型 tool calling 本就比 72B 弱；5 tool > 1 tool 选择空间扩大 | env 守卫一键回滚；vitest 5×5 mock case 覆盖；eval 跑 3 次取众数（变成 manual gate） |
| Tool description 太长撑爆 prompt | 低。每 tool description 控在 ≤120 字，5 tool 总 ~600 字 token | tool description 优化迭代时增量调整 |
| LLM 调用的 tool name 不在 5 个里（hallucination） | 低。OAI 兼容协议 schema 强约束 | D-4 兜底 fallback factual_lookup |
| 多 tool 调用响应被 truncate（maxTokens 太低） | 低。当前 maxTokens=80 单 tool 已够用，multi-tool 一次只调一个 tool 不变 | 保留 maxTokens=80；如发现截断 → 提到 120 |
| 旧测试 mock 形状改变需要大面积重写 | 中。旧测 mock 单 tool；新测要 mock 5 tool 的不同 name 返回 | test 改造与代码 PR 同步；保留旧测的 5 case 改造为 mock 不同 tool name |

**回滚路径**：

```bash
# 即时回滚（生产环境）
export INTENT_MULTI_TOOL_ENABLED=false  # 走旧 single-tool 路径

# 完整 revert（代码层）
git revert <merge-commit>  # 旧实现仍在 git history
```

---

## 不在范围

- 把 `classifyAnswerIntent` 的 fast model 升级到 72B（成本 / 延迟另议）
- 加 confidence interval / 多次调用取众数（属于 must_pass 评测器侧改造，见 D-003 后续）
- 改造其它 classifier（如 condenseQuestion / 顶层 AgentIntent）—— 各自独立风险面
- 修复 V3A / V3D 的 keyword miss（属于 generateAnswer 侧）

---

## 验收标准

1. vitest `apps/qa-service/src/__tests__/answerIntent.test.ts` 全过（含改造后的新测）
2. `pnpm -F qa-service test` 零回归
3. D-003 eval 重跑：
   - intent 维度 ≥ 14/14（100%）—— 必须
   - must_pass ≥ 5/5（100%）—— 必须
   - 同 V3E 跑 3 次：≥ 2 次 oos —— 至少抗一次抖动
4. env `INTENT_MULTI_TOOL_ENABLED=false` 下，旧 single-tool 路径行为完全不变（旧测全过）

---

## 工作量估算

| 阶段 | 时间 |
|---|---|
| Lock OpenSpec | 10 分钟（4 文件，proposal/design/specs/tasks） |
| Execute 改 answerIntent.ts | 15 分钟 |
| Execute 改测试 | 15 分钟 |
| Verify vitest + eval | 10 分钟 + eval 跑 3 次 ~3 分钟 |
| Archive | 2 分钟 |
| **合计** | **~55 分钟**（与 session 卡片估的 30 分钟略超，因加了 env 守卫与回滚路径） |
