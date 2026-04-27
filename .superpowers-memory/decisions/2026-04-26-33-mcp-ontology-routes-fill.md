# ADR-33 · 补齐 MCP ontology / qa.retrieve 三条缺失路由

- 日期：2026-04-26
- 状态：**Accepted**
- 工作流：B-精简版（已有 skill yaml 契约 → 直接补 qa-service 路由 → 测试）
- 上游：营销材料 review 时发现 mcp-service skill yaml 声明 8 个工具但 qa-service 端只有 5 条路由对齐

## 背景

`apps/mcp-service/skills/` 下有 8 个 declarative skill yaml，每个 yaml `backend.path` 指向 qa-service 的一条路由。绑定时发现 3 条路由不存在：

| 工具 | yaml 声明的 path | qa-service 实际状态 |
|---|---|---|
| `ontology.query_chunks` | `POST /api/qa/retrieve` | ❌ qa.ts 只有 `/ask` |
| `ontology.path_between` | `POST /api/ontology/path` | ❌ ontology.ts 只有 `/context` |
| `ontology.match_tag` | `POST /api/ontology/match` | ❌ 同上 |

5 条已对齐：`search_knowledge` / `get_page_content` / `ontology.traverse_asset` (用 /context) / `action.execute` / `action.status`。

## 决策

**按 yaml 契约补 qa-service 路由**，不改 yaml（保持 skill 契约前向兼容，避免 mcp-schema.json 漂移）。

### POST /api/qa/retrieve

- 入参：`{ query: string, topK?: number, spaceId?: number }`
- 出参：`{ chunks: [{ asset_id: string, score: number, preview: string }] }`
- 实现：薄壳调 `services/knowledgeSearch.ts:searchKnowledgeChunks`；不跑 rerank/grade/rewrite 完整 RAG 管线
- spaceId 提供时下推为 source_ids 范围（同 ragPipeline 行为）
- preview 取 chunk_content 前 240 字符
- `EmbeddingNotConfiguredError → 503 embedding_not_configured`

### POST /api/ontology/path

- 入参：`{ fromId: string, toId: string, maxDepth?: 1..8 }`
- 出参：`{ paths: [{ nodes: [{id,label,name}], edges: [{from,to,kind}], length: int }] }`
- 实现：**BFS in app**（AGE 的 path agtype 解析不稳，逐跳 Cypher 更可靠）
  - 单跳查 `MATCH (a:Asset {id})-[r:CITED|CO_CITED]-(b:Asset) RETURN b.id, type(r)`
  - 维护 parents map 回溯所有最短路径
  - maxPaths=5 防爆炸
- `KG_ENABLED=0` → 503 ontology_unavailable
- 自环（fromId === toId）返回长度 0 的单节点路径
- 名字从 metadata_asset.name 拉一次（不在 KG 镜像里查，PG 数据更全）

### POST /api/ontology/match

- 入参：`{ text: string, topK?: 1..50 }`
- 出参：`{ tags: [{ id: 'tag:<name>', name: string, score: number }] }`
- 实现 v1：**substring + token Jaccard**
  - 完全相等 → 1.0
  - tag 含 query → 0.85
  - query 含 tag → 0.6 + (tag.len/query.len)*0.25
  - 否则 token Jaccard（中文 / 多分隔符友好的切词正则）
- 数据源：`metadata_asset.tags TEXT[]`（DISTINCT unnest），不查 AGE Tag 镜像
- 0 分过滤；按 score 降序 topK

## 决策记录

- **D1 修补 qa-service 而非改 yaml**：yaml 是对外契约，已发布给 mcp 客户端；改 yaml 等于让所有客户端 mcp-schema.json 漂移。
- **D2 BFS 在应用层而非 Cypher 一把梭**：AGE 1.6 的 `nodes(path)` / `relationships(path)` 返回 agtype 列表，Node 端解析复杂且易碎；逐跳 Cypher 性能足够（5 跳 × 平均 10 邻居 = 50 次查询，~100ms 内可控）。
- **D3 ontology.match v1 不上语义嵌入**：上语义嵌入需要给所有 tag 建 embedding 缓存表（类似 chunk_abstract），是单独 P1。v1 substring 对中文 tag 已经能用，留 follow-up。
- **D4 spaceId 下推失败不阻塞**：`/retrieve` 在 space_source 查询失败时退化到全局检索 + console.warn，不抛 500。
- **D5 路径返回 nodes 含 name 字段**：方便客户端展示，避免再调一次 metadata_asset 查询。失败时 name 留空。

## 测试

新增：
- `apps/qa-service/src/__tests__/qa.retrieve.test.ts` · 7 用例（参数校验、shape、503、spaceId 边界、preview 截断）
- `apps/qa-service/src/__tests__/ontology.routes.test.ts` · 11 用例（path 503/empty/单跳/clamp、match 边界/排序/前缀）

纯函数 10 用例已用 `node:test` 跑通（`scoreTagMatch` × 5、`parseAgString` × 5）。

`tsc --noEmit` 双 0；vitest 在 macOS 上 `pnpm --filter qa-service test` 跑通即可。

## 兼容性

- 老客户端：本 ADR 不动 yaml / mcp-schema.json，旧客户端不变；
- 旧 RAG 链路：未改 ragPipeline.ts；`/api/qa/ask` 行为不变；
- 老 `/api/ontology/context`：未改；
- AGE 不可用：`/path` 503；`/match` 不依赖 AGE 仍可用；
- pgvector 不可用：`/retrieve` 抛 503 embedding_not_configured；`/match` 仍可用（只读 metadata_asset.tags）。

## Follow-up

- [ ] mcp-quickstart.md 已同步标 ✅（本 ADR 内）；
- [ ] match_tag 升级到语义嵌入：建 `tag_embedding` 表，ingest tag 时顺手 embed，本端点改成 ANN（参考 ADR-32 chunk_abstract 思路）；
- [ ] /path 升级支持 HAS_TAG / CONTAINS 边参与路径（当前只走 CITED / CO_CITED）；
- [ ] 实测 5 跳 BFS p95 latency，超过 500ms 改成 Cypher allShortestPaths。

## 文件清单

新增：
- `apps/qa-service/src/__tests__/qa.retrieve.test.ts`
- `apps/qa-service/src/__tests__/ontology.routes.test.ts`

修改：
- `apps/qa-service/src/routes/qa.ts` · 加 `POST /retrieve`
- `apps/qa-service/src/routes/ontology.ts` · 加 `POST /path` + `POST /match` + 内部 helpers
- `docs/integrations/mcp-quickstart.md` · 工具清单从 5/3 → 8 通

## 参考

- 上游 yaml：`apps/mcp-service/skills/ontology/{query_chunks,path_between,match_tag}.skill.yaml`
- 集成指南：`docs/integrations/mcp-quickstart.md`
- 相关 ADR：ADR-3（agent-orchestrator）/ ADR-27（KG sidecar）/ ADR-32（L0 抽象）
