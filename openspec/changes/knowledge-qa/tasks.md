# Tasks: 知识问答（Agentic RAG · pgvector）

## 后端（apps/qa-service）

### 类型与接口
- [x] BE-1: 更新 `src/ragTypes.ts` — 用新的 `Citation / RagTrace / SseEvent / HistoryMessage` 定义替换旧字段（`page_*` → `asset_*`）
- [x] BE-2: `src/routes/qa.ts` — 入参校验 `question / session_id? / history?`，非法字段返 400；向 `runRagPipeline` 透传 `history`

### 检索层
- [x] BE-3: 从 `routes/knowledgeDocs.ts` 中抽出 service `searchKnowledgeChunks({ query, top_k })` 到 `services/knowledgeSearch.ts`（routes 调 service，避免双入口）
- [x] BE-4: `services/ragPipeline.ts` — `retrieveInitial` 改用 `searchKnowledgeChunks`，`top_k=10`，过滤 `score > 0.5`；下线 BookStack fallback
- [x] BE-5: `services/ragPipeline.ts` — `gradeDocs` 保留 function-call，新增保底 Top2；function-call 解析失败时视为 `relevant=true`

### 重写与生成
- [x] BE-6: `services/ragPipeline.ts` — `rewriteQuestion` 触发条件 `gradedDocs.length < 3` 明确化；合并按 `asset_id` 去重
- [x] BE-7: `services/ragPipeline.ts` — `generateAnswer` 入参加 `history: HistoryMessage[]`；末尾截断 40 条；context 用 `asset_name / chunk_content`
- [x] BE-8: `services/ragPipeline.ts` — `runRagPipeline` 发出 `trace` 事件使用新字段；`citations` 按 `{index,asset_id,asset_name,chunk_content,score}`

### 错误与日志
- [x] BE-9: `routes/qa.ts` — Pipeline 异常转 `{type:'error', message}` + `done`；打点 session_id 用于日志对齐

## 前端（apps/web）

### QA 组件
- [x] FE-2: `src/knowledge/QA/index.tsx` — 入参加 `session_id`（localStorage `kc_qa_session_id`）；初次挂载自动生成 uuid
- [x] FE-3: `src/knowledge/QA/index.tsx` — 发送时传 `history`（默认保留最近 10 轮 = 20 条）
- [x] FE-4: `src/knowledge/QA/index.tsx` — `trace` 事件消费使用新字段 `initial_count / kept_count / rewrite_triggered / citations[].asset_*`
- [x] FE-5: `src/knowledge/QA/index.tsx` — 右侧引用面板改为 `asset_name + chunk_content 前 100 字 + score 百分比`；保留 `[n]` 上标点击高亮
- [x] FE-6: 气泡三状态切换与终止按钮行为沿用现有实现，仅 adapt 新 trace 字段

### API 客户端（可选封装，本轮未拆出独立文件，留待后续 refactor）
- [ ] FE-1: 新增 `src/api/qa.ts` — `ask({ question, session_id, history, signal })` 返回 `ReadableStream` 的 reader；封装 SSE 事件解析

## 契约资产

- [x] CT-1: 更新 `.superpowers-memory/integrations.md` — 标注 `/api/qa/ask` 为 pgvector 消费方；更新 `/api/knowledge/search` 为 RAG 源头
- [x] CT-2: `.superpowers-memory/decisions/2026-04-21-01-rag-source-of-truth.md` — 落 D-001；引用 Q-002

## 测试（TDD 先行）

### qa-service
- [x] TE-1: `__tests__/ragPipeline.test.ts` — 阈值过滤、空命中、保底 Top2、function-call 解析兜底、abort、新 trace 字段（合并原分散文件）
- [ ] TE-2: 单独拆 `__tests__/ragPipeline.gradeDocs.test.ts`（可选，已合并入 TE-1）
- [ ] TE-3: 单独拆 `__tests__/ragPipeline.rewrite.test.ts`（可选，已合并入 TE-1）
- [ ] TE-4: 单独拆 `__tests__/ragPipeline.generateAnswer.test.ts`（可选，已合并入 TE-1）
- [ ] TE-5: `__tests__/qaRoute.test.ts` — 请求校验 / SSE 完整事件序列 / 错误路径（本轮未加，Round 3 集成测试时补）

### web
- [x] TE-6: `src/knowledge/QA/index.test.tsx` — 三状态切换、trace 新字段渲染、终止按钮、session_id 持久化、history 传参

## 验证（需在 Verify 阶段提供证据）

- [ ] VR-1: `pnpm -r test` 全绿，贴日志或截图
- [ ] VR-2: `pnpm -r build`（或 `tsc --noEmit`）无 TS 报错（本轮 QA 相关文件已过检）
- [ ] VR-3: 端到端走查 — 在本地发一个问题，观察 SSE 事件顺序、终止、引用面板、history 累计
- [ ] VR-4: 归档：将 `docs/superpowers/specs/knowledge-qa/` → `docs/superpowers/archive/knowledge-qa/`，并把本 tasks.md 勾完
