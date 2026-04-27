# Spec: Agentic RAG QA — 行为规格

## RAG Pipeline — grade_documents

**Given** 8 个文档，LLM 判断全部不相关
**When** gradeDocs 执行完毕
**Then** 返回原始 top2 文档（保底逻辑）且 rewriteNeeded=true

**Given** 8 个文档，LLM 判断 4 个相关
**When** gradeDocs 执行完毕
**Then** 返回 4 个相关文档，rewriteNeeded=false

**Given** 8 个文档，LLM 判断 2 个相关
**When** gradeDocs 执行完毕
**Then** 返回 2 个相关文档，rewriteNeeded=true（< 3 触发重写）

## RAG Pipeline — rewriteQuestion

**Given** rewriteNeeded=true，LLM 选择 step_back 策略
**When** rewriteQuestion 执行
**Then** 返回 strategy='step_back' 和一个泛化后的 rewrittenQuery

**Given** rewriteNeeded=true，LLM 选择 hyde 策略
**When** rewriteQuestion 执行
**Then** 返回 strategy='hyde' 和一个假设答案作为 rewrittenQuery

## RAG Pipeline — runRagPipeline（端到端）

**Given** 问题发出，初次检索到 5 篇高度相关文档（grade 通过 ≥ 3）
**When** pipeline 运行
**Then** 不触发 rewrite（Step 3/4 跳过），emit 顺序为：rag_step(🔍) → rag_step(📊) → rag_step(💡) → content... → trace → done

**Given** 问题发出，初次检索相关文档 < 3
**When** pipeline 运行
**Then** 触发 rewrite，emit 包含 rag_step(✏️) 和 rag_step(🔄)

**Given** AbortSignal 在 generate 阶段触发
**When** signal.aborted === true
**Then** 流式生成停止，不再 emit content 事件，不抛出未捕获异常

## SSE 路由

**Given** POST /api/qa/ask { question: '...' }
**When** 请求到达
**Then** Content-Type 为 text/event-stream，响应以 data: {...}\n\n 格式推送事件

**Given** 客户端在流中途断开连接
**When** req 触发 close 事件
**Then** AbortController.abort() 被调用，服务端停止向已关闭 response 写入

## 前端 — 思考气泡状态

**Given** 请求发出，尚未收到任何事件
**When** 气泡渲染
**Then** 展示 data-testid="bubble-thinking" 三点动画

**Given** 收到第一个 rag_step 事件
**When** 气泡更新
**Then** data-testid="bubble-active"，步骤文字可见

**Given** 收到第一个 content 事件
**When** 气泡更新
**Then** data-testid="bubble-streaming"，步骤列表消失，文本内容出现

**Given** 收到 done 事件
**When** 气泡更新
**Then** data-testid="bubble-done"，全文展示，折叠区可用

## 前端 — 终止

**Given** 请求进行中（loading=true）
**When** 渲染输入区
**Then** 显示红色「■ 终止」按钮（data-testid="btn-abort"）

**Given** 用户点击「■ 终止」
**When** 点击事件触发
**Then** abortController.abort() 被调用，loading 变为 false

## 前端 — 引用面板

**Given** 收到 trace 事件（final_results 含 2 条）
**When** 右侧面板更新
**Then** 渲染 2 个 data-testid="citation-item" 元素，各含页面名和摘要
