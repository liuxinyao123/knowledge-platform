# Spec: Agent 编排层

## POST /api/agent/dispatch — 请求校验

**Scenario: question 缺失返 400**
- When POST /api/agent/dispatch body `{}`
- Then 响应 400 `{ error: "question is required" }`

**Scenario: hint_intent 非法返 400**
- When body.hint_intent = `"unknown"`
- Then 响应 400 `{ error: "invalid hint_intent" }`

**Scenario: 未认证返 401**
- When 无 Authorization 头
- Then 响应 401（由 unified-auth `requireAuth` 处理）

---

## IntentClassifier

**Scenario: LLM 高置信**
- Given 问题"登录接口是什么"；LLM 返回 `{intent:'knowledge_qa', confidence:0.92, reason:"..."}`
- When `classify(question)`
- Then 返回 `{intent:'knowledge_qa', confidence:0.92, fallback:false}`

**Scenario: LLM 低置信触发 fallback**
- Given LLM 返回 confidence=0.4
- Then 走关键字路径；`fallback=true`

**Scenario: LLM 调用失败**
- Given LLM 抛异常或超时
- Then 走关键字路径；`fallback=true`

**Scenario: 关键字规则命中 metadata_ops**
- Given 问题"新建一个数据资产"，LLM 不可用
- Then `intent = 'metadata_ops'`, `fallback=true`

**Scenario: 关键字规则命中 structured_query**
- Given 问题"SELECT * FROM asset WHERE..."
- Then `intent = 'structured_query'`, `fallback=true`

**Scenario: 默认兜底 knowledge_qa**
- Given 问题无关键字匹配，LLM 不可用
- Then `intent = 'knowledge_qa'`, `fallback=true`

**Scenario: 可配置阈值**
- Given env `AGENT_INTENT_THRESHOLD=0.8`
- And LLM 返回 confidence=0.7
- Then 走 fallback（confidence < 0.8）

---

## Dispatch 流水线

**Scenario: 正常流，单 Agent**
- Given question 触发 knowledge_qa
- Then SSE 事件顺序至少包含：
  1. `agent_selected {intent:'knowledge_qa', agent:'KnowledgeQaAgent', fallback:false}`
  2. `rag_step`（多次）
  3. `content`（多次）
  4. `trace`
  5. `done`

**Scenario: hint_intent 跳过 classifier**
- Given body.hint_intent = `'data_admin'`
- Then 不调 LLM；直接发 `agent_selected {intent:'data_admin', confidence:1, reason:'hint'}`

**Scenario: Agent 执行抛异常**
- Given 选中的 Agent 在 run 中抛 Error("X")
- Then 先 emit `agent_selected`，再 emit `error {message:"X"}`，最后 emit `done`
- And HTTP 状态码保持 200（SSE 流内传递错误）

**Scenario: Client abort**
- Given 客户端关闭连接
- Then `AbortSignal.aborted = true`
- And Agent 停止生成 content，emit `done` 退出

---

## KnowledgeQaAgent

**Scenario: 事件形状与 `/api/qa/ask` 一致**
- Given hint_intent='knowledge_qa'，问题 X
- Then `trace.data` 与直接打 `/api/qa/ask` 的 trace payload 在 citations / kept_count 等字段上一致
- And 除多一个 `agent_selected` 事件外，其余事件一一对应

---

## DataAdminAgent

**Scenario: 走 runDataAdminPipeline**
- Given 问题命中 data_admin（如"统计上周新增多少问答"）
- Then emit `agent_selected {intent:'data_admin'}`
- And 调用 `runDataAdminPipeline(question, history, emit, signal)` 一次

---

## StructuredQueryAgent（占位）

**Scenario: 返回 not_implemented**
- Given intent = structured_query
- Then SSE 依次 emit：`agent_selected`, `rag_step` 提示建设中，`content` 说明，`trace {status:'not_implemented'}`, `done`

---

## MetadataOpsAgent

**Scenario: 非 ADMIN 被拦截**
- Given principal roles=['editor']
- And intent=metadata_ops
- Then unified-auth `enforceAcl({action:'ADMIN'})` 返 403
- And 流水线不执行

**Scenario: ADMIN 读操作**
- Given principal roles=['admin']，问题"列出所有数据源"
- Then Agent 调用 `list_sources` tool
- And emit `content` 为 sources 的 markdown 列表
- And emit `trace {tool_calls: [...]}`

**Scenario: 写操作占位**
- Given 问题"新建一个资产"
- Then emit `content` "写操作建设中"
- And 不对 `metadata_asset` 表发生任何写入

---

## `/api/qa/ask` 兼容

**Scenario: 旧调用者透明升级**
- Given 旧代码 `POST /api/qa/ask body {question:"x"}`（不带 hint_intent）
- Then 内部转 `dispatch(hint_intent='knowledge_qa')`
- And 客户端收到的事件流与之前一致（多出一个 `agent_selected` 可选事件，client 若不认识应忽略）

---

## 可观测

**Scenario: 日志包含 verdict**
- Given 每次 dispatch 完成
- Then 后端 info 日志打出 `{user_id, intent, confidence, fallback, agent, duration_ms}`
