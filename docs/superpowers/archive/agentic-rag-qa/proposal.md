# Proposal: 知识问答——Agentic RAG（BookStack + SSE）

## Problem

当前 `/api/qa/ask` 是一次性 JSON 响应：搜索 → LLM → 返回。
- 无相关性过滤：噪音文档直接进入 context，回答质量差
- 无流式：用户等待全部生成完才看到回答
- 无可观测性：用户不知道 RAG 在做什么
- 无终止：用户无法中断长回答

## Proposed Change

参考 SuperMew Agentic RAG 架构，用 TypeScript 实现 5 步 Pipeline，通过 SSE 推送每个阶段进度和流式 token：

1. **retrieve_initial** — BookStack Search API，取 Top8 页面，并发拉全文
2. **grade_documents** — claude-haiku-4-5 打分，过滤低相关文档（保底 Top2）
3. **rewrite_question** — 相关文档 < 3 时触发，claude-sonnet-4-6 选 step_back / hyde 策略重写查询
4. **retrieve_expanded** — 重写后二次检索，与初次结果合并去重
5. **generate_answer** — claude-sonnet-4-6 流式生成，[1][2] 引用标注

SSE 事件协议：`rag_step` / `content` / `trace` / `error` / `done`

前端升级：单气泡思考状态机（thinking → active RAG → streaming），红色终止按钮，引用面板。

## 决策记录

- grade 模型：claude-haiku-4-5（快速打分）
- session 记忆：不实现（单轮独立）
- 流式：直接 SSE（不做非流式中间版本）
- 终止：实现（AbortController + req.on('close')）
