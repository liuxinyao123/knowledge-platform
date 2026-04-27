# Tasks: Agent 编排层

## 前置依赖
- [x] `openspec/changes/unified-auth/` 已 Lock（Round 2 完成）
- [x] `openspec/changes/knowledge-qa/` 已 Lock（Round 1 完成）

## 骨架与类型
- [x] BE-1: `src/agent/types.ts` — `AgentIntent / AgentContext / Agent / IntentVerdict / DispatchPlan`
- [x] BE-2: `src/ragTypes.ts` 扩展 `SseEvent` — 新增 `{ type: 'agent_selected', data }` 变体

## 意图识别
- [x] BE-3: `src/agent/intentClassifier.ts` — LLM tool-call 实现（chatComplete + getLlmFastModel）
- [x] BE-4: `src/agent/intentFallback.ts` — 关键字规则表（metadata_ops / data_admin / structured_query）+ 默认 knowledge_qa
- [x] BE-5: `src/agent/classify.ts` — LLM 阈值 + fallback；`AGENT_INTENT_THRESHOLD` 默认 0.6

## Agent 实现
- [x] BE-6: `src/agent/agents/KnowledgeQaAgent.ts` — 包装 `runRagPipeline(history)`
- [x] BE-7: `src/agent/agents/DataAdminAgent.ts` — 包装 `runDataAdminPipeline`
- [x] BE-8: `src/agent/agents/StructuredQueryAgent.ts` — 占位，emit `not_implemented`
- [x] BE-9: `src/agent/agents/MetadataOpsAgent.ts` — 读操作（list_sources / list_assets / list_acl_rules）；写操作占位

## 编排
- [x] BE-10: `src/agent/registry.ts` — 静态注册四 Agent；`__setAgentForTest` 测试辅助
- [x] BE-11: `src/agent/plan.ts` — 单步 DispatchPlan（扩展点留给后续）
- [x] BE-12: `src/agent/fuse.ts` — passthrough
- [x] BE-13: `src/agent/dispatchHandler.ts` — 请求校验 → classify → emit agent_selected → agent.run → SSE；trace citations 走 shapeResultByAcl

## 路由接入
- [x] BE-14: `src/routes/agent.ts` — `POST /dispatch` 挂 `requireAuth + enforceAcl`
- [x] BE-15: `src/index.ts` 挂载 `/api/agent`
- [x] BE-16: `src/routes/qa.ts` 重构 `/ask` 为 `hint_intent=knowledge_qa` 的薄壳；完全复用 dispatchHandler

## 可观测
- [x] BE-17: dispatch 完成时打印结构化日志 `{user_id, intent, fallback, session_id, duration_ms}`

## 契约资产
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-03-agent-orchestrator-contract.md` 已产出
- [x] CT-2: `.superpowers-memory/integrations.md` 追加 "Agent 编排层"
- [x] CT-3: `openspec/changes/knowledge-qa/design.md` 引用 agent_selected 存在性（通过 ragTypes 类型注释完成）

## 测试（TDD）
- [x] TE-1: `__tests__/agent.classify.test.ts` — LLM ≥ 阈值 / 低置信 / null / 自定义阈值
- [x] TE-2: `__tests__/agent.intentFallback.test.ts` — 四类关键字 + 默认兜底
- [x] TE-3: `__tests__/agent.dispatchHandler.test.ts` — happy path / hint_intent 跳过 classifier / 请求校验 400
- [ ] TE-4: `__tests__/agent.dispatchHandler.test.ts` 中已覆盖事件序列；未单独拆 abort 测试（可后续补）
- [ ] TE-5: `__tests__/agent.knowledgeQa.test.ts` — 留给后续回归（当前 dispatchHandler stub 已覆盖"agent 事件流与 done 终止"核心契约）
- [ ] TE-6: `__tests__/agent.metadataOps.test.ts` — 同上，优先级较低（ADMIN 拦截由 unified-auth 测试覆盖）
- [ ] TE-7: `__tests__/qaRoute.compat.test.ts` — 现有 /api/qa/ask 已变为 dispatchHandler 壳，兼容性由 dispatchHandler 测试间接覆盖

## 验证
- [ ] VR-1: `pnpm -r test` 全绿（本机验）
- [x] VR-2: `tsc --noEmit` 零新增报错（仅残留 pre-existing pdf-parse）
- [ ] VR-3: 端到端：四类 question 各打一次 `/api/agent/dispatch`，验证 agent_selected + 事件流
- [ ] VR-4: 归档 `docs/superpowers/specs/agent-orchestrator/` → `docs/superpowers/archive/agent-orchestrator/`
