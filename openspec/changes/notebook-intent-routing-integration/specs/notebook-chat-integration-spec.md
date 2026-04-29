# Spec: notebookChat 接入档 B + ragPipeline 透传 citationStyle

## 模块：services/ragPipeline.ts

### `RunRagOptions` 扩展

```ts
export interface RunRagOptions {
  // ... 现有字段不变
  
  /** N-001: 引用样式。inline = [N]（默认，全局 chat）；footnote = [^N]（notebook） */
  citationStyle?: CitationStyle
}
```

### `generateAnswer` 函数签名扩展

```ts
export async function generateAnswer(
  question: string,
  docs: AssetChunk[],
  history: HistoryMessage[],
  emit: EmitFn,
  signal: AbortSignal,
  systemPromptOverride?: string,
  extras?: { ... },
  citationStyle?: CitationStyle,    // 新增可选第 8 参数
): Promise<void>
```

### 行为契约

#### Scenario: 不传 citationStyle → 默认 inline

- Given `runRagPipeline(...)` 调用 opts 中**不**含 `citationStyle`
- When `runRagPipeline` 内部调 `generateAnswer`
- Then `generateAnswer` 拿到 `undefined`
- And 默认走 inline 模式（5 个 intent 模板用 `[N]`）
- And 行为等价 rag-intent-routing freeze 状态

#### Scenario: opts.citationStyle = 'footnote' → 透传

- Given `runRagPipeline(question, history, emit, signal, { ..., citationStyle: 'footnote' })`
- When `runRagPipeline` 内部调 `generateAnswer`
- Then `generateAnswer` 收到 `citationStyle = 'footnote'`
- And 调 `buildSystemPromptByIntent(intent, ctx, inlineImageRule, 'footnote')`
- And 5 类 intent 模板都生成 footnote 样式

#### Scenario: systemPromptOverride 优先级仍最高

- Given `opts = { systemPromptOverride: 'CUSTOM', citationStyle: 'footnote' }`
- When `generateAnswer` 执行
- Then 用 `systemPromptOverride`，**忽略** `citationStyle`
- And 跳过意图分类（保持 rag-intent-routing freeze 契约）
- And 这是为了向后兼容；notebookChat 改造后不再传 override，所以实际不冲突

#### Scenario: web 模式（hasWeb）下 citationStyle 也传给 web prompt

- Given `extras.webHits.length > 0` AND `citationStyle: 'footnote'`
- When `generateAnswer` 选 web prompt 而非 5 类模板
- Then web prompt **不接入** citationStyle（web prompt 模板硬编码 `[N]/[wN]`，
  不在本 PR scope）
- 备注：notebookChat 不开启 web search，所以这条不在 V-2 验证范围

---

## 模块：services/notebookChat.ts

### 改动

```diff
- const NOTEBOOK_SYSTEM_PROMPT = `你是用户的研究助手。严格遵循以下规则：
- ...
- ✗ 错误: COF 可能是 Coefficient of Friction（编造）`
+ // N-001: 删除 NOTEBOOK_SYSTEM_PROMPT，改为传 citationStyle: 'footnote'
+ // 让 notebook 享受档 B 5 类意图分流 + footnote 引用样式

  await runRagPipeline(question, history, collector, ac.signal, {
    assetIds,
-   systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT,
+   citationStyle: 'footnote',
  })
```

### 行为契约

#### Scenario: notebookChat 走档 B 5 类意图分流

- Given notebook chat 收到用户问题（如 "把上面这段翻译成中文"）
- And history 含相关上下文
- When `streamNotebookChat` 调 `runRagPipeline` with `{ assetIds, citationStyle: 'footnote' }`
- Then `generateAnswer` 内部**不**再被 systemPromptOverride 跳过 classifier
- And 调用 `classifyAnswerIntent` 分到 5 类之一
- And 走对应 prompt 模板（footnote 样式）
- And emit `🎭 答案意图分类 → <intent>（<reason>）`

#### Scenario: notebookChat 内 case2a 等价 case 不再拒答

- Given notebook 含道德经 source
- And user 问 "给他的原文的解释" + history 含第一章原文
- When `streamNotebookChat` 跑
- Then **不**输出 "知识库中没有相关内容" 拒答
- And 输出逐句白话翻译（每段后含 `[^N]` 引用）
- And 末尾含透明度声明 "以上仅就文档原文做..."

#### Scenario: notebookChat 引用样式 = footnote

- Given notebook chat LLM 输出引用
- When 答案 stream 到前端
- Then 引用形式是 `[^1]` `[^2]` `[^1][^2]`（不是 `[1]` `[2]`）
- And ChatPanel.tsx:304 regex `/\[\^(\d+)\]/g` 能正确匹配

#### Scenario: notebookChat 0 source 兜底不变

- Given notebook 无任何 source（assetIds 长度 0）
- When `streamNotebookChat` 检查
- Then 仍 emit "Notebook 还没有添加任何资料..." 兜底
- And 不进 ragPipeline
- And 不入库（避免污染）

#### Scenario: notebookChat 持久化逻辑不变

- Given chat 跑完
- When 持久化 user + assistant 消息
- Then 仍按现有逻辑写 `notebook_chat_message`（含 citations + trace JSON）
- And content 字段含 `[^N]` 引用（前端按现有 regex 解析）

---

## 测试覆盖

- 单元测试 `__tests__/answerPrompts.test.ts` 加 footnote 模式 case（5 + 1 边界）
- 现有 `ragPipeline.test.ts` / `ragPipeline.shortCircuit.test.ts` 零回归
  （默认 citationStyle 缺省 = inline）
- E2E：notebookChat 实测（V-2）由 user 跑

---

## 回滚

- env 层无开关（citationStyle 是参数不是 env）；如需运行期回滚 ⇒ revert commit
- revert 后：
  - notebookChat 重新用 NOTEBOOK_SYSTEM_PROMPT（如果还要走 monolithic 老路）
  - 或保留 N-001 但 notebookChat 改回不传 citationStyle，那答案引用变成 `[N]`
    导致 ChatPanel 解析失败（不推荐）
  - 推荐回滚方式：完全 revert 整个 commit
