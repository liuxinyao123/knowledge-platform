# Design: OAG · Ontology-Augmented Retrieval

## 模块与调用位置

```
apps/qa-service/src/
  services/
    ontologyContext.ts       ← 本 change 新增
    ragPipeline.ts           ← 本 change 修改（插入 1 处调用）
    graphDb.ts               ← 复用 ADR-27
    knowledgeGraph.ts        ← 复用 ADR-27（可能追加 1-2 个读方法）
  auth/
    evaluateAcl.ts           ← 复用 V2 入口（permissions-v2 change）
  routes/
    ontology.ts              ← 本 change 新增
  index.ts                   ← 挂载 /api/ontology
```

**权限入口澄清**：Permissions V2 的实际入口是 `apps/qa-service/src/auth/evaluateAcl.ts` 的 `evaluateAcl(principal, action, resource)`，返回 `Decision{allow, reason, masks?}`。本 change **不**假设存在 `filterVisibleAssets` 之类的批量便利函数——执行方需要在 `ontologyContext.ts` 内部按 asset_id 列表循环调 `evaluateAcl(principal, 'READ', {asset_id})` 并累积可见列表（见下文 "ACL 过滤实现约定"）。

---

## 数据结构

### OntologyContext（返回给 RAG / Skill 的统一结构）

```ts
export interface OntologyEntity {
  kind: 'Asset' | 'Source' | 'Space' | 'Tag' | 'Question'
  id: string                    // 图节点业务 id（非 AGE 内部 graphid）
  label: string                 // 展示名；Question 的 label = sha1 前 8 位
  attrs?: Record<string, unknown>  // 按 kind 白名单透出
  distance: 0 | 1 | 2           // 距离原始 chunk 的跳数
}

export interface OntologyEdge {
  kind: 'CONTAINS' | 'SCOPES' | 'HAS_TAG' | 'CITED' | 'CO_CITED'
  from: string                  // entity.id
  to: string                    // entity.id
  weight?: number               // 仅 CO_CITED 带
}

export interface OntologyContext {
  entities: OntologyEntity[]
  edges: OntologyEdge[]
  meta: {
    hop_depth: 0 | 1 | 2
    source_chunks: number       // 输入的 chunk 数量
    fallback: boolean           // true 表示走了降级
    latency_ms: number
  }
}
```

### Attribute 白名单（按 kind）

| kind | 允许透出的 attrs |
|------|------------------|
| Asset | `status`, `source_id`, `mime`, `updated_at`, `summary_text` |
| Source | `name`, `kind`, `offline` |
| Space | `name`, `permission_mode` |
| Tag | `name`, `color` |
| Question | `first_seen_at`, `cite_count` |

**敏感字段不透出**：asset 原文路径、source 凭据、用户 principal、JWT、embedding 原始向量。

---

## 核心 API

### `expandOntologyContext(input)`

```ts
export async function expandOntologyContext(input: {
  chunks: Array<{ asset_id: string; score: number }>
  principal: Principal        // 来自 requireAuth()
  maxHop?: 1 | 2              // 默认 2
  timeoutMs?: number          // 默认 200
}): Promise<OntologyContext>
```

行为：

1. **前置 ACL**：从 `chunks` 取 `asset_id` 列表，对每个 id 调 `evaluateAcl(principal, 'READ', {asset_id})`（批量包装见下）；保留 `decision.allow === true` 的子集。过滤后若为空，返回 `{entities:[], edges:[], meta:{fallback:true, ...}}`。
2. **hop=0 自填**：把可见 asset 自身作为 distance=0 的实体。
3. **hop=1 traverse**：Cypher 读 `(a:Asset)-[:CONTAINS|HAS_TAG]-(x)`，拿 Source / Tag 邻居。
4. **hop=2 traverse**（若 `maxHop=2`）：`(a:Asset)-[:CONTAINS]-(:Source)-[:SCOPES]-(:Space)`、`(a:Asset)-[:HAS_TAG]-(:Tag)<-[:HAS_TAG]-(:Asset)`（同标签 Asset，限 10 个）。
5. **二次 ACL**：对结果中新出现的 Asset 节点（hop=2 带出的 `a2` 等）再对每个 id 调一次 `evaluateAcl(principal, 'READ', {asset_id})` 剪枝；已在前置步骤通过的 id 不重复校验。
6. **Latency guard**：超 `timeoutMs` 即 `AbortController.abort()`，返回已有部分结果并 `meta.fallback=true`。
7. **失败兜底**：任一 Cypher 异常 → 返回空 context + WARN 日志 `[ontology] expand failed: ...`。

### ACL 过滤实现约定

- 新增内部辅助函数 `batchEvaluateRead(principal, assetIds)`：`Promise.all` 并发调 `evaluateAcl`，并发上限 16（防 `aclCache` 抖动）。
- 缓存：同一次 `expandOntologyContext` 调用内，新建 `Map<asset_id, boolean>`，避免对 hop=0 和 hop=2 重复判定。
- 不修改 V2 行为、不新增 V2 规则类型；本 change 只**消费**。

### HTTP `POST /api/ontology/context`

**请求**：

```json
{
  "chunks": [{"asset_id": "a1", "score": 0.87}],
  "maxHop": 2
}
```

**鉴权**：`requireAuth`，principal 取自 JWT（与 qa-service 其他接口一致）。

**响应**：`200` + `OntologyContext`；`401` 鉴权失败；`503` AGE 未启用。

**响应头**：`X-Ontology-Fallback: true|false`（便于调用方快速分流）。

---

## ragPipeline.ts 集成点

当前管线（简化）：

```
retrieveInitial → rerank → [INSERT HERE] → gradeDocs → (rewriteQuestion) → generateAnswer
```

新增：

```ts
// 伪代码
const rerankedTopK = await rerank(chunks, question)
const ontology = await expandOntologyContext({
  chunks: rerankedTopK.map(c => ({ asset_id: c.asset_id, score: c.score })),
  principal: ctx.principal,
  maxHop: 2,
  timeoutMs: 200,
})
emitSSE('ontology_context', {
  entities_count: ontology.entities.length,
  edges_count: ontology.edges.length,
  hop_depth: ontology.meta.hop_depth,
  fallback: ontology.meta.fallback,
})
const graded = await gradeDocs(rerankedTopK, question, { ontology })
```

`gradeDocs` 的 prompt 变化：在原有 `<documents>` 段后追加 `<ontology_context>` 段，以 YAML 格式渲染（上限 2KB，防 token 爆炸）。渲染模板由 `gradeDocs` 内部实现，本 change 不固化具体字符串。

**反向兼容**：当 `ontology.entities.length === 0`（即 fallback 或空结果），`gradeDocs` 的 prompt 和老版本**完全一致**。

---

## 图属性扩展

### Asset 新属性

| 属性 | 类型 | 写入时机 | 读取时机 |
|------|------|---------|---------|
| `summary_text` | string ≤ 200字 | ingest 完成后异步补（本 change 不做回填 job，只声明；执行方可选择 lazy 策略） | `expandOntologyContext` 透出 |
| `description_embedding` | vector(1024) | 同上 | 未来 Skill 的 `ontology.match_*` 会用（本 change 不实现匹配） |

### Tag 新属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `semantic_embedding` | vector(1024) | Tag.name + 关联 Asset 摘要拼接后 embed；写入时机同 Asset |

**兼容性**：新属性不存在时，`expandOntologyContext` 仍能工作（attrs 缺失字段即可）；老 ADR-27 的 Cypher 写入路径不变。

### 迁移脚本位置（契约层只声明）

执行阶段新增 `infra/pg_migrations/kg_ontology_attrs.cypher`：

```cypher
-- 不需要 ALTER；AGE 属性是无模式的（schema-less）
-- 只在文档里记录属性名约定，运行时首次写入即生效
```

---

## 可观测性契约

每次 `expandOntologyContext` 调用，结构化日志：

```json
{
  "event": "ontology_expand",
  "principal_id": "u123",
  "source_chunks": 15,
  "hop_depth": 2,
  "entities_count": 34,
  "edges_count": 58,
  "fallback": false,
  "latency_ms": 87
}
```

SSE 事件 `ontology_context` 只暴露给 `knowledge_qa` Agent（其他 Agent 本 change 不接）。前端已有 `rag_step` 处理器，新事件类型对老客户端透明（忽略未知 event）。

---

## 性能预算

- AGE 查询 pool 继续使用 ADR-27 的独立 pool（max=3），不改动；
- 单 QA 只触发一次 `expandOntologyContext`；
- Cypher 查询结果行数硬上限：hop=1 最多 50 行，hop=2 最多 150 行（超额 `LIMIT` 截断）；
- 超时 200ms 触发 fallback，RAG 主路径 latency 影响 ≤ +200ms p95。

---

## 降级矩阵

| 条件 | 行为 |
|------|------|
| `KG_ENABLED=0` 或容器未起 | `runCypher` no-op → context 为空，管线不变 |
| AGE Cypher 异常 | catch + WARN + 空 context |
| `filterVisibleAssets` 返回空集 | 直接空 context，不发 Cypher |
| 超过 `timeoutMs` | Abort + `meta.fallback=true`，返回已累积实体 |
| `maxHop` 参数非法 | clamp 到 [1, 2] |

---

## 测试策略

执行方需在 `apps/qa-service/__tests__/ontologyContext.test.ts` 覆盖：

1. 空 chunks → 空 context
2. AGE 关闭 → 空 context + `fallback=false`（区分"关闭"与"超时"）
3. hop=1 / hop=2 返回行数
4. ACL 剪枝（principal 只能看 a1，结果里不能出现 a2）
5. 超时 fallback（mock 一个慢 `runCypher`）
6. attrs 白名单（敏感字段不应出现）

`services/ragPipeline.test.ts` 新增 1 个 case：`expandOntologyContext` mock 为空时，prompt 不包含 `<ontology_context>` 段。

---

## Phase 2 路线图（本 change 不实施，留档）

### 动机

本 change（Phase 1）做的是 **prompt 侧上下文注入**：chunks 已经召回完，再用图谱把实体/邻居拼进 `gradeDocs` 的 prompt。解决"LLM 看不到实体关系"。

但还存在一个 Phase 1 不覆盖的场景：**召回侧本身漏召回**——有些强相关 chunk 在 vector/BM25 两路里排名都不够高（语义相近但用词跳变、或跨文档的 CITED 邻居），根本进不了 rerank 的 top-K，Phase 1 的 context 注入也就无从谈起。

此时需要把图谱本身作为**和 vector / BM25 并列的第三路召回**。

### 参考来源

Tencent WeKnora（2026-04-24 技术调研）采用"关键词 + 向量 + 知识图谱"三路混合检索，RRF 融合后进 rerank，是这条路线的成熟实现参照。

### Scope（如未来触发 Phase 2，下一步的轮廓）

- **位置**：扩展 `apps/qa-service/src/services/hybridSearch.ts`，当前 `vector + keyword` 两路 RRF 融合升级为**三路**；新增路命名为 `graph-expand`。
- **算法**：对 vector 路 top-N=5 的 chunk，查其所属 Asset 在 AGE 里 `CITED` / `CO_CITED` 距离 ≤ 1 的邻居 Asset，再取这些 Asset 的 chunks（按 `CO_CITED.weight` 降序）作为第三路候选。RRF 时给 graph 路更高 `k`（建议 90，vs vector/keyword 的 60），权重偏低，用途是"查漏补缺"。
- **与 Phase 1 正交**：Phase 2 改 `retrieveInitial` 的召回来源，Phase 1 的 `expandOntologyContext` 仍在 rerank 之后注入 prompt；两者串行叠加，不是二选一。
- **降级**：`KG_ENABLED=0` 或 AGE 异常时，三路退回两路，行为与当前 `hybridSearch.ts` 一致。

### Phase 2 的触发条件（而不是立刻做）

- Phase 1 上线后至少 1 轮 `eval/` 集合跑通，`recall@k` 与 `groundedness` 有量化基线；
- 如果 Phase 1 的 eval 显示**召回率本身**是瓶颈（即便 OAG context 已注入，top-K 里缺关键 chunk），再启 Phase 2；
- 如果 Phase 1 主要提升的是**可解释性 / 多跳问答**，而召回率不是问题，Phase 2 不启动。

### Out of Scope（Phase 2 也不做）

- 把图谱用作**唯一**召回路（取代 vector/BM25）；
- 动态决定每次查询是否启用 graph 路（自适应路由）；
- 跨 Space 图遍历（保持与 V2 ACL 一致）。
