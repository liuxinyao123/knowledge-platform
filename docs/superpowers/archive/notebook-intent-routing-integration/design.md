# Explore · Notebook 接入档 B 意图分流（N-001）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore
> 上游依赖：rag-intent-routing（已 freeze · 含 systemPromptOverride 跳过 classifier 的契约）
> 起因：rag-intent-routing PR 留下的 user-facing 隐患

## 背景

`apps/qa-service/src/services/notebookChat.ts` 调 `runRagPipeline` 时传
`systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT`。按 rag-intent-routing 的
`handler-routing-spec.md`：

> **systemPromptOverride 仍然优先**：传入时**跳过 classifier**（向后兼容）。

意味着 notebook 内对话**不走档 B 5 类意图分流**——仍用一份 monolithic
NOTEBOOK_SYSTEM_PROMPT，含 mm/COF/0.3+0.7 三个工业制造 hardcoded 示例 + 严格
"找不到说没有"规则。

复现 case：用户在某个 notebook 内（含道德经 source）问"给他的原文的解释"——
跟刚修好的全局 chat 行为不一致，notebook 内会按 NOTEBOOK_SYSTEM_PROMPT 拒答。

A condense 和 C adaptiveTopK 因为在 retrieval 阶段，**自动**对 notebook 生效；
档 B 因为是 prompt 阶段（被 override 跳过），**没**对 notebook 生效。

## 关键约束 · 引用样式不兼容

`apps/web/src/knowledge/Notebooks/ChatPanel.tsx:304` 解析引用用 regex：

```ts
const re = /\[\^(\d+)\]/g    // 注意是 [^N]，不是 [N]
```

跟全局 chat 不一样：
- **全局 chat 引用样式**：`[1]` `[2]` `[1][2]`（rag-intent-routing 5 个模板都用这个）
- **Notebook 引用样式**：`[^1]` `[^2]` `[^1][^2]`（footnote 风格，前端按这个 parse）

直接让 notebook 走档 B 模板 → LLM 输出 `[N]` → ChatPanel regex 漏掉 → 前端
看不到引用高亮。**这是 N-001 必须解决的核心兼容性问题。**

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 答案后置处理**：notebook 后端把 SSE 流里的 `[N]` 实时替换成 `[^N]` | 让 notebook 走档 B；LLM 输出 `[N]`；后端在 SSE chunk 流里 string replace | **风险**：流式 token 切片可能把 `[` 和数字切开，需要小 buffer；replace 逻辑藏在 SSE 中间层，不显眼 |
| **C-B 扩展 buildSystemPromptByIntent 加 citationStyle 参数**（选中）| `buildSystemPromptByIntent(intent, context, inlineImageRule, citationStyle: 'inline' \| 'footnote')`；footnote 模式下模板里所有 `[N]` → `[^N]`；generateAnswer + runRagPipeline 也透传 citationStyle；notebookChat 不再传 override，改传 `citationStyle: 'footnote'` | **优点**：干净的接口契约扩展，引用样式成一等公民配置；后向兼容（默认 `inline`）；notebook 完全享受档 B 收益 |
| **C-C notebookChat 自己做 classify**：完全绕开 generateAnswer 的意图分类，notebookChat 内部 classify 后选 5 个 NOTEBOOK_PROMPT_<INTENT> | 复制了档 B 的分类逻辑到 notebookChat；维护成本高 |

**结论**：走 C-B。最干净，且把"引用样式"提升为一等参数（未来可能有 markdown
mode / plain mode / mathjax mode 等扩展）。

## C-B 接口契约扩展

### `apps/qa-service/src/services/answerPrompts.ts`

```ts
export type CitationStyle = 'inline' | 'footnote'

export function buildSystemPromptByIntent(
  intent: AnswerIntent,
  context: string,
  inlineImageRule?: string,
  citationStyle: CitationStyle = 'inline',  // 新增第 4 参数
): string
```

`footnote` 模式：5 个模板里所有 `[N]` 字面替换成 `[^N]`：
- `factual_lookup`：`每个事实陈述后加 [N] 引用` → `[^N] 引用`
- `language_op`：`每段输出后加 [N] 引用` → `[^N] 引用`
- `multi_doc_compare`：`每条事实加 [N] 引用` → `[^N] 引用`
- `kb_meta`：原本就 `不加 [N] 引用` → `不加 [^N] 引用`（语义不变）
- `out_of_scope`：原本就 `不加 [N] 引用` → 同上

inline image 规则（ADR-45）的 `[N]` 也同步替换。

### `apps/qa-service/src/services/ragPipeline.ts`

```ts
// generateAnswer 加可选参数
export async function generateAnswer(
  question: string,
  docs: AssetChunk[],
  history: HistoryMessage[],
  emit: EmitFn,
  signal: AbortSignal,
  systemPromptOverride?: string,
  extras?: { ... },
  citationStyle?: CitationStyle,  // 新增
): Promise<void>

// RunRagOptions 加字段
export interface RunRagOptions {
  ...
  /** N-001: 引用样式，inline = [N]（默认），footnote = [^N]（notebook） */
  citationStyle?: CitationStyle
}

// runRagPipeline 透传
await generateAnswer(
  question,
  finalDocs,
  history,
  emit,
  signal,
  opts.systemPromptOverride,
  { webHits, image: opts.image },
  opts.citationStyle,  // 透传
)
```

### `apps/qa-service/src/services/notebookChat.ts`

```ts
// 删除 NOTEBOOK_SYSTEM_PROMPT 常量（不再需要 monolithic prompt）

await runRagPipeline(question, history, collector, ac.signal, {
  assetIds,
  citationStyle: 'footnote',  // ← 新参数，替代 systemPromptOverride
  // systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT,  ← 删除
})
```

后置效果：notebook 内对话走完整档 B 5 类意图分流 + footnote 引用样式。

## 风险

| 风险 | 缓解 |
|---|---|
| **现有 notebook 历史消息引用样式仍是 `[^N]`，跟新生成的混杂** | 新生成的也是 `[^N]`（footnote 模式）—— 无混杂 |
| **systemPromptOverride 还有别的调用方？** | grep 确认仅 notebookChat 用；其它地方不动 |
| **archive 后 spec 改动** | rag-intent-routing 已 freeze，本 N-001 是**向后兼容扩展**（加可选参数 default = 老行为）；不需要回去改 rag-intent-routing 的 spec |
| **5 个模板替换字符 [N] → [^N] 误伤** | 用 string replace `\[(\d+)\]` → `[^$1]`；spec 里加 scenario 验证 5 个模板的 footnote 输出 |
| **inline image 规则 6 里的 image_id markdown 不能改** | image markdown 是 `![alt](url)`，不含 `[N]`，不受影响 |
| **现有单元测试 answerPrompts.test.ts 全部按 inline 写** | 加新测试覆盖 footnote 模式；老测试不动（默认参数 = inline） |

## 与 systemPromptOverride 的关系

systemPromptOverride 在 rag-intent-routing 已 freeze 为"传入时跳过 classifier"。
N-001 之后 notebookChat 不再用 override，但 systemPromptOverride 这个口子保留
不动——其它将来的调用方（如某个特殊的 agent 路径需要完全自定 prompt）仍可用。

## V-3 已知 limitation 在 notebook 内的表现

- **V3C "what is over slam" → factual_lookup 拒答**：notebook 内同样会拒答，
  这是 prompt 严格"找不到说没有"的诚实表现，不是 N-001 引入的回归
- **V3D "库里有什么"** → notebook 内问"我这本里有什么"会走 short-circuit 兜底
  （notebook scope 内召回更弱）—— 跟全局 chat 同根因，等 D-002.2 修

## Out of Scope

- **per-notebook prompt 自定义**：用户给单个 notebook 配置自己的 system prompt
  套件 → N-006 模板那条路，不在本 change
- **per-tenant citationStyle 配置**：现在固定 inline / footnote 二选一，未来可
  扩 mathjax / latex / markdown footnote 等 → D-004 prompt 数据化候选项
- **删掉 systemPromptOverride 完全**：保留口子给将来其它调用方

## 后续路径

1. **N-001 落地** = notebook 享受档 B + condense + adaptiveTopK 全栈调优
2. **N-002** 扩展 artifact 类型时复用 `buildSystemPromptByIntent` + `citationStyle: 'footnote'`
3. **N-005** artifact 接入意图分流 → 直接复用 N-001 的 citationStyle 扩展
