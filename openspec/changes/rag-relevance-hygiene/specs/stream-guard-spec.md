# Spec: stream-guard（D3 · chatStream 空流守护）

## chatStream 空流 throw

**Scenario: upstream 立即返 [DONE] 没有 content**
- Given `llmFetch` 返回的 SSE 流第一行就是 `data: [DONE]`
- When `chatStream(messages, ...)` 的 generator 被 `for await` 消费
- Then generator 不 yield 任何 text
- Then 抛 `Error('LLM stream returned no content chunks ...')`
- And 上层 `ragPipeline.runRagPipeline` 的 catch 冒泡到 `dispatchHandler`
- And 前端 SSE 收到 `{ type: 'error', message: 'LLM stream returned no content chunks...' }`

**Scenario: upstream 返一个 delta 后 [DONE]**
- Given stream = `data: {..."delta":{"content":"知识"}}` → `data: [DONE]`
- Then generator 正常 yield 一次 "知识" + 结束
- Then **不 throw**（yielded=1 ≥ 1）
- And 前端收到一次 `content` 事件 + `done`
- 这种情况下不改变"答复被截断"的现象；H3 的进一步根因定位另立 change

**Scenario: 中途 reader 抛异常**
- Given stream 中途 `reader.read()` reject（网络断 / upstream close）
- Then 捕获后 throw `Error('LLM stream interrupted: ...')`
- And finally 块调用 `reader.releaseLock()` 防泄漏

**Scenario: 非法 SSE 行被忽略不抛**
- Given stream = `data: not-json` → `data: {"choices":[{"delta":{"content":"hi"}}]}` → `data: [DONE]`
- Then 非法行被 try/catch 吞掉
- Then 正常 yield "hi"
- Then 不抛（yielded=1）

**Scenario: 空 content 字符串不计入 yielded**
- Given `delta.content = ""`（空串）
- Then `if (text) yield text` 不 yield
- Then 若整个流只有这种空 delta → 最终 yielded=0 → throw

## 上层行为（不在 llm.ts 但受本 spec 约束）

**Scenario: ragPipeline 捕获 chatStream throw**
- Given `chatStream` 抛空流错误
- When ragPipeline `for await (const text of stream)` 消费
- Then 错误冒泡出 `runRagPipeline`
- Then `dispatchHandler` 的 try/catch 捕获（现有逻辑不需改）
- Then emit `{ type: 'error', message: <msg> }` + `{ type: 'done' }`

**Scenario: 前端看到错误 event 显式提示**
- Given 前端 SSE 消费到 `{ type: 'error', message: 'LLM stream returned...' }`
- Then UI 显示错误气泡（现有 Agent / QA 两处都已有对应渲染，不改前端）
- 用户**不再看到"答复只有两字就停"**的静默截断
