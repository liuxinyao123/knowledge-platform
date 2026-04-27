# Explore · Ontology 智能本体引擎（OAG + Skill + Action）

> 工作流 D · `openspec-feature-workflow` — 仅产接口契约，不写实现。
> 来源：用户对 PolarDB-PG Ontology 文章的采纳讨论（2026-04-24）。
> 本文件是 Explore 阶段草稿，OpenSpec 合并后归档到 `docs/superpowers/archive/ontology/`。

---

## 1. 动机

### 1.1 用户原文（摘录）

> "这套 Ontology 理论跟你的平台契合度非常高，但不适合整体照搬，适合'选段移植' —— 你已经有半个底座了，缺的是语义层抽象和 Action 框架。"
>
> 采纳范围：**OAG + Skill + Action** 三件事。

### 1.2 现状盘点

| 文章概念 | 平台现状（2026-04-24） | 差距 |
|---|---|---|
| Polar_AGE + PGVector | Apache AGE 1.6.0 sidecar（`kg_db`，ADR-27） + pgvector/pgvector:pg16 | 已具备，只是语义层偏"引用图谱"，缺业务检索闭环 |
| Objects / Links | 5 节点 + 5 边（Asset/Source/Space/Tag/Question × CONTAINS/SCOPES/HAS_TAG/CITED/CO_CITED） | 节点模型不动，属性与 embedding 维度需扩展 |
| Actions | 无统一 Action 框架；写操作散落在 `routes/*.ts` 各处 | 零 | 需新增 |
| Skills | `mcp-service` 硬编码两个工具（search_knowledge / get_page_content） | 需重塑为声明式 Skill |
| ACR（细粒度权限） | Permissions V2（`subject_type × allow/deny × TTL`，deny 优先） | **本次复用 V2，不引入新概念** |
| OAG 检索 | Agentic RAG 是纯 chunk 粒度（ADR 2026-04-23-22/24） | 需加一步 entity+link 扩展 |

### 1.3 目标（单句）

> 让 Agent 在 Agentic RAG 管线内能**看见实体而非只看见片段**，通过声明式 Skill 按配置暴露图操作，并把高危写操作收敛到带审批的 Action 状态机。

---

## 2. 范围决策（用户确认）

| 维度 | 决策 |
|---|---|
| 交付形态 | **3 个 OpenSpec change**：`ontology-oag-retrieval` / `ontology-declarative-skills` / `ontology-action-framework` |
| 节点模型 | **复用现有 5 种节点**（Asset/Source/Space/Tag/Question），不新增 Customer/Device 之类业务对象 |
| Skill 落地 | **扩展 `apps/mcp-service`**（不新建 skill-service，不内嵌 qa-service） |
| 权限模型 | **复用 Permissions V2**，不引入 ACR 新表；图遍历时调 V2 的 ACL 过滤函数 |
| 业务对象扩展 | 本次**不做**，不预留 ObjectType 元表；未来若要做走新的 change |

### 2.1 Out of Scope（显式）

- LLM 自动建模（从 Schema 推 Object/Link/Action）。平台已经用 ADR + OpenSpec 显式建模，边际收益低。
- 新增业务对象节点类型。
- 修改 `pgvector` 表 schema 或 `services/vectorStore.ts` 召回算法。
- 替换 `mcp-service` 现有两个 tool（`search_knowledge` / `get_page_content`）；它们作为兼容入口保留，新 Skill 以附加方式上线。
- 跨租户（multi-tenant）改造。

---

## 3. 三个 change 的职责边界

```
┌────────────────────────────────────────────────────────────────┐
│  ontology-oag-retrieval   （契约：RAG 管线新增一步 entity+link 扩展）│
│  消费者：services/ragPipeline.ts                                │
│  依赖：graphDb.ts / knowledgeGraph.ts（ADR-27 已有）             │
└─────────────────┬──────────────────────────────────────────────┘
                  │ 输出的 OntologyContext 结构被 Skill 消费
                  ▼
┌────────────────────────────────────────────────────────────────┐
│  ontology-declarative-skills   （契约：Skill 文件格式 + MCP loader）│
│  消费者：apps/mcp-service                                        │
│  依赖：qa-service 新增 /api/ontology/{query,traverse,path}       │
└─────────────────┬──────────────────────────────────────────────┘
                  │ 写操作型 Skill 调用 Action API
                  ▼
┌────────────────────────────────────────────────────────────────┐
│  ontology-action-framework   （契约：Action 定义 + 状态机 + 审批）  │
│  消费者：qa-service /api/actions/*                               │
│  依赖：Permissions V2（鉴权）+ acl_rule_audit（审计模板参考）     │
└────────────────────────────────────────────────────────────────┘
```

### 3.1 依赖顺序

OAG → Skills → Actions **不是强依赖**，可并行开发。但合并顺序建议：

1. `ontology-oag-retrieval` 先合（最小侵入，只读扩展）
2. `ontology-action-framework` 第二（独立新模块）
3. `ontology-declarative-skills` 最后（可引用前两者的 API）

---

## 4. 关键设计抉择（由 Explore 阶段敲定，OpenSpec 固化）

### D-001 · OAG 不是新管线，是 `gradeDocs` 的**前置增强**

在 `retrieveInitial → rerank → gradeDocs` 之间插入 `expandOntologyContext`：

- 输入：rerank 后的 top-K chunks
- 动作：从 `metadata_chunk.asset_id` 反查 AGE，执行 1-2 跳 traverse（`Asset -[CONTAINS]- Source -[SCOPES]- Space`、`Asset -[HAS_TAG]- Tag`）
- 输出：`OntologyContext = { entities: [...], edges: [...] }`，注入到 `gradeDocs` 的 LLM prompt

**跳数上限 = 2**，超过即降级为"只返回直接邻居"。理由：AGE 查询 pool `max=3`（ADR-27 D-009），深跳会打爆连接。

### D-002 · Skill 是"声明式 manifest + 默认实现"的二合一

一个 Skill 由两部分组成：

- `apps/mcp-service/skills/<name>.skill.yaml` — 声明 input schema、output schema、下游调用（Ontology API 或 Action API 的 URL + 参数映射）
- 可选的 `skills/<name>.hook.ts` — 只有当声明式无法表达复杂逻辑时才写（例如 shelf_id 过滤这类）

MCP 启动时扫描目录，把每个 `.skill.yaml` 编译成一个 MCP tool 注册。现有两个硬编码 tool 迁移为 skill 声明 + hook（向后兼容，工具名不变）。

### D-003 · Action 状态机最小集

```
draft → pending → approved → executing → succeeded | failed | cancelled
                       └─── rejected
```

- **preconditions**：Action 声明中列出，执行前在 `qa-service` 校验（例如 `asset.status == 'online'`）
- **审批**：`risk_level ∈ {low, medium, high}`，`high` 强制走 `pending`，`medium` 走配置化规则，`low` 可直接 `executing`
- **Webhook**：`on_state_change` 可选，POST 到配置的 URL（失败重试 3 次、指数退避）
- **审计**：复用 `acl_rule_audit` 模板写 `action_audit` 表（before_json / after_json / actor / reason）

### D-004 · 权限统一走 V2，不写 ACR-aware traversal

为简化，本期**不**在 Cypher 层嵌 ACL 谓词。策略：

- `expandOntologyContext` 先对 chunk 的 asset_id 逐个调 `evaluateAcl(principal, 'READ', {asset_id})`（`apps/qa-service/src/auth/evaluateAcl.ts`），保留可见集后再喂给 AGE `traverse`
- Cypher 返回后新出现的 Asset 节点再二次跑一轮 `evaluateAcl('READ')` 剪枝
- 并发上限 16（防 `aclCache` 抖动）；top-K 通常 ≤ 15，性能可接受
- ACR-aware traversal（Cypher 内嵌谓词）作为未决项列入 `open-questions.md`（OQ-ONT-2）

### D-005 · Skill 的 MCP 工具名前缀约定

- 只读查询类：`ontology.query_*` / `ontology.traverse_*` / `ontology.path_*`
- 写操作类：`action.*`（调 Action API）
- 兼容老工具：`search_knowledge` / `get_page_content` 不加前缀，迁移透明

### D-006 · 不引入新的图节点类型，但允许**节点属性扩展**

给 `Asset` 节点追加属性：`description_embedding`（维度对齐主库 1024）、`summary_text`（≤200字 LLM 生成）；给 `Tag` 节点追加 `semantic_embedding`。这些属性用于"自然语言到图节点"的向量匹配（文章提到的图+向量融合检索），**不改节点类型**，因此不破坏 ADR-27 的约束。

---

## 5. 风险与未决

| # | 风险/未决 | 缓解 |
|---|---|---|
| R-1 | AGE 查询 pool 太小（max=3），OAG 新增并发可能打爆 | 限 `expandOntologyContext` 每 QA 只跑一次，失败降级为空 context，主 RAG 不阻塞 |
| R-2 | Skill YAML 越写越复杂变成新 DSL | 硬限制：单 skill ≤ 100 行 YAML，复杂逻辑走 `hook.ts` |
| R-3 | Action 审批 UI 没地方落 | 复用 Governance 模块新增 `/governance/actions` tab（本 change 不做 UI，仅 API 契约） |
| R-4 | 回填老 Asset 的 `description_embedding` 耗时 | 懒加载：第一次被 OAG 命中时异步生成；未生成时跳过向量匹配，只用图结构 |
| R-5 | Webhook 调用外部 URL 的安全风险 | 白名单 `ACTION_WEBHOOK_ALLOWLIST` 环境变量；不在列表内的拒绝 |

未决问题沉淀到 `.superpowers-memory/open-questions.md`：

- OQ-ONT-1：未来是否引入业务对象节点（Customer/Device）？需要一个触发阈值。
- OQ-ONT-2：ACR-aware Cypher traversal 的 ROI 评估。
- OQ-ONT-3：跨 Skill 的参数组合（pipeline-of-skills）是否进入本平台范围。

---

## 6. 下游执行方（供 B 工作流承接人阅读）

三个 change 都写完后：

- 拾取 `ontology-oag-retrieval` 的同学修改：`apps/qa-service/src/services/ragPipeline.ts`、新增 `services/ontologyContext.ts`
- 拾取 `ontology-action-framework` 的同学修改：新增 `apps/qa-service/src/services/actionEngine.ts`、新增 `routes/actions.ts`、新增 migration 建 `action_definition` / `action_run` / `action_audit` 表
- 拾取 `ontology-declarative-skills` 的同学修改：`apps/mcp-service/src/`（新增 skill loader）、新增 `apps/mcp-service/skills/` 目录

三者**共享 Permissions V2**，不要各自搞鉴权。
