# Spec: Ontology Context 扩展

## expandOntologyContext

**Scenario: 空 chunks 直接返回空 context**
- Given `chunks = []`
- When 调用 `expandOntologyContext({chunks, principal, maxHop:2})`
- Then 响应 `{entities:[], edges:[], meta:{hop_depth:2, source_chunks:0, fallback:false, latency_ms:<X>}}`
- And 不会触发任何 Cypher 查询

**Scenario: AGE 未启用（KG_ENABLED=0）返回空并标记 fallback=false**
- Given `isGraphEnabled() === false`
- When 调用 `expandOntologyContext({chunks:[{asset_id:"a1",score:0.9}], ...})`
- Then 响应 `entities:[]`、`edges:[]`、`meta.fallback === false`
- And **fallback=false**（此情况视为"本就禁用"而非"运行时失败"）

**Scenario: Principal 过滤掉所有可见 asset**
- Given `evaluateAcl(principal, "READ", {asset_id:"a1"}) → {allow:false}` 且 `evaluateAcl(principal, "READ", {asset_id:"a2"}) → {allow:false}`
- When 调用 `expandOntologyContext({chunks:[{asset_id:"a1"},{asset_id:"a2"}], principal, maxHop:1})`
- Then 响应 `entities:[]`、`edges:[]`、`meta.fallback === true`

**Scenario: hop=1 返回 Asset 自身 + Source + Tag 邻居**
- Given 图中存在 `(a1:Asset)-[:CONTAINS]-(s1:Source)` 和 `(a1:Asset)-[:HAS_TAG]-(t1:Tag)`
- And principal 能看见 a1
- When 调用 `expandOntologyContext({chunks:[{asset_id:"a1",score:0.9}], principal, maxHop:1})`
- Then `entities` 包含 `{kind:"Asset", id:"a1", distance:0}`、`{kind:"Source", id:"s1", distance:1}`、`{kind:"Tag", id:"t1", distance:1}`
- And `edges` 包含 `CONTAINS(a1→s1)`、`HAS_TAG(a1→t1)`

**Scenario: hop=2 追加 Space 与同标签 Asset**
- Given hop=1 结果基础上，`(s1)-[:SCOPES]-(sp1:Space)` 和 `(t1)<-[:HAS_TAG]-(a2:Asset)`
- And principal 能看见 a1、sp1、a2
- When `maxHop:2`
- Then `entities` 额外包含 `{kind:"Space", id:"sp1", distance:2}`、`{kind:"Asset", id:"a2", distance:2}`
- And `meta.hop_depth === 2`

**Scenario: 二次 ACL 剪枝（hop=2 结果里的 Asset 不可见）**
- Given hop=2 traverse 返回 a3 作为同标签 Asset
- And `evaluateAcl(principal, "READ", {asset_id:"a3"}) → {allow:false}`
- When 执行二次过滤
- Then 响应 `entities` 不包含 a3
- And 相关 edges 也被剪掉

**Scenario: 超时触发 fallback**
- Given Cypher 查询耗时 > `timeoutMs:50`
- When 调用 `expandOntologyContext({..., timeoutMs:50})`
- Then 响应 `meta.fallback === true`
- And `entities` 为已累积的部分结果（可能非空）
- And 日志 emit `event:"ontology_expand"`, `fallback:true`

**Scenario: Attrs 白名单**
- Given 图中 `Asset{id:"a1", summary_text:"xxx", raw_path:"/secret/file.pdf"}`
- When 调用 `expandOntologyContext`
- Then 结果里 `entities[0].attrs` 只包含 `status/source_id/mime/updated_at/summary_text`
- And `raw_path` **不在**响应中

**Scenario: maxHop 非法值 clamp**
- When 调用 `expandOntologyContext({..., maxHop: 5 as any})`
- Then 实际执行按 `maxHop=2`
- When 调用 `expandOntologyContext({..., maxHop: 0 as any})`
- Then 实际执行按 `maxHop=1`

---

## POST /api/ontology/context

**Scenario: 已鉴权请求返回 200 + context**
- Given 用户持有合法 JWT，AGE 启用
- When `POST /api/ontology/context` body `{chunks:[{asset_id:"a1"}], maxHop:1}`
- Then 响应 200，body 为 OntologyContext 结构
- And 响应头 `X-Ontology-Fallback: false`

**Scenario: 未鉴权请求拒绝**
- Given 无 JWT
- When `POST /api/ontology/context`
- Then 响应 401

**Scenario: AGE 未启用**
- Given `KG_ENABLED=0`
- When `POST /api/ontology/context`
- Then 响应 503，body `{error:"ontology_unavailable"}`

---

## ragPipeline 集成

**Scenario: OAG 有结果时 gradeDocs prompt 含 ontology_context**
- Given `expandOntologyContext` 返回 `entities.length === 5`
- When `ragPipeline.run()` 进入 `gradeDocs`
- Then `gradeDocs` 收到的 input 包含 `ontology` 字段
- And LLM 调用的 prompt 文本包含 `<ontology_context>` 段

**Scenario: OAG 为空时 gradeDocs prompt 回退到老版本**
- Given `expandOntologyContext` 返回 `entities:[]`
- When `ragPipeline.run()` 进入 `gradeDocs`
- Then LLM 调用的 prompt **不包含** `<ontology_context>` 段
- And 现有所有 `ragPipeline.test.ts` 断言通过

**Scenario: SSE emit ontology_context 事件**
- Given 用户 `POST /api/agent/dispatch` 触发 knowledge_qa
- When OAG 扩展完成
- Then SSE 流包含 `event: ontology_context`，data 字段 `{entities_count, edges_count, hop_depth, fallback}`
- And 该事件在 `rag_step: rerank_done` 之后、`rag_step: grade_done` 之前
