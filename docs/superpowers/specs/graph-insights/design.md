# graph-insights · Explore 阶段设计草稿

> **工作流 B · Step 1 · Superpowers Explore**
> 本文件为 Explore 阶段产物，**不进主分支**。Lock 阶段会被 `openspec/changes/graph-insights/design.md` 替代。
> 作者：2026-04-24 会话；引用 llm_wiki（GPL-3）README 概念，**不引入其源代码**，全部从概念级重新实现。

## 0. 背景 · 为什么做这个

llm_wiki（Tencent 社区外项目，GPL-3）在其"图谱洞察"模块里把知识图谱从**展示物**变成了**摄入驱动源**：通过全图拓扑分析自动发现"孤立页面 / 桥接节点 / 跨社区边 / 稀疏社区"，并为每一条洞察提供"一键 Deep Research"把弱连接补齐。

本项目 ADR-27（AGE KG）+ ADR-33（OAG Phase 1）已经把"写入图谱 + 邻域扩展 prompt 注入"跑通，但**还没有全图统计指标**。OAG Phase 2 在 ADR-39 里因 recall@5=1.000 而搁置——graph-insights 是**正交于 Phase 2 的第三条路线**（不改检索，改主动发现），无语义重复。

**明确的非目标**：不抄 llm_wiki 任何源码、不使用 Tauri 桌面壳、不替换 pgvector / AGE 的真相源角色。

## 1. Problem

1. **孤立资产不可见**：引入 BookStack 附件后（ADR-31）会出现"一页 PDF 无任何 CO_CITED 连接、无 tag"——在 DetailGraph 里这种资产看不到邻域，用户无法感知它的存在。
2. **桥接知识不可见**：某些资产横跨多个主题（CO_CITED 到多个不同 tag 集合），它们是知识网络的关键枢纽，但当前只能靠人工巡逻发现。
3. **稀疏社区不可见**：某个主题下若只有 3 页资产、彼此 CO_CITED 薄弱，说明该主题摄入不足；当前无任何信号提示"这里需要更多资料"。
4. **惊奇连接不可见**：跨社区的 CO_CITED 边往往是知识的跨界联结（论文↔行业报告、代码↔理论），但缺少凸显机制。

## 2. Goals / Non-Goals

### Goals（MVP）
- G1. 四类洞察全部上线：孤立页面 / 桥接节点 / 惊奇连接 / 稀疏社区
- G2. 按需计算 + 结果缓存 + TTL 失效（用户侧无感知的算力成本）
- G3. 每条洞察卡片可点击"Deep Research"，复用现有 `runRagPipeline`，不新建 Agent intent
- G4. 多 Space 下每个 Space 独立计算，通过 permissions-v2 做 ACL 过滤
- G5. Louvain 跑在 Node.js 侧（graphology-communities-louvain），不引入 Postgres 扩展

### Non-Goals
- NG1. 不做"历史洞察趋势"（v1 只快照当前，不存时间序列）
- NG2. 不做"自动消除"（用户标记已看后本次会话隐藏即可，不持久化 dismissed 状态到 v1）
- NG3. 不做跨 Space 的全局洞察（v1 严格按 Space 分片，避免 ACL 泄露）
- NG4. 不改 AGE schema（不加新节点/边类型）——洞察是计算产物
- NG5. 不做主动推送/通知（v1 用户进入页面才看到）

## 3. 上游 OpenSpec 依赖（工作流 B 硬条件）

| 依赖 | 状态 | 取自 | 关系 |
|---|---|---|---|
| AGE KG schema（5 节点 + 5 边类型） | ADR-27 已锁 | `apps/qa-service/src/services/knowledgeGraph.ts` L7-18 | 读 `:Asset` + `CO_CITED` + `HAS_TAG` |
| Agent orchestrator 契约 | `openspec/changes/agent-orchestrator/`（已交付） | `agent/dispatchHandler.ts` | Deep Research 复用 `knowledge_qa` intent |
| Knowledge QA / RAG pipeline | `openspec/changes/knowledge-qa/`（已交付） | `ragPipeline.ts:509 runRagPipeline` | Deep Research 调用入口，`opts.assetIds/spaceId` 已支持 |
| Permissions V2 · ACL | `openspec/changes/permissions-v2/`（已交付） | `auth/evaluateAcl.ts` | 洞察结果按 Space 过滤 |
| OAG Phase 1（可选） | Archived | `ontologyContext.expandOntologyContext` | 可选作为 Deep Research 的上下文增强 |
| ingest-async-pipeline | Archived | `jobRegistry.ts` / `ingestWorker.ts` | 不直接依赖；缓存失效通过 `metadata_asset.indexed_at` 轮询 |

**没有上游缺失。可以开工。**

## 4. 四类洞察 · 算法定义

### 4.1 孤立页面（Isolated Pages）
**定义**：Asset 节点的 `degree(CO_CITED ∪ HAS_TAG) ≤ 1`，且 `indexed_at` 距今超过 T_iso（建议 7 天，避免刚 ingest 的新资产被误判）。

**Cypher**：
```cypher
MATCH (a:Asset)
OPTIONAL MATCH (a)-[r:CO_CITED|HAS_TAG]-()
WITH a, count(r) AS deg
WHERE deg <= 1
RETURN a.id, a.name, a.type, deg
```

**复杂度**：O(|V| + |E|)；万级节点直接在 AGE 跑。

### 4.2 桥接节点（Bridge Nodes）
**定义**：满足两条之一：
- (a) 连接到 ≥ 3 个不同的 Louvain 社区的 Asset 节点；或
- (b) Louvain 未启用时回退到：连接到 ≥ 3 个不同 `HAS_TAG` tag 集群的 Asset 节点。

**算法**：Louvain → 每个节点记 `community_id` → 对每个节点统计其邻居 `community_id` 的 distinct count → distinct ≥ 3 即为桥接。

**复杂度**：Louvain O(|V|·log|V|)；桥接判定 O(|E|)。

### 4.3 惊奇连接（Surprising Connections）
**定义**：CO_CITED 边的两个端点属于**不同的 Louvain 社区**；按**复合惊奇度**排序：
```
surprise(e) = w_cross * is_cross_community(e) 
            + w_type  * is_cross_type(e)
            + w_weight * log(1 + edge.weight)
```
建议初始权重：`w_cross=3.0, w_type=1.5, w_weight=1.0`（与 llm_wiki 的四信号模型同家族但**数值我自定**，避免 GPL 化权重常量）。

**取 top-N**：默认 N=10，可配置。

### 4.4 稀疏社区（Sparse Communities）
**定义**：对每个 Louvain 社区 C，内聚度：
```
cohesion(C) = |edges_in_C| / C(|C|, 2)
```
当 `|C| ≥ 3 且 cohesion(C) < 0.15`，标为稀疏。

**交付物**：社区内的 top-3 核心节点（按 degree 排序）+ 内聚度分数。

## 5. 架构草图

```
┌─────────────────────────────────────────────────────────────┐
│                    apps/web (React)                         │
│                                                             │
│   /knowledge/insights (新路由)                              │
│     ├─ InsightOverview     (四类卡片 grid)                  │
│     ├─ InsightDetailPanel  (展开单条洞察)                   │
│     └─ DeepResearchButton  (调用 /api/agent/dispatch)       │
│                                                             │
│     apps/web/src/api/insights.ts                            │
│       getInsights(spaceId?) → { isolated, bridges,          │
│                                 surprises, sparse }         │
└─────────────────────────────────────────────────────────────┘
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              apps/qa-service (Node)                         │
│                                                             │
│   routes/insights.ts                                        │
│     GET /api/insights?spaceId=N                             │
│       → requireAuth + enforceAcl                            │
│       → services/graphInsights.getCachedOrCompute(spaceId)  │
│                                                             │
│   services/graphInsights/                                   │
│     ├─ loader.ts          # 从 AGE 拉子图到 graphology       │
│     ├─ louvain.ts         # graphology-communities-louvain  │
│     ├─ isolated.ts        # 孤立页面                         │
│     ├─ bridges.ts         # 桥接节点                         │
│     ├─ surprises.ts       # 惊奇连接                         │
│     ├─ sparse.ts          # 稀疏社区                         │
│     └─ cache.ts           # TTL + invalidation              │
│                                                             │
│   DB: metadata_graph_insight_cache (新表)                   │
│     (space_id PK, computed_at, ttl_sec, payload JSONB)      │
└─────────────────────────────────────────────────────────────┘
                            │ openCypher
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          AGE sidecar Postgres (ADR-27，不改)                │
│          :Asset / :Tag / CO_CITED / HAS_TAG                 │
└─────────────────────────────────────────────────────────────┘
```

## 6. 缓存策略

**表**：`metadata_graph_insight_cache`
```sql
CREATE TABLE metadata_graph_insight_cache (
  space_id INT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_sec INT NOT NULL DEFAULT 1800,      -- 30 分钟
  graph_signature TEXT NOT NULL,          -- e.g. "assets=312,edges=1247,max_indexed=2026-04-24T..."
  payload JSONB NOT NULL,                 -- {isolated:[...], bridges:[...], surprises:[...], sparse:[...]}
  PRIMARY KEY (space_id)
);
```

**失效策略**（按优先级）：
1. **TTL 到期**：`now() - computed_at > ttl_sec` → 重算
2. **签名不匹配**：请求时读 `(count(Asset), count(CO_CITED), max(indexed_at))`，与缓存的 `graph_signature` 比较，不一致即重算
3. **手动刷新按钮**：前端 `POST /api/insights/refresh?spaceId=N`（`require role=Admin`）

**重算开销预估**（参考：一个 Space ~500 资产 ~2000 边）：
- AGE 拉子图：~200ms
- Louvain：graphology on Node.js，~50-300ms
- 四项统计：<100ms
- **总：< 1s**，用户首次点击可接受；命中缓存 <20ms。

## 7. ACL 与多 Space

- **每个 Space 独立计算**：`GET /api/insights?spaceId=N` 必须走 `enforceAcl` 验证 caller 有该 Space 的 Viewer 权限。
- **"无 spaceId" 查询**：仅 role=Admin 可用，返回所有 Space 汇总（v1 不做，写 403）。
- **Payload 内的 assetId 列表**：前端再次展示时必须走 `/api/assets/:id` 标准路由，让后端二次 ACL（纵深防御，防缓存泄露）。

## 8. Deep Research 复用方案

按用户决定：**不新建 Agent skill**，复用 `runRagPipeline`。

前端流：
```
用户点"Deep Research"
  → POST /api/agent/dispatch { intent:"knowledge_qa", 
                               question: <LLM 生成的研究主题>, 
                               assetIds: [bridge_or_sparse_seed_ids] }
  → 复用现有流式回答
```

**LLM 生成研究主题**：后端 `services/graphInsights/deepResearchPrompt.ts` 接受一条洞察卡片（桥接节点 / 稀疏社区），用**小模型**生成一个"为什么这是洞察 + 想补全什么信息"的 1-句研究主题。生成内容给前端 editable 对话框（llm_wiki 也这么做），用户改完后才真正 dispatch。

**重要复用点**：`runRagPipeline` 的 `opts.assetIds` + `opts.spaceId` 已原生支持（`ragPipeline.ts:498-514`）。ADR-24 已确认 `assetIds` 非空时跳过 short-circuit 阈值，直接调 LLM——正合需求。**不改 RAG 管线代码。**

## 9. 前端放置

**推荐**：新路由 `/knowledge/insights`，在 Layout 左侧导航增一项"洞察"（与 Assets/Search/Overview 平级）。

**拒绝放到 DetailGraph 旁边**的理由：DetailGraph 是 per-asset 视图，洞察是 per-Space 的全局视图——耦合会混淆用户心智。DetailGraph 里可以**反向加一个链接**"在洞察中查看 → /knowledge/insights#asset=N"（未来可选）。

**不做 Governance Tab**：Governance 目前承接"操作与审批"（ADR-35/38），主题是行动编排；洞察是认知发现，语义不同。

**绘图库选择**：
- v1 MVP：**不画全图**，洞察卡片列表即可，每条卡片点开显示"涉及的资产列表 + 小型局部 SVG"（复用 DetailGraph 的 SVG 环形布局能力，再抽一层 `<MiniGraph assetIds={[...]} />`）。
- v2：若用户需求强烈再引 sigma.js（bundle +200KB）。

## 10. 风险清单

| # | 风险 | 级别 | 缓解 |
|---|------|------|------|
| R1 | Louvain 在万级边图上延迟不可控 | 🔴 | 首版硬性限制 `|E| ≤ 10_000`，超限降级为"不算社区，只出孤立页面"；写 benchmark 作为 Lock 阶段验收门 |
| R2 | 资产变更后缓存不失效 → 用户看到陈旧洞察 | 🟡 | 双保险：TTL + graph_signature；手动刷新按钮兜底 |
| R3 | 惊奇度权重 `w_cross/w_type/w_weight` 初始值无真实数据支撑 | 🟡 | 在 Lock 里把它写成可通过环境变量覆盖的参数；eval 后再调；**不从 llm_wiki 抄数值**（GPL 合规） |
| R4 | Deep Research 用小模型生成研究主题的成本 | 🟢 | 按需触发（用户点击才生成），缓存到洞察 payload 里防重复生成 |
| R5 | `metadata_graph_insight_cache` 表在 Space 删除时需级联清理 | 🟡 | FK ON DELETE CASCADE → `metadata_space(id)` |
| R6 | 多 Space 并发重算（两个 Admin 同时刷新同一 Space） | 🟡 | 加 advisory lock：`pg_try_advisory_lock(hashtext('gi:'||space_id))`，拿不到锁直接读旧缓存 + 给 WARN |
| R7 | 孤立页面定义用 `indexed_at > 7d` 会过滤新资产，但 BookStack 增量 sync（ADR-31）可能把老 page 重算 `indexed_at` | 🟢 | 改用 `metadata_asset.created_at` 作为"资产存在时长"口径 |
| R8 | ACL 过滤在 payload 返回前做，但 payload 内嵌 assetId 列表——一个攻击者可能构造 spaceId=别人的进行枚举 | 🔴 | `enforceAcl` 在路由层必须硬 allow-or-403，payload 内的 assetId 前端再次查询会被二次 ACL 拒绝；Lock 阶段必须有测试覆盖 |

## 11. Open Questions（进 Lock 前要和你敲定）

- **OQ-GI-1**：Louvain 的 resolution 参数取多少？默认 1.0 还是偏保守的 1.2？（影响社区数量与 bridge 判定阈值）
- **OQ-GI-2**：`HAS_TAG` 边要不要和 `CO_CITED` 一样参与 Louvain？两者语义不同（标签是人工/ontology 加的，CO_CITED 是行为派生）。建议：**只用 CO_CITED**跑 Louvain，`HAS_TAG` 仅在"桥接节点回退口径"里用。
- **OQ-GI-3**：Deep Research 生成研究主题的小模型选哪个？走现有 LLM provider 抽象（`llmProviders.ts`）还是固定某个？
- **OQ-GI-4**：Space 级以下要不要再做 "Notebook 级" 洞察？（Notebook 是 ADR-24 的概念，Space 的子集）。建议 **v1 不做**，等真实反馈。
- **OQ-GI-5**：洞察 payload 里要不要包含资产的 `score` 排名？（便于前端再次排序）还是让前端按 insights 自己的 `surprise_score` 排序？

## 12. 下一步（Lock 阶段要产出的文件）

- `openspec/changes/graph-insights/proposal.md` — 问题陈述 + scope + out-of-scope
- `openspec/changes/graph-insights/design.md` — 本文精简锁定版（≤ 200 行）
- `openspec/changes/graph-insights/specs/graph-insights-spec.md` — 路由契约 + SQL DDL + JSON payload schema
- `openspec/changes/graph-insights/tasks.md` — 6-9 条实施任务（按依赖排序）

Lock 前我要先回来跟你过一遍 OQ-GI-1 到 5。**如果你对本文哪条决策持异议，现在是最便宜的时机**（改契约远贵于改 Explore 草稿）。
