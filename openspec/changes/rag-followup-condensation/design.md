# Design: RAG Follow-up Question Condensation

## 架构总览

```
┌─────── ragPipeline.runRagPipeline ─────────┐
│  (本 change 改造点)                        │
│  Step 0  retrievalQuestion = await         │
│           condenseQuestion(question,       │
│             history, emit)                 │
│  Step 1  retrieveInitial(retrievalQ, ...)  │ ◀── 改用 retrievalQuestion
│  Step 2  gradeDocs(retrievalQ, ...)        │ ◀── 改用 retrievalQuestion
│  Step 3  rewriteQuestion(retrievalQ, ...)  │ ◀── 改用 retrievalQuestion
│  Step 4  generateAnswer(question,          │ ◀── 仍用原 question + history
│                          history, ...)     │
│  Step 5  recordCitations(question, ...)    │ ◀── 仍用原 question
└────────────────────────────────────────────┘
                    │
                    ▼
┌─────── condenseQuestion ───────────────────┐
│ if !env.B_HANDLER_ROUTING_ENABLED → 原句   │
│ if history 空 → 原句                       │
│ if !looksLikeFollowUp(question) → 原句     │
│ try:                                       │
│   chatComplete(condensePrompt,             │
│     model: fast, maxTokens: 80)            │
│   清理输出（剥前缀 / 引号）                │
│   if 空 / 超长 / 等于原句 → 原句           │
│   emit 🪄 rag_step                         │
│   return cleaned                           │
│ catch → 原句                               │
└────────────────────────────────────────────┘
```

## 模块边界

| 文件 | 职责 | 公开符号 |
|---|---|---|
| `services/condenseQuestion.ts` | follow-up 判定 + 改写 | `looksLikeFollowUp` / `isCondenseEnabled` / `condenseQuestion` |
| `services/ragPipeline.ts` | 接入点（`runRagPipeline` 内 Step 0） | 不新增公开符号；签名不变 |

`ragPipeline.ts` 对外签名（`runRagPipeline / generateAnswer / retrieveInitial /
gradeDocs / rewriteQuestion / retrieveExpanded / toCitation` 等）**全部不变**，
本 change 只在 `runRagPipeline` 体内加路由。

## condense LLM 调用约束

- **Model**：`getLlmFastModel()`（默认 `Qwen/Qwen2.5-7B-Instruct`）
- **maxTokens**：80
- **temperature**：0.2
- **prompt 输入**：最近 4 轮 history（每轮内容截断到 400 字符）+ 当前 question +
  改写规则
- **改写规则**：
  1. 把代词 / 省略指代（它/这/那/原文/继续）替换成历史里出现过的具体实体名
  2. 不要增加历史中没有的信息，不要回答问题
  3. 只输出改写后的问句一行，不要解释，不要加引号、不要加 Markdown
  4. 如果当前提问已经自洽（不需要历史就能理解），直接原样输出

## 触发条件

```ts
function looksLikeFollowUp(question: string): boolean {
  const q = question.trim()
  if (q.length === 0) return false
  if (q.length <= 12) return true              // 中英文短问题
  const lower = q.toLowerCase()
  if (PRONOUN_MARKERS.some(p => lower.includes(p))) return true
  if (META_MARKERS.some(m => lower.includes(m))) return true
  return false
}
```

- `PRONOUN_MARKERS`：它 / 他 / 她 / 它们 / 他们 / 她们 / 这 / 那 / 此 / 这个 / 那个 /
  这些 / 那些 / 这本 / 那本 / 这部 / 那部 + 英文 it / this / that / these / those
- `META_MARKERS`：原文 / 全文 / 继续 / 再 / 还 / 也 / 又 / 接着 / 然后 / 那么 /
  解释 / 翻译 / 总结 / 详细 / 具体 / 展开 / 举例 / 另外 / 其他 / 别的 + 英文
  continue / explain / translate / summary / summarize / detail / more

## 输出清理

LLM 输出按下列顺序剥离：

1. trim
2. 剥前缀：`改写后：` / `改写过：` / `独立问句：`
3. 剥行首破折号 / 项目符号 / 空白
4. 剥首尾引号（"" / `` / `'` / 全角 「」 『』 【】）
5. 再 trim

清理后结果若为空 / > 200 字符 / 等于原 question.trim() → 不替换，emit 静默。

## emit 事件

```ts
emit({
  type: 'rag_step',
  icon: '🪄',
  label: `指代改写：「${question}」→「${cleaned}」`,
})
```

- 仅成功改写且 `cleaned !== question.trim()` 时 emit
- **不新增 SseEvent type**（沿用 `rag_step`），老前端零感知

## 失败模式 + 回滚

| 故障 | 行为 | 回滚 |
|---|---|---|
| LLM 5xx / 网络 | catch → 返回原 question | 自动 |
| LLM 返回空 / 超长 / 等于原句 | 返回原 question | 自动 |
| env 关 / LLM 未配置 / history 空 / 触发不命中 | 立即返回原 question（不调 LLM） | 自动；零 cost |
| 整套 change revert | revert 单 commit；ragPipeline 调用方零适配 | 干净回滚 |

## 与其它 change 的关系

- **rag-intent-routing（同 PR）**：condense 在 retrieval 之前；意图分类在
  generation 之前——两者各管一段，零交互
- **adaptiveTopK（同 PR）**：adaptiveTopK 看到的是 `retrievalQuestion`（已改写过）
  → 短指代型问题被 condense 改长后，绕过 adaptiveTopK 的"短查询"分支，更合理
- **viking memory（KnowledgeQaAgent 内 recallMemory）**：viking 是把跨 session
  历史拼到 history 头部 augment LLM context；condense 是把 history 改写成 query
  给 retrieval；正交
- **A condense ↔ ADR-46 D-002 意图分流**：condense 解决"retrieval 没用 history"；
  D-002 解决"LLM 把翻译当外部知识"；两者都对；A 是结构化机制，D-002 是 generation
  阶段路由
