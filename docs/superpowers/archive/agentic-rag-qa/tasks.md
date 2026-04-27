# Tasks: Agentic RAG QA

## 后端

- [x] BE-1: 更新 services/bookstack.ts — searchPages count=15, top8, getPageContent html→text
- [x] BE-2: 新建 services/ragPipeline.ts — Step1 retrieveInitial
- [x] BE-3: ragPipeline — Step2 gradeDocs（haiku structured output，保底 top2）
- [x] BE-4: ragPipeline — Step3/4 rewriteQuestion + retrieveExpanded（条件触发）
- [x] BE-5: ragPipeline — Step5 generateAnswer（sonnet stream + AbortSignal）
- [x] BE-6: 更新 routes/qa.ts — SSE 路由，替换 JSON 响应

## 前端

- [x] FE-1: QA/index.tsx — SSE 消费器（fetch ReadableStream 解析 data: 事件）
- [x] FE-2: 思考气泡状态机（thinking / active / streaming / done / error）
- [x] FE-3: 终止按钮（AbortController，红色 btn-abort）
- [x] FE-4: 引用面板更新（trace 事件驱动，citation-item）
- [x] FE-5: RAG 折叠区（气泡底部 details 展开）

## 测试

- [x] TE-1: ragPipeline gradeDocs 保底逻辑测试
- [x] TE-2: ragPipeline rewriteNeeded 条件测试（< 3 触发，>= 3 不触发）
- [x] TE-3: runRagPipeline AbortSignal 停止测试
- [x] TE-4: SSE 路由事件格式测试
- [x] TE-5: 前端气泡状态转换测试（rag_step / content / done）
- [x] TE-6: 前端终止按钮测试
- [x] TE-7: 前端引用面板 trace 渲染测试
