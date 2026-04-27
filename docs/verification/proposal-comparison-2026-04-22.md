# 新方案 vs 当前方案 · 差异对照 · 2026-04-22

> 输入：用户上传的 `知识中台.zip`，内含 14 周开发计划、架构文档、tech stack 选型、
> Python/FastAPI 后端骨架、docker-compose 全栈编排、PostgreSQL Schema、JIRA 任务清单。
>
> 现状：仓库已经实现 15 个 OpenSpec change、TS 双服务 tsc EXIT=0、登录链路真跑通、
> /ingest 4 Tab 重做完毕。

## 一、最关键的判断

**这两套方案不是"哪个更好"，是"做哪种产品"。**

| 维度 | 当前方案 | 新方案 |
|---|---|---|
| 定位 | 单团队/小组先把 RAG 跑起来 | 公司级中台，2-3 业务线共享 |
| 周期 | 已经在 ship | 14 周 + 3-5 人 + 8 卡 A100 |
| 投入 | ~1-2 人 / 现有硬件 | 3-5 人 + ≥ 10TB SSD + GPU |
| 风险点 | 扩到 100 万 chunk 后 pgvector 瓶颈 | 立项即重资产，超期 / 砍范围风险大 |

**两件事是真的可以借鉴**（在不做 platform 重构的前提下）：
1. Schema 设计里的 `tenant_id` 一等公民 + ACL 规则更丰富 (`conditions`、`priority`、`expires_at`)
2. 异步 ingest pipeline 用消息队列解耦（即便是 in-process 队列也比当前同步好）

**一件事不该被新方案带跑**：把现有 TS/Node 栈推倒重写为 Python/FastAPI，没有任何技术净收益，只有 4-6 周纯重构成本。

---

## 二、十三个维度逐项对照

### 2.1 技术栈

| 项 | 当前 | 新方案 |
|---|---|---|
| 后端语言 | Node.js + TypeScript | Python + FastAPI |
| 前端 | React + Vite（自研管理 UI） | RAGFlow 套壳（"省一个月"） |
| 包管理 | pnpm workspace | pip + Docker |
| 异步模型 | Express + 同步 ingestPipeline | asyncio + Kafka workers |

**评价**：
- 当前 TS 栈写完了 ~15 个 change，团队对它熟，没有迁移理由
- RAGFlow 套壳省前端开发时间，但**等于把 UI 主导权交出去** —— DSClaw 那套原型样式（你昨天对的 10 个页）将作废
- Python 在 RAG 生态里组件更多（LlamaIndex/LangGraph/Ragas/MinerU 都是 Python first），TS 替代品要么少要么薄

### 2.2 向量存储

| 项 | 当前 | 新方案 |
|---|---|---|
| 引擎 | PostgreSQL + pgvector | Milvus 2.4 集群 |
| 向量列 | `embedding vector(4096)` 单列 | Milvus Collection per KB + Partition by tenant_id |
| 规模 | < 100 万 chunk 优秀 | 千万级 / 亿级才发力 |
| 运维成本 | PG 一个进程 | etcd + MinIO + Milvus 三进程起步 |

**关键引用**（来自新方案 docs/03_tech_stack.md）：
> Milvus vs pgvector？数据量 < 100 万 chunk 用 pgvector 够了；超过就上 Milvus。
> 中台建议直接 Milvus，省二次迁移成本。

**判断**：当前阶段 chunk 总量大概率 <10 万，pgvector 完全够用。"省迁移成本"在你团队规模下是伪命题，因为你没人维护 Milvus 集群。

### 2.3 多租户

| 项 | 当前 | 新方案 |
|---|---|---|
| Schema | 无 `tenant_id` 字段 | 每张表都有 `tenant_id` + RLS |
| 向量过滤 | 没概念 | Milvus Partition Key by tenant |
| 物理隔离 | 不支持 | 可选独立 DB / Schema / Bucket |

**这是新方案最有价值的设计**。当前实现连概念都没有 —— `metadata_acl_rule` 只到 source/asset 粒度，没有 tenant。如果未来真要给多业务方复用，必须补这块。

**借鉴成本**：在 metadata_source / metadata_asset / metadata_field 加 `tenant_id` 字段 + 索引 + 默认值 'default'，约 1.5 天工作量；前端 Iam 加租户切换 UI 约 1 天。这件事**值得排进 followup**。

### 2.4 ACL / 权限模型

新方案的 `metadata_acl_rule`：

```sql
resource_type   VARCHAR(32),    -- kb / asset / field
resource_id     UUID,
subject_type    VARCHAR(16),    -- user / role / group
subject_id      VARCHAR(128),
permission      VARCHAR(16),    -- read / write / admin / deny
conditions      JSONB,
priority        INT,            -- 数字越小越优先
expires_at      TIMESTAMPTZ
```

当前实现的 `metadata_acl_rule`：

```sql
source_id INT, asset_id INT, role VARCHAR, permission VARCHAR, condition JSONB
```

**差距**：
- 新方案有 subject_type 区分 user / role / group；当前只有 role
- 新方案有 permission='deny' + priority 实现否决式规则；当前只有正向规则
- 新方案有 expires_at 临时授权；当前没有
- 新方案 resource_type 区分 kb/asset/field；当前固定到 source/asset

**判断**：当前 ACL 模型今天通过了 31/31 验证，"够用"。但 PRD 真实需求里如果有"临时授权"或"deny 优先"场景，新方案的 schema 是对的。

**借鉴成本**：加 `subject_type`、`expires_at`、`priority` 三列 + evaluateAcl 加分支，约 2 天。

### 2.5 文档解析

| 项 | 当前 | 新方案 |
|---|---|---|
| PDF | opendataloader-pdf + VLM | MinerU（中文 PDF SOTA，AGPL） |
| Office | officeparser fallback | Unstructured (Apache 2.0) |
| OCR | tesseract.js | PaddleOCR |
| License 风险 | 无 | MinerU AGPL，对外提供服务有问题 |

**关键判断**：MinerU 在中文扫描件上确实比 opendataloader 强一档，但：
- AGPL 对内部用没问题，对外提供 SaaS 要审查
- 需要独立 Python 服务（不能直接进 Node 进程）
- 你昨天刚把 PDF Pipeline v2 跑稳

**借鉴成本**：要么把 MinerU 部署成独立 Python micro-service，TS 后端 HTTP 调；要么彻底切栈。前者约 3 天 + 1 台 GPU 机器，后者就是重写。

### 2.6 入库 Pipeline 异步化

| 项 | 当前 | 新方案 |
|---|---|---|
| 触发 | HTTP → 直接同步执行 | HTTP → MinIO 存原文 → Kafka 投递 |
| 解耦 | 无 | parse / chunk / embed / graph 4 个独立 worker |
| 重试 | 失败要重提交 | Kafka 自带，worker 幂等 |
| 进度 | jobRegistry in-memory | ingest_task 表持久化 |

**这是新方案第二有价值的设计**。今天 /ingest 重做时我已经感受到了 —— 同步执行让 6 步 phase 是粗粒度跳变，没法真正"暂停 / 重试"。

**借鉴成本**：
- **轻量版（推荐）**：把 jobRegistry 改成 PG 持久化 + 单进程 worker pool（async queue），约 2 天
- **完整版**：引入 RedPanda + 多个 worker，约 1 周 + 多一个组件运维

### 2.7 知识图谱

| 项 | 当前 | 新方案 |
|---|---|---|
| 图引擎 | 无 | Neo4j Community（GPL v3） |
| 抽取 | 无 | LightRAG / GraphRAG |
| 检索 | 纯向量 | 向量召回 → 实体抽取 → 1-2 跳扩展 |

**判断**：图谱在"多跳推理"场景准确率提升 ≥ 15%，但门槛高：
- 抽取阶段每个 chunk 都要调一次 LLM，token 成本翻倍
- Neo4j Community GPL，AGPL/GPL 同样有合规问题
- 你目前 PRD 里没明确要求图谱

**判断**：先不做。等 RAG 已经有 100+ chunk + 业务真碰到多跳场景再上。

### 2.8 Auth

| 项 | 当前 | 新方案 |
|---|---|---|
| SSO | 无 | Keycloak |
| JWT | 自签 HS256 + scrypt 密码 | Keycloak 签 + JWKS 验签 |
| 用户管理 | 自己的 users 表 + IAM Tab | Keycloak 用户面板 |

**判断**：当前已经过验证（31/31 PASS）。Keycloak 适合企业有多个系统要 SSO 的场景；如果只是这个产品自己用，自签 JWT 完全够。

**借鉴成本**：换 Keycloak 是个独立工程，约 3 天 + 一个 docker 服务，不影响前端代码（验签逻辑在 verifyToken.ts 里集中）。

### 2.9 可观测性

| 项 | 当前 | 新方案 |
|---|---|---|
| LLM trace | 无 | Langfuse |
| 业务审计 | audit_log 表 | audit_log 表 + Loki 日志聚合 |
| 指标 | 无 | Prometheus + Grafana |

**判断**：Langfuse 真香，特别是调 prompt / 看 RAG 召回质量。当前完全没有这块。

**借鉴成本**：把 Langfuse SDK 加进 ragPipeline + qa 路由，约 1 天。Langfuse 自托管要起 1 个 docker（用 Postgres）。**强烈建议借鉴**。

### 2.10 评测体系

| 项 | 当前 | 新方案 |
|---|---|---|
| 评测集 | 无（vitest 是单测，不是 RAG eval） | Ragas + 100 条业务 case |
| 持续评测 | 无 | CI 跑 Ragas，看 Faithfulness / Answer Relevancy |
| A/B | 无 | 框架级支持 |

**判断**：今天 RAG 调的好不好你完全没量化指标。没有评测集就没法做 prompt / chunk size / top_k 调优。**这块是当前最大的盲区**。

**借鉴成本**：构造 100 条业务问答 + 接 Ragas Python 脚本，约 3-5 天。**强烈建议借鉴**。

### 2.11 网关

| 项 | 当前 | 新方案 |
|---|---|---|
| 网关 | Express + cors | APISIX（Apache 2.0） |
| 限流 | 无 | APISIX plugin |
| 多租户路由 | 无 | APISIX 配置 |

**判断**：内部用不需要 APISIX。等真有 SLA 99.9% / 100+ 并发场景再说。

### 2.12 部署

| 项 | 当前 | 新方案 |
|---|---|---|
| 启动 | `pnpm dev:up`（4 个进程） | `docker-compose up`（14+ 服务） |
| 生产 | 没明示 | K8s ready |
| 资源 | 1 台机 + 浏览器 | 8 台机 + 8 卡 A100 |

**判断**：新方案的 docker-compose.yml 是好的参考，**当作"下一阶段部署蓝图"放进 docs/superpowers/ 存档**，但不要现在迁。

### 2.13 项目管理

新方案附了一份 92 行 jira_import.csv，把 14 周拆到任务级。这是真有用的产物，**可以直接借鉴格式**给现有 OpenSpec change 做时间估算。

---

## 三、推荐做法（按优先级）

### 高优先级（建议本月做）

1. **加 Langfuse trace** —— 1 天，立刻能看到 RAG 调用链，调 prompt 必备
2. **构造 50-100 条业务评测集 + 接 Ragas** —— 3-5 天，今天起就该攒数据了
3. **schema 加 `tenant_id` 字段（默认 'default'）** —— 1.5 天，未来加租户不用迁数据
4. **把 jobRegistry 持久化到 PG（`ingest_task` 表）** —— 1 天，进程重启不丢任务

### 中优先级（PRD 真实需求出现再做）

5. **ACL 加 `subject_type` / `expires_at` / `priority`** —— 2 天，等业务真要"临时授权"再上
6. **入库 Pipeline 异步化（in-process worker pool）** —— 2-3 天，等单个文件真的卡住 UI 再上

### 低优先级（不到那一步不要做）

7. ~~迁到 Milvus~~ —— 100 万 chunk 之前不必
8. ~~迁到 Neo4j 图谱~~ —— 多跳场景明确出现再上
9. ~~换 Keycloak~~ —— 多系统 SSO 需求出现再上
10. ~~换 APISIX~~ —— 100+ 并发再上
11. ~~换 RAGFlow 当后台~~ —— 等于把昨天 10 页 UI 还原度作废

### 不推荐做

- **整栈迁 Python/FastAPI** —— 4-6 周纯重构成本，无技术净收益。Node.js + TS 在你这个规模做 RAG 完全没问题
- **先上 Milvus / Neo4j / Kafka 的全套基础设施** —— 重资产、重运维，团队人数不够撑

---

## 四、新方案值得归档的产出

放进 `docs/superpowers/specs/` 长期存档，便于公司未来扩张时拿出来：

| 文件 | 价值 |
|---|---|
| `docs/02_architecture.md` | 完整 13 层架构图，"权限过滤黄金法则"那段值得贴到 ADR |
| `docs/03_tech_stack.md` | 36 个组件 + License 表，是很好的选型字典 |
| `schema/init.sql` | 多租户 schema 参考；尤其 ACL 模型 + audit_log 设计 |
| `deploy/docker-compose.yml` | 全栈基础设施编排参考 |
| `tasks/jira_import.csv` | 14 周任务拆解参考 |

---

## 五、一句话总结

> 新方案是**给"有 5 个人 + 14 周 + GPU 集群"的公司**写的"企业知识中台参考实现"；
> 当前方案是**给"小团队 + 一台开发机"**写的"今天就能上线的 RAG 工具"。
>
> **不要切栈**，但**借鉴 4 件事**：tenant_id schema、Langfuse trace、Ragas 评测、jobRegistry 持久化。
> 其他都是"等业务真长到那个量级再上"。
