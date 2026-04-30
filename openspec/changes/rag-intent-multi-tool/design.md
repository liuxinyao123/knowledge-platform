# Design · D-002.3 RAG 答案意图分类 multi-tool function call

> 工作流 B-2（OpenSpec Lock）。Explore 草稿见 `docs/superpowers/specs/rag-intent-multi-tool/design.md`，本文件锁定接口契约 + 决策。

## 上游依赖

- `apps/qa-service/src/services/llm.ts` 的 `OAITool` 类型 + `chatComplete(messages, { tools, toolChoice })` 接口
- `apps/qa-service/src/services/answerIntent.ts` 的 `AnswerIntent` 类型 / `ANSWER_INTENTS` 常量 / `isHandlerRoutingEnabled` / `isObviousLanguageOp`（规则前置不动）
- D-002.1 `services/answerPrompts.ts` 5 类 prompt 模板（不动）
- D-003 `eval/multidoc-set.jsonl` 14 case 评测集（V3E 是本特性回归基线）

## 关键决策（按优先级）

### D-1 · `tool_choice: 'required'` 而不是 `'auto'` 或单 tool 强制

`required` 强制调任一 tool 但让 LLM 挑，恰好契合本特性目的。

- `'auto'` 允许 LLM 不调任何 tool 直接回 plain text → 多一种 fallback 失败模式
- single-tool 强制 → 改造前的旧路径（保留作回滚）

硅基流动 Qwen2.5-Instruct 系列实测支持 `tool_choice: "required"`（与 OpenAI 对齐）。Spec 文件给出 chatComplete 接口契约。

### D-2 · 5 个 tool 共享相同 `reason: string` 单字段

不给某个 tool 加 intent-specific 字段（如 `select_kb_meta` 多 `meta_query_type`）。

理由：本特性目标是让 LLM 在 tool name 这层决断。任何字段填写都会分散 selection 注意力。reason 字段保留供 trace 调试 + assertReason 单测断言。

### D-3 · tool 命名 `select_<intent>`（动词前缀）

候选：`intent_<x>` / 直接 enum 名 / `classify_as_<x>`。选 `select_*`：

- 动词前缀更明确表达"选择某分类"语义
- enum 名易跟代码侧 type 字面量混淆——日志/trace 看不出"这是 LLM 选的"还是"代码里枚举的"

### D-4 · 兜底链（按优先级）

```
toolCalls.length === 0
  → fallback: factual_lookup, reason='no tool call returned'

toolCalls[0].function.name 不在 5 个里（hallucination）
  → fallback: factual_lookup, reason='unknown tool: <name>'

toolCalls.length > 1
  → 取 toolCalls[0]，丢弃后续（不报错，记录在 reason）

toolCalls[0].function.arguments 解析失败 / 缺 reason
  → 仍接受 tool name 决断的 intent，reason='<tool_name> args parse failed'
  （区别于 single-tool 路径——那里 args 解析失败必须降级，因为 intent 在 args 里；
    multi-tool 路径 intent 在 name 里，args 只是 reason 调试字段）
```

`factual_lookup` 是最安全的默认（强 RAG，宁可让 generateAnswer 自己说"知识库没相关内容"）。

### D-5 · 路径选择 = 单 env 守卫

```
isIntentMultiToolEnabled() === true   → multi-tool 路径（默认）
isIntentMultiToolEnabled() === false  → 旧 single-tool 路径（回滚）
```

env 名沿用 D-002.2 风格：`INTENT_MULTI_TOOL_ENABLED`，未设默认 true，识别 `false / 0 / off / no`（大小写不敏感）。

### D-6 · 保留旧 `CLASSIFY_TOOL` + 旧 `buildClassifyPrompt` 完整副本

不拆模块，留在同一文件 `answerIntent.ts`。理由：

- 改造期间保持 diff 集中在一处，便于 review
- env 守卫切换的代码路径都在该文件内闭环
- 本特性稳定后（D-003 baseline 8 + N 周生产观测）再考虑物理删除旧路径（separate change）

### D-7 · multi-tool 路径下的 prompt 瘦身

`buildClassifyPromptMultiTool(question, docs)` 比旧 `buildClassifyPrompt` 短：

- 去掉"边界例子"段（已下沉到 tool description）
- 去掉"判定窍门"段
- 保留"用户问题 + 召回前 3 段 preview"
- 顶部仅一句 system 提示："根据用户问题和召回文档预览，调用 5 个 select_* 工具中最匹配的一个"

预估 prompt token：900 → 400；tool schema 多 ~600 token；净增 ~100 token（可接受）。

### D-8 · maxTokens / temperature 不变

`maxTokens: 80`、`temperature: 0.1`、`CLASSIFY_TIMEOUT_MS: 1500` 全部沿用。理由：multi-tool 一次只调一个 tool，args 只含短 reason，token 用量与 single-tool 相同。

## 测试矩阵

| 类型 | 测试场景 | mock 行为 | 期望 |
|---|---|---|---|
| 旧 case 兼容 | env=on, LLM 调 select_factual_lookup | `toolCalls=[{name:'select_factual_lookup', args:'{"reason":"x"}'}]` | intent=factual_lookup, fallback=false |
| 5×each | 5 类 tool name → 5 类 intent | 各 mock 一次 | 各自映射正确 |
| Hallucination | LLM 调 unknown tool name | `toolCalls=[{name:'select_xxxx', args:''}]` | intent=factual_lookup, fallback=true, reason 含 'unknown tool' |
| 多 tool | LLM 同时调 2 个 tool | `toolCalls=[{name:'select_a',...},{name:'select_b',...}]` | 取第一个 |
| Args 解析失败 | tool name 对，但 args 是 'malformed{' | `toolCalls=[{name:'select_kb_meta', args:'malformed{'}]` | intent=kb_meta, fallback=false（因为 name 决断成功）, reason 含 'parse failed' |
| 0 tool call | LLM 啥也不调 | `toolCalls=[]` | intent=factual_lookup, fallback=true |
| LLM 异常 | network 错 | reject Error | intent=factual_lookup, fallback=true, reason 含原 error |
| env=off 旧路径 | LLM 调旧 single tool | `toolCalls=[{name:'classify_answer_intent', args:'{"intent":"language_op","reason":"x"}'}]` | intent=language_op, fallback=false |
| env=off 旧 prompt | 验证 buildClassifyPrompt 而非 multi-tool 版被调用 | 检查 `mockChatComplete.mock.calls[0][1].tools[0].function.name === 'classify_answer_intent'` | 通过 |
| 规则前置 | "把上面这段翻译成中文" | mockChatComplete 不被调 | intent=language_op, reason='rule:meta+imperative' |

合计 ≥ 12 case（5×each 算 5 case）。

## 待迁移：unit test mock 形状

旧测 5 处使用：
```ts
toolCalls: [{ function: { name: 'classify_answer_intent', arguments: '{"intent":"factual_lookup","reason":"x"}' } }]
```

multi-tool 路径下改为：
```ts
toolCalls: [{ function: { name: 'select_factual_lookup', arguments: '{"reason":"x"}' } }]
```

迁移策略：旧的 5 处保留为 env=off 路径的测试（`process.env.INTENT_MULTI_TOOL_ENABLED='false'` + 旧 mock），新增 5 处对应 env=on 路径用新 mock。

## 风险接受声明

- Fast LLM (Qwen2.5-7B) 在 5-tool selection 上**可能**反而更差。eval 验证不通过时直接走回滚（env=off）。
- tool schema 多 ~600 token 不影响 maxTokens（output budget），仅影响 input billing。Qwen2.5-7B 输入 1¥/M token，每次 ~1500 input token → 本特性单次 multi-tool 多 0.0006 ¥，1000 万次 6 元，可接受。
