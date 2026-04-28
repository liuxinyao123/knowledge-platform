# Spec: condenseQuestion 模块

## 模块：services/condenseQuestion.ts

### 公开函数

```ts
export function isCondenseEnabled(): boolean
export function looksLikeFollowUp(question: string): boolean
export async function condenseQuestion(
  question: string,
  history: HistoryMessage[],
  emit: EmitFn,
): Promise<string>
```

---

## isCondenseEnabled · env 探测

### Scenario: 默认 on

- Given env `RAG_CONDENSE_QUESTION_ENABLED` 未设
- When 调用 `isCondenseEnabled()`
- Then 返回 `true`

### Scenario: env 关闭接受 false / 0 / off / no（大小写不敏感）

- Given env `RAG_CONDENSE_QUESTION_ENABLED` 取以下任一值：
  `false`, `0`, `off`, `no`, `FALSE`, `Off`
- When 调用 `isCondenseEnabled()`
- Then 返回 `false`

---

## looksLikeFollowUp · 触发判定

### Scenario: 短问题（≤12 字符）触发

- Given `question = '原文'` / `'那你把原文发我'` / `'给我解释一下'`
- When 调用 `looksLikeFollowUp(question)`
- Then 返回 `true`

### Scenario: 长且无信号词不触发

- Given `question = '请告诉我世界上最长的一条河流是什么名字呢'`（长 + 无代词无元词）
- When 调用 `looksLikeFollowUp(question)`
- Then 返回 `false`

### Scenario: 含代词触发（即便长）

- Given `question = '它的作者是谁啊我想了解一下背景资料'`
- When 调用 `looksLikeFollowUp(question)`
- Then 返回 `true`（含 "它"）

### Scenario: 含元词触发（即便长）

- Given `question = '帮我把上面那段内容翻译成英文版本好吗'`
- When 调用 `looksLikeFollowUp(question)`
- Then 返回 `true`（含 "翻译"）

### Scenario: 空字符串不触发

- Given `question = ''` 或 `'   '`（trim 后空）
- When 调用 `looksLikeFollowUp(question)`
- Then 返回 `false`

---

## condenseQuestion · 主行为契约

### Scenario: env 关闭直接回落

- Given env `RAG_CONDENSE_QUESTION_ENABLED=false`
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 返回 `'原文'`（原 question）
- And **不**调用 `chatComplete`
- And **不**emit 任何事件

### Scenario: history 空直接回落

- Given `history = []`
- When 调用 `condenseQuestion('那你把原文发我', [], emit)`
- Then 返回 `'那你把原文发我'`
- And **不**调 LLM
- And **不**emit

### Scenario: 触发条件不满足直接回落

- Given `question = '请告诉我世界上最长的河流是什么名字呢谢谢'`（长 + 无信号词）
- And `history` 非空
- When 调用 `condenseQuestion(question, history, emit)`
- Then 返回原 question
- And **不**调 LLM
- And **不**emit

### Scenario: 短指代型 + 非空 history → 改写并 emit

- Given `question = '那你把原文发我'`
- And `history = [...{道德经 4 轮}]`
- And `chatComplete` 返回 `{ content: '请提供《道德经》第一章的原文', ... }`
- When 调用 `condenseQuestion(question, history, emit)`
- Then 调用 `chatComplete` 一次
- And 返回 `'请提供《道德经》第一章的原文'`
- And emit 事件 `{ type: 'rag_step', icon: '🪄', label: '指代改写：「那你把原文发我」→「请提供《道德经》第一章的原文」' }`

### Scenario: LLM 抛异常 → 静默回落原句

- Given `chatComplete` 抛 `Error('LLM 502')`
- When 调用 `condenseQuestion('给我解释一下', history, emit)`
- Then 返回 `'给我解释一下'`
- And **不**emit
- And **不**抛错

### Scenario: LLM 返回空 → 回落原句

- Given `chatComplete` 返回 `{ content: '   ', ... }`
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 返回 `'原文'`
- And **不**emit

### Scenario: LLM 返回与原句相同 → 不替换 / 不 emit

- Given `chatComplete` 返回 `{ content: '原文', ... }`
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 返回 `'原文'`
- And **不**emit

### Scenario: LLM 返回 > 200 字符 → 回落原句

- Given `chatComplete` 返回 `{ content: 'X'.repeat(201), ... }`
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 返回 `'原文'`
- And **不**emit

### Scenario: 引号包裹 / "改写后：" 前缀清理

- Given `chatComplete` 返回 `{ content: '改写后：「请提供《道德经》第一章的原文」', ... }`
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 清理后返回 `'请提供《道德经》第一章的原文'`（剥 "改写后：" + 全角引号）
- And emit 事件含清理后字符串

### Scenario: prompt 包含最近 4 轮 history + 当前问题

- Given `history` 长度 = 6（含 6 条 user/assistant 交替）
- When 调用 `condenseQuestion('原文', history, emit)`
- Then 发给 LLM 的 prompt 包含最近 4 条（不是全 6 条）
- And 包含当前 question `'原文'`
- And 每条 history content 截断到 ≤ 400 字符 + `'…'`

### Scenario: prompt 包含改写规则 4 条

- When 调用 `condenseQuestion(...)`
- Then 发给 LLM 的 prompt 包含：
  - "把代词和省略指代（它/这/那/原文/继续）替换成历史里出现过的具体实体名"
  - "不要增加历史中没有的信息，不要回答问题"
  - "只输出改写后的问句一行，不要解释，不要加引号、不要加 Markdown"
  - "如果当前提问已经自洽（不需要历史就能理解），直接原样输出"

### Scenario: maxTokens=80 / temperature=0.2 / model=fast

- When 调用 `condenseQuestion(...)`
- Then `chatComplete` 入参 `model = getLlmFastModel()`
- And `maxTokens = 80`
- And `temperature = 0.2`
