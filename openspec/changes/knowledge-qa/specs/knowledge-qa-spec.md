# Spec: 知识问答（Agentic RAG）

## POST /api/qa/ask — 请求验证

**Scenario: question 缺失返回 400**
- When POST /api/qa/ask body `{}`
- Then 响应 400 `{ error: "question is required" }`

**Scenario: history 非数组返回 400**
- When POST /api/qa/ask body `{ "question": "x", "history": "oops" }`
- Then 响应 400 `{ error: "history must be an array" }`

**Scenario: history 元素 role 非法返回 400**
- When history 包含 `{ role: "system", content: "x" }`
- Then 响应 400 `{ error: "invalid history role" }`

---

## Step 1: retrieveInitial

**Scenario: 正常检索并按 0.5 阈值过滤**
- Given `/api/knowledge/search` 返回 5 条结果，其中 3 条 `score > 0.5`
- When 调用 `retrieveInitial("问题")`
- Then 发出事件 `{ type: 'rag_step', icon: '🔍', label: '正在检索知识库...' }`
- And 返回的 docs 长度 = 3（过滤掉 score ≤ 0.5 的 2 条）

**Scenario: 零命中仍正常进入下一阶段**
- Given `/api/knowledge/search` 返回 `[]`
- When 调用 `retrieveInitial("无关问题")`
- Then 返回空数组
- And `gradeDocs` 收到空数组时直接 `rewriteNeeded = true`

---

## Step 2: gradeDocs

**Scenario: LLM 打 relevant=true 的文档保留**
- Given 3 篇文档，function-call 分别返回 `{relevant: true}`, `{relevant: false}`, `{relevant: true}`
- When 调用 `gradeDocs`
- Then `gradedDocs.length = 2`
- And emit `{ type: 'rag_step', icon: '📊', label: '正在评估文档相关性...' }`

**Scenario: 全被判负保底 Top2**
- Given 5 篇文档，function-call 全部返回 `{relevant: false}`
- When 调用 `gradeDocs`
- Then `gradedDocs.length = 2`（按 score 降序取 Top2）
- And `rewriteNeeded = true`

**Scenario: function-call 解析失败降级保留原档**
- Given LLM 响应 tool_calls 为空或 JSON 损坏
- When 调用 `gradeDocs`
- Then 该条视为 `relevant = true`（保守）

---

## Step 3: rewriteQuestion

**Scenario: kept ≥ 3 不触发**
- Given `gradedDocs.length = 3`
- Then 跳过 Step 3；`rewrite_triggered = false`

**Scenario: kept < 3 触发 step_back**
- Given `gradedDocs.length = 1`
- When 调用 `rewriteQuestion`
- Then emit `{ type: 'rag_step', icon: '✏️', label: '正在重写查询...' }`
- And 返回 `{ strategy: 'step_back' | 'hyde', rewritten_query: "..." }`
- And `trace.rewrite_triggered = true`

**Scenario: 重写结果去重合并**
- Given 原 kept = `[{asset_id:1},{asset_id:2}]`
- And 扩展检索返回 `[{asset_id:2},{asset_id:3}]`
- Then 合并后按 asset_id 去重 `[{asset_id:1},{asset_id:2},{asset_id:3}]`

---

## Step 4: generateAnswer（流式 + 多轮）

**Scenario: 无历史消息**
- Given `history = []`，`question = "Q1"`
- When 调用 `generateAnswer`
- Then 传给 `chatStream` 的 `messages = [{role:'user', content:'Q1'}]`
- And System prompt 包含 `[1] {asset_name}\n{chunk_content}` 片段

**Scenario: 带历史拼接**
- Given `history = [{role:'user',content:'h1'},{role:'assistant',content:'a1'}]`
- When 调用 `generateAnswer("Q2")`
- Then 传给 `chatStream` 的 messages 为 `[h1, a1, {role:'user', content:'Q2'}]`

**Scenario: history 超过 40 条截断**
- Given `history.length = 50`
- When 调用 `generateAnswer`
- Then 实际传给 `chatStream` 的 history 部分 `= history.slice(-40)`

**Scenario: 逐 token 流式推送**
- Given `chatStream` 依次 yield "Hello", " ", "world"
- Then emit 顺序为 content("Hello"), content(" "), content("world")

**Scenario: AbortSignal 中断**
- Given 生成中途 `signal.aborted = true`
- Then 不再 emit 后续 content
- And 仍然 emit `done`

---

## Step 5: trace + done

**Scenario: trace 字段完整**
- Given pipeline 正常结束，保留 2 条 citations
- Then emit 的 trace payload 形如：
  ```json
  {
    "initial_count": 5,
    "kept_count": 2,
    "rewrite_triggered": false,
    "citations": [
      { "index": 1, "asset_id": 10, "asset_name": "产品手册",
        "chunk_content": "…", "score": 0.82 },
      { "index": 2, "asset_id": 11, "asset_name": "API 指南",
        "chunk_content": "…", "score": 0.71 }
    ]
  }
  ```
- And trace 事件 **必须在** done 事件之前 emit

**Scenario: rewrite 命中时附带策略字段**
- Given `rewrite_triggered = true`，策略 step_back
- Then trace 额外包含 `rewrite_strategy: 'step_back'` 和 `rewritten_query: "..."`

**Scenario: 错误路径**
- Given Step 1 抛异常
- Then emit `{ type: 'error', message: string }`
- And emit `{ type: 'done' }`

---

## 前端：QA/index.tsx（SSE 消费）

**Scenario: 三状态气泡切换**
- Given 进入发送
- Then 气泡进入 `thinking`（三圆点）
- When 收到第一个 `rag_step`
- Then 切换到 `active`，显示 label
- When 收到第一个 `content`
- Then 切换到 `streaming`，开始拼接 text
- When 收到 `done`
- Then 切换到 `done`

**Scenario: 终止按钮**
- Given 发送中
- When 点击「终止」
- Then 调用 `abortRef.current.abort()`
- And 气泡进入 `done`，后续不再追加 content

**Scenario: 引用面板渲染**
- Given 收到 trace.citations 两条
- Then 右侧面板渲染两行，每行：`asset_name` + `chunk_content 前 100 字` + `score 百分比`

**Scenario: session_id 持久化**
- Given localStorage 无 `kc_qa_session_id`
- When 打开 QA 页面
- Then 生成 uuid 存入 localStorage
- And 之后所有 `/api/qa/ask` 请求携带该 session_id

**Scenario: history 传递**
- Given 已有两轮对话
- When 发起第三轮
- Then 请求 body.history 包含前两轮（user + assistant 交替）
