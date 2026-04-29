# Design: Notebook 接入档 B 意图分流（N-001）

## 架构总览

```
┌─── notebookChat.streamNotebookChat ─────────────┐
│ 1. 拉 notebook 的 sources → assetIds            │
│ 2. 拉最近 10 轮 history                          │
│ 3. SSE setup                                    │
│ 4. runRagPipeline(question, history, emit, sig, │
│      { assetIds, citationStyle: 'footnote' })   │
│        │                                         │
│        ▼                                         │
│      generateAnswer 内部走档 B 5 类意图分流     │
│      → buildSystemPromptByIntent(intent, ctx,   │
│           inlineImageRule, 'footnote')          │
│      → footnote 模式：模板 [N] → [^N]           │
│        │                                         │
│        ▼ LLM 输出含 [^N] 引用                   │
│ 5. 入库 notebook_chat_message                   │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─── 前端 ChatPanel.tsx 解析 ────────────────────┐
│  re = /\[\^(\d+)\]/g  (不变)                   │
│  → 引用高亮 + 点击展开 source                  │
└────────────────────────────────────────────────┘
```

## 模块边界

| 文件 | 改动 |
|---|---|
| `services/answerPrompts.ts` | 加 `CitationStyle` 类型 + `buildSystemPromptByIntent` 第 4 参数 + footnote 模式 [N]→[^N] 替换 |
| `services/ragPipeline.ts` | `generateAnswer` 加可选 `citationStyle` 参数；`RunRagOptions.citationStyle` 字段；`runRagPipeline` 透传 |
| `services/notebookChat.ts` | 删 `NOTEBOOK_SYSTEM_PROMPT`；`runRagPipeline` 调用 `systemPromptOverride` → `citationStyle: 'footnote'` |
| `__tests__/answerPrompts.test.ts` | 加 footnote 模式 5 case |
| `__tests__/notebookChat.test.ts` | 新建（可选，覆盖 footnote 行为） |

## CitationStyle 枚举

```ts
export type CitationStyle = 'inline' | 'footnote'
//   inline:   [1] [2] [1][2]  （rag-intent-routing 默认 / 全局 chat）
//   footnote: [^1] [^2] [^1][^2]  （Notebook ChatPanel 解析格式）
```

## footnote 模式实现

`buildSystemPromptByIntent` 内部最后一步做 string replace：

```ts
function buildSystemPromptByIntent(
  intent: AnswerIntent,
  context: string,
  inlineImageRule = '',
  citationStyle: CitationStyle = 'inline',
): string {
  const inlinePrompt = (() => {
    switch (intent) { ... }  // 现有逻辑不变
  })()
  if (citationStyle === 'inline') return inlinePrompt
  // footnote 模式：把 prompt 模板里所有 [N] 字面替换成 [^N]
  // 注意：context（召回文档）里也含 [N]（来自 docContext 拼接），不替换 context
  // 实现：拆分 "文档内容：" 之前后两段，只替换 prompt 部分
  const idx = inlinePrompt.indexOf('文档内容：')
  if (idx < 0) return inlinePrompt.replace(/\[(\d+)\]/g, '[^$1]')
  const promptPart = inlinePrompt.slice(0, idx).replace(/\[(\d+)\]/g, '[^$1]')
  const contextPart = inlinePrompt.slice(idx)  // 保留 [N] 不变
  return promptPart + contextPart
}
```

**为什么不替换 context**：召回文档拼接段 `[1] asset_name\n chunk_content`
是给 LLM 看的"哪些 chunk 标了几号"，不是引用模板。LLM 看到 `[1]` 知道 doc 1，
然后按规则输出 `[^1]` 给前端。

## 失败模式

| 故障 | 行为 | 回滚 |
|---|---|---|
| LLM 不稳定输出 `[1]` 而非 `[^1]` | 前端 regex 漏掉，引用看不到（但答案文字仍可见）| 用户体验下降；规则约束已在 prompt，重测 1-2 次确认稳定 |
| footnote replace 错位（替换了 context 里的 [N]）| 见上文，`indexOf('文档内容：')` 拆分隔离 | 单元测试覆盖确保不替换 context |
| 整套 N-001 revert | revert commit；citationStyle 参数全可选；调用方零适配 | 干净回滚 |

## 现有调用方影响

```
runRagPipeline 调用方（grep '调 runRagPipeline'）：
  - apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts:30, 42, 83
  - apps/qa-service/src/services/notebookChat.ts:100  ← 本 PR 改这条

KnowledgeQaAgent 路径：不传 citationStyle → 默认 inline → 行为不变
notebookChat 路径：传 citationStyle: 'footnote' → 走档 B + footnote
```

## 与 systemPromptOverride 的关系

systemPromptOverride 仍然保留，**但 notebookChat 不再用**：
- 其它将来需要完全自定 prompt 的调用方仍可用 override
- override + citationStyle 的优先级：override 优先（保持 rag-intent-routing
  的 freeze 契约），citationStyle 仅在不传 override 时生效

## inline image 规则的兼容

inline image 规则（ADR-45）的内容是 `![描述](/api/assets/images/<id>)`，是
markdown image syntax，不含 `[N]` 字符串。footnote 替换正则 `\[(\d+)\]`
只匹配纯数字方括号，不会误伤 `![描述](url)`。
