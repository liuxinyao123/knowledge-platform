# Tasks: Ontology-Augmented Retrieval

> 本 change 采用工作流 D（仅契约）。执行阶段由下游 B 流程承接。

## 执行阶段（契约合并后由执行方勾选）

### 后端 · qa-service

- [x] 新增 `apps/qa-service/src/services/ontologyContext.ts`
  - [x] 导出 `OntologyContext / OntologyEntity / OntologyEdge` 类型
  - [x] 实现 `expandOntologyContext(input)`，含 `AbortController` 超时
  - [x] 实现内部 `batchEvaluateRead(principal, assetIds)`，调 `apps/qa-service/src/auth/evaluateAcl.ts` 的 `evaluateAcl`，并发上限 16
  - [x] 对 `runCypher` 异常 try/catch，fallback 空 context
- [x] 扩展 `apps/qa-service/src/services/knowledgeGraph.ts`
  - [x] 新增 `readAssetNeighborsHop1(assetIds[]): Promise<{entities, edges}>`
  - [x] 新增 `readAssetNeighborsHop2(assetIds[]): Promise<{entities, edges}>`
  - [x] 确保 LIMIT 硬编码（hop1 ≤ 50，hop2 ≤ 150）
- [x] 修改 `apps/qa-service/src/services/ragPipeline.ts`
  - [x] 在 `rerank` 之后调用 `expandOntologyContext`
  - [x] 结果通过 `gradeDocs` 选项传入
  - [x] emit SSE `ontology_context`
- [x] 修改 `apps/qa-service/src/services/gradeDocs.ts`（或等价位置）
  - [x] 新增可选 `options.ontology` 参数
  - [x] 非空时 prompt 追加 `<ontology_context>` YAML 段，≤ 2KB
- [x] 新增路由 `apps/qa-service/src/routes/ontology.ts`
  - [x] `POST /api/ontology/context`，`requireAuth`
- [x] 挂载：`apps/qa-service/src/index.ts` 注册 `/api/ontology` 路由

### 图属性（运行时约定，无 DDL）

- [x] 在 `services/knowledgeGraph.ts` 的 `upsertAsset` 扩展可选字段 `summary_text` / `description_embedding`
- [x] 在 `upsertTag` 扩展可选字段 `semantic_embedding`
- [x] 首次写入采用懒加载策略（本 change 不写回填 job）

### 测试

- [x] 新增 `apps/qa-service/__tests__/ontologyContext.test.ts`
  - [x] 覆盖 8 个 Scenario（见 `specs/ontology-context-spec.md`）
- [x] 修改 `apps/qa-service/__tests__/ragPipeline.test.ts`
  - [x] 新增 case：OAG 有结果 / 无结果 两个分支
- [x] 本地跑 `pnpm --filter qa-service test`，全部 GREEN

### 验证

- [x] `npx tsc --noEmit` 在 qa-service 包通过
- [x] 关闭 AGE (`KG_ENABLED=0`) 跑端到端 QA，无 regression
- [x] 启用 AGE 跑端到端 QA，F12 看到 `ontology_context` SSE 事件
- [x] 记录 p95 latency 对比基线（执行方附数据）

### 归档

- [x] 本 change 归档到 `docs/superpowers/archive/ontology-oag-retrieval/`
- [x] 新增 ADR `.superpowers-memory/decisions/<date>-<seq>-ontology-oag.md`
