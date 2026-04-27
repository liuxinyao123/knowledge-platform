# ADR 2026-04-23-27 — Knowledge Graph · Apache AGE sidecar

> 工作流 C · superpowers-feature（无 OpenSpec）。Sidecar 隔离 + fire-and-forget 写入，可整体下架。

## 背景

- `DetailGraph.tsx` 一直是 SVG mock（"Q3=c 决策推迟"）；真实的知识图谱存储层缺位。
- 用户诉求："我要 Apache AGE，要和我的查询结果的内容都能够管理起来，知识图谱就要有知识图谱的作用。"
- 约束："项目不能太大"——不能重度改造基建。

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | **Sidecar PG 实例**跑 Apache AGE；不碰主 `pg_db`（pgvector） | 隔离，下架只要 `docker compose rm kg_db`；主库零风险 |
| D-002 | 官方镜像 `apache/age:release_PG16_1.6.0`（与主库 PG16 版本对齐） | 单镜像开箱含 AGE 扩展；tag 格式 `release_PG<pg>_<age>` |
| D-003 | Feature flag `KG_ENABLED` 默认 on；任何连接/bootstrap 失败自动 `_disabled=true`，后续写入全部 no-op | 主路径零耦合 |
| D-004 | 写入一律 **fire-and-forget**（`void (async ...)()` 或直接 promise 不 await） | 主 RAG / ingest / spaces 路径不受 KG 影响 |
| D-005 | **图谱 schema（最小闭环）**：<br/>节点 `:Asset / :Source / :Space / :Tag / :Question`<br/>边 `:CONTAINS / :SCOPES / :HAS_TAG / :CITED / :CO_CITED` | 业务增量可扩展，先闭环 "查询结果入图谱" |
| D-006 | Question 节点以**文本 sha1(32) 为 key**，不存原文 | 体积、隐私 |
| D-007 | Citation 取 top-5（按 score 降序）；CO_CITED 只在 top-5 内两两写 weight++ | 噪声控制 |
| D-008 | AGE 无参数绑定 → 封 `cypherLiteral(v)` 手工转 JSON 字面量；业务层只传 id / hash / 白名单枚举 / 受控字符串 | 防注入 |
| D-009 | Cypher 执行走独立 pool（max=3，connectionTimeoutMillis=1500）；查询前 `LOAD 'age'; SET search_path` | 不污染主连接池 |
| D-009a | **Graph name 默认 `knowledge`（≥ 3 字符）**——AGE 的 `create_graph` 对 1-2 字符名有未文档化下限（[mail-archive](https://www.mail-archive.com/dev@age.apache.org/msg07882.html)） | 避免 "graph name is invalid" 错误 |
| D-010 | 只读 Cypher 端点 `POST /api/kg/cypher` 默认关（`KG_CYPHER_ENDPOINT=1` 才启用），admin only，写操作正则拦截 | 安全口子留但默认关 |
| D-011 | DetailGraph 渲染**不引 sigma / cytoscape**；继续用现有 SVG + 环形布局；节点半径按 degree 自适应 | 守住 "项目不能太大" |
| D-012 | 真实数据为空时自动**回退 mock**（`kg.nodes.length <= 1`），横幅文案区分显示 | 新装部署不空窗 |

## 代码清单

### infra
- `infra/docker-compose.yml`：新增 `kg_db` service（`apache/age:PG16_latest`，端口 5433→5432，挂 `kg_data/` volume）；qa_service 新 env `KG_HOST/PORT/DB/USER/PASS/GRAPH/ENABLED`

### 后端（`apps/qa-service/src/`）
- `services/graphDb.ts`：pool + `runCypher(query, params, columnSpec)` + `bootstrapGraph()` + `isGraphEnabled()`；`cypherLiteral()` 注入安全处理
- `services/knowledgeGraph.ts`：业务语义封装
  - `upsertAsset / upsertSource / upsertSpace / setAssetTags`
  - `linkSourceAsset / linkSpaceSource`
  - `recordCitations(question, citations[])` —— 写 Question + CITED + CO_CITED（top-5 两两）
  - `getAssetNeighborhood(assetId)` —— 1 跳邻域，返给 DetailGraph
- `routes/kg.ts`：`GET /status`、`GET /assets/:id/neighbors`、`POST /cypher`（默认关）
- `index.ts`：启动调 `bootstrapGraph()`（失败只 warn）；挂 `/api/kg`
- 钩子：
  - `services/ingestPipeline/pipeline.ts` 审计日志之后 → upsert asset/source + tags
  - `routes/spaces.ts` 创建空间 + 关联源 → upsert space + linkSpaceSource
  - `services/ragPipeline.ts` 在第二处 `emit trace` 后 → `recordCitations`

### 前端（`apps/web/src/`）
- `api/kg.ts`：`getKgStatus()`, `getAssetNeighbors(id)`
- `vite.config.ts`：`/api/kg` 代理到 3001
- `knowledge/Assets/DetailGraph.tsx`：useEffect 拉 `/api/kg/assets/:id/neighbors`；有数据渲染真实图，无数据回退 `detail.graph` mock；节点半径按 degree 自适应；新增标签 / 数据源 / 空间 / CO_CITED 边样式

## 向后兼容

- KG 容器未起 / flag off / 连接失败 → 所有写入路径静默，读 API 返 `{nodes:[],edges:[]}`，DetailGraph 回退 mock；**主业务零感知**。
- 已有 asset 数据不自动 backfill；KG 随今后 ingest / QA / space 操作增量积累。如需回填，后续加一次性 job（本 ADR 不做）。
- `pg_db`（pgvector）零改动；已有所有 SQL / 测试不受影响。

## 验证

- `npx tsc --noEmit` × 3 包：qa-service / web / mcp-service 全部通过
- `pnpm -r test`：新增 0 case，交用户本机跑无 regression
- 运行时自检：服务启动后 `[graphDb] ✓ Apache AGE graph ready: kg` 或 `bootstrap failed: ... ；后续写入 no-op`

## 起服务步骤（给用户）

```bash
cd infra
docker compose pull kg_db
docker compose up -d kg_db
docker compose restart qa_service
# 看启动日志：
# ✓ Apache AGE graph ready: kg
```

如果用户不想用 KG：`KG_ENABLED=0 docker compose up -d qa_service`，整条链路 no-op。

## 关联

- 上游 ADR：-25 file-source-integration / -26 space-permissions（KG 里 Space 节点复用 26 的 id）
- 未决后续：
  - CO_CITED 衰减 / 清理 cron（老 Question 节点）
  - `/graph` 页面 explorer（Cypher playground）
  - MCP `graph_cypher` 工具接真 AGE
  - 从文档抽 Entity/Relation 三元组（LLM triple extraction）
