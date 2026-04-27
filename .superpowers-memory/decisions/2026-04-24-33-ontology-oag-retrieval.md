# ADR 2026-04-24-33 — Ontology-Augmented Generation（OAG）· RAG 实体上下文扩展

> 工作流 B · `superpowers-openspec-execution-workflow`。OpenSpec 契约：`openspec/changes/ontology-oag-retrieval/`（本日 D 流程产出 + B 流程实施）。

## 背景

PolarDB-PG Ontology 文章启发：不要只让 LLM 看到零散 chunk，给它看到**实体 + 关系**。平台已有 Apache AGE sidecar（ADR-27）但只服务 DetailGraph 前端可视化，没有回灌到 RAG 管线。

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 新增 `services/ontologyContext.ts`，在 `rerank → gradeDocs` 之间插入一次 `expandOntologyContext` | 最小侵入；空结果时 gradeDocs prompt 与旧版字节一致 |
| D-002 | ACL 过滤复用 Permissions V2 的 `evaluateAcl(principal, 'READ', {asset_id})`，并发上限 16（批量 Promise.all） | 不写 ACR-aware Cypher；V2 入口是 `apps/qa-service/src/auth/evaluateAcl.ts` |
| D-003 | 两次 ACL 剪枝：traverse 前 + hop=2 新出现节点。in-call Map 缓存避免重复 | 命中 asset_id 集合一次算出，永不双跑 |
| D-004 | 新增 HTTP `POST /api/ontology/context`，mount 在 `/api/kg` 之后 | 供未来 Skill 消费；带 `X-Ontology-Fallback` 响应头 |
| D-005 | Cypher query 硬上限：hop1 ≤ 50 行，hop2 ≤ 150 行；超时 200ms 即 Abort | 守住 AGE pool max=3 的 ADR-27 约束 |
| D-006 | SSE 事件 `ontology_context` 附加到 `ragTypes.ts` 的 union type | 前端老客户端忽略未知 event；零破坏 |
| D-007 | Attrs 白名单按 kind 严格过滤（Asset/Source/Space/Tag/Question 各自允许字段） | 防止 `raw_path` / embedding / credential 透出 |
| D-008 | `maxHop` 非法值 clamp 到 [1,2]；AGE 关闭时 `fallback=false`（本就禁用）、超时时 `fallback=true`（运行时失败） | 区分"关闭"与"失败" |

## 代码清单

### 新增
- `apps/qa-service/src/services/ontologyContext.ts` — 核心实现，410 行
- `apps/qa-service/src/routes/ontology.ts` — HTTP 端点
- `apps/qa-service/src/__tests__/ontologyContext.test.ts` — 9 个 Scenario

### 修改
- `apps/qa-service/src/services/ragPipeline.ts` — 插入 OAG 调用 + emit SSE + gradeDocs 接入 ontology 参数
- `apps/qa-service/src/ragTypes.ts` — SSE union 追加 `ontology_context`
- `apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts` — 传递 principal 到 runRagPipeline
- `apps/qa-service/src/__tests__/ragPipeline.test.ts` — 新增 2 个 case（OAG empty / non-empty）
- `apps/qa-service/src/index.ts` — mount `/api/ontology`

## 向后兼容

- `KG_ENABLED=0` / 容器未起 → `isGraphEnabled()` 返 false → 空 context → gradeDocs prompt 与旧版完全一致
- 老的 `services/ragPipeline.test.ts` 断言保持 GREEN
- 新 SSE event 旧前端自动忽略

## 验证

- `npx tsc --noEmit` × 3 包：qa-service / mcp-service / web 全绿
- vitest 本地跑（本日沙箱环境是 Linux，已安装依赖是 darwin-only native，回 user Mac 上跑）
- 端到端：`pnpm dev:up` 后打开 F12 发起问答，应看到 `ontology_context` SSE 事件

## 关联

- 上游：ADR-27 knowledge-graph-age（复用 AGE sidecar / runCypher / cypherLiteral）
- 上游：permissions-v2（复用 `evaluateAcl`）
- 下游：ADR-34 ontology-declarative-skills（`ontology.traverse_asset` 消费本 HTTP 端点）
- 未决（OQ-ONT-2）：是否把 ACL 谓词嵌入 Cypher（ACR-aware traversal）。当前 ROI 不够。
