# ADR 2026-04-24-39 — WeKnora 借鉴点对照与 OAG Phase 2 登记

> 工作流外（调研 + 记忆登记），不启 OpenSpec change。本 ADR 作为后续可能派生 change 的单点溯源。
>
> **编号说明**：本 ADR 初次落盘时错取 37，与同日 `2026-04-24-37-ts-strip-types-discipline.md` 撞号；
> 按 `decisions/README.md` "永不覆盖"原则改名为 39。ADR-38 由 `governance-actions-list-wire` 占用。

## Context

用户 2026-04-24 要求对 Tencent/WeKnora（https://github.com/Tencent/WeKnora）做技术调研，识别可借鉴点。WeKnora 是腾讯开源的 RAG 框架：Go 主干 + Python docreader 微服务（gRPC）+ 多向量库可插拔（pgvector/ES/Qdrant）+ ReACT Agent + MCP + 多 IM 渠道适配。

调研基于公开资料（README / 官方博客 / 社区二次解读），GitHub 域名被本机网络 egress 拦截，未能直接读源码，以架构级描述为准。

调研发起时**尚不知道** 2026-04-24 ontology 三件套（ADR-33/34/35）今日上午已实现 + 本机验证 + 归档完成、eval-recall 录得 recall@5=1.000 零回归。这一背景对 D-002 触发条件的判读有直接影响——见 Consequences 第 4 条。

## Decision

### D-001 借鉴点匹配度分级（对照 2026-04-24 仓库现状）

| # | 借鉴点 | 现状契合点 | 匹配度 | 处置 |
|---|--------|-----------|--------|------|
| 1 | ReACT Agent 循环 + 并行工具 + 迭代/反思上限 | `agent/dispatchHandler.ts` 是"单轮 classify → 单 Agent 执行"；`KnowledgeQaAgent.run` 一行跑完 `runRagPipeline` | ⭐⭐⭐ | OQ-AGENT-1 待决 |
| 2 | KG 进三路召回（graph-expand + RRF） | `hybridSearch.ts` 已 RRF 融合两路；AGE 已有 `CITED`/`CO_CITED` 边，目前只用于 DetailGraph 展示 | ⭐⭐⭐ | D-002 并入 OAG Phase 2 |
| 3 | Ingest 异步四阶段状态机 + 任务表 | `ingestPipeline/pipeline.ts` 同步串行；`jobRegistry.ts`/`syncWorker.ts` 骨架已在 | ⭐⭐⭐ | OQ-INGEST-1 待决 |
| 4 | NL2SQL 用 PG 官方 parser 做 AST 级安全校验 | `StructuredQueryAgent` 是"建设中"占位；未来启动 NL2SQL 时应前置设计 | ⭐⭐ | OQ-SQLSEC-1 待决（绑 structured_query change） |
| — | MCP 客户端自动重连 + Web search provider 化 | 仓库 `mcp-service` 目前是 server 侧，无 client 消费路径 | ⭐ | 不登记，等 Agent 消费外部 MCP 的实际需求 |
| — | IM 多渠道适配器 / Go+Python+gRPC 拆分 / 依赖注入容器 / 多向量库可插拔 / PaddleOCR | 不在路线图或用户有更优方案（VLM > OCR） | — | 不登记 |

### D-002 "KG 进三路召回" 归并为 OAG Phase 2，不启新 change

**理由**：与已存在的 `openspec/changes/ontology-oag-retrieval/` 存在强相关——OAG 管 "prompt 侧 entity context 注入"（Phase 1），召回路三路化管"retrieval 侧漏召回"（Phase 2），两者互补但目标不同。在 OAG 未上线前再起一条基于 KG 的并行 change，评审节奏过紧且缺乏效果数据支撑。

**动作**：在 `openspec/changes/ontology-oag-retrieval/design.md` 末尾追加 "Phase 2 路线图" 章节（本 ADR 配套实施），明确：

- Phase 2 与 Phase 1 正交、串行叠加；
- 改动点集中在 `hybridSearch.ts`，新增 `graph-expand` 第三路（RRF `k=90`，权重低于 vector/keyword）；
- **触发条件**：等 Phase 1 合并 + eval 基线产出后，若 `recall@k` 是瓶颈再启动；若瓶颈在可解释性而非召回率则搁置。

### D-003 在活契约 design.md 追加 Phase 2 roadmap（精确表述）

OAG 已于 2026-04-24 完成实现 + 本机验证 + 归档到 `docs/superpowers/archive/ontology-oag-retrieval/`；`openspec/changes/ontology-oag-retrieval/` 按 PROGRESS-SNAPSHOT 约定**保留作为活契约供下游消费**。

本次追加**只改活契约副本**（267 行）、**不改归档副本**（232 行原版冻结）。这是对 CLAUDE.md "OpenSpec 合并 = 接口契约生效"的合规做法——活契约就是设计用来被新 change 引用的。

权衡：

- 正：Phase 2 和 Phase 1 一屏可见，未来执行方不会漏看；活契约持续被下游消费，追加未来路线图符合活契约语义。
- 负：活契约与归档副本 35 行差异；凡只看归档的人会漏掉 Phase 2；Phase 2 章节本身明确写了"本 change 不实施"以消歧。

**兜底**：本 ADR 是 Phase 2 的**唯一正式登记点**。如果将来真的启动 Phase 2，要在新的 change 里引用本 ADR-39 号，而不是只指向 OAG 的 design.md。

### D-004 另外 3 条借鉴点进 `open-questions.md`，不直接启 change

避免挤占当前 ontology 三件套（OAG / declarative-skills / action-framework）的评审与执行节奏。三条 OQ 条目对应 D-001 表里 ⭐⭐ 及以上的未处置项：

- `OQ-INGEST-1` — Ingest 同步串行 → 异步四阶段状态机的启动时机
- `OQ-AGENT-1` — `KnowledgeQaAgent` ReACT 化的启动时机
- `OQ-SQLSEC-1` — `structured_query` 落地时必须前置的 SQL AST 校验方案

## Consequences

### 正向
- WeKnora 调研结论全部可回溯（本 ADR + Phase 2 章节 + 3 条 OQ），不会在 session 结束后蒸发；
- OAG 路线图叙事更完整："写入侧（ADR-27）→ 读取侧 prompt 注入（OAG Phase 1）→ 读取侧召回路（OAG Phase 2，条件触发）"；
- 未启动的借鉴点（ReACT、异步 ingest、SQL AST）都有明确"等待事件"，避免循环讨论。

### 负向
- 在 OAG 活契约的 design.md 追加 Phase 2 章节开了先例，后续需要用本 ADR 的 D-003 作为唯一允许理由（即"只追加未来路线图、不修改现有契约"）。活契约与归档副本 35 行差异，只看归档的人会漏掉 Phase 2；
- 公开资料级调研深度有限，部分结论（如 WeKnora 的 SQL AST 校验细节）是从 commit message 反推，未核对源码。

### 关于 Phase 2 触发条件的后知后觉更新

本 ADR 初稿写 "Phase 2 触发条件依赖 Phase 1 eval 数据"时，**不知道** `eval/gm-liftgate32-v2.jsonl` 上的 Phase 1 基线已经跑出来了（PROGRESS-SNAPSHOT-2026-04-24-ontology.md §八）：

| 指标 | 值 |
|---|---|
| 平均 recall@1 | 0.973 |
| 平均 recall@3 | 1.000 |
| 平均 recall@5 | **1.000** |
| top-5 未命中 | **0 题** |

**判读**：召回率已触顶，在当前 37 道题金标集上"召回率是 Phase 2 触发条件"**明确不成立**。Phase 2 应进入**较长时间搁置**状态，除非：
1. 金标集扩充到更大规模（≥ 200 题）后 recall 出现显著下滑；或
2. 用户反馈的真实问题里出现了"跨文档多跳、单路向量召不回"的可证场景。

这一结论反过来强化了 D-002 的"归并而非新启"决策的正确性——若当时硬启 Phase 2 独立 change，现在会发现触发条件不存在而陷入"已立项但无法启动"的尴尬。

### D-007 D-001 第 5 行 "MCP 客户端 + Web search provider" 从未登记升级为登记 OQ-SKILL-BRIDGE（2026-04-25 追加）

**原始处置**（D-001 第 5 行）：
> "不登记，等 Agent 消费外部 MCP 的实际需求"

**追加背景**：用户 2026-04-25 明确表达了"对接 SKILL"的意向。盘点仓库现状发现一个之前没显式拆分清楚的事实——本仓库**自身**就有 mcp-service 暴露的 8 个声明式 Skill（ADR-34），但 qa-service 的 4 个 agent 都不消费它们：

- 外部 MCP client（Cursor / Claude Desktop）能用这 8 个 Skill；
- qa-service 内部 agent 用不上 → 同一组工具能力被两边各做一半。

D-001 第 5 行原本只考虑"消费**外部**第三方 MCP 服务"的场景（如 Tavily），未考虑**自家** mcp-service 也是个等待消费的目标。这是一个调研盲点。

**升级动作**：

- 新增 Open Question `OQ-SKILL-BRIDGE`（见 `.superpowers-memory/open-questions.md`）
- 等待事件改为：① OQ-AGENT-1 ReACT change 启动时作为前置依赖一起做；或 ② 出现"agent 需要按运行时配置切换工具集"的真实场景
- 解决路径分两档：MVP 直接 import handler（~0.5 人天）/ 完整 MCP client + 自动重连（~2-3 人天，含 WeKnora #5 的 Web search provider 化）
- D-001 表第 5 行的"⭐ 不登记"标注**保留作历史记录**，不改老内容；本 D-007 是唯一的状态升级点

**为什么不并入 OQ-AGENT-1**：

OQ-SKILL-BRIDGE 在没有 ReACT 的情况下也有独立场景（hot-pluggable Skill 配置），可独立启动。但优先级仍以 ReACT 为准 —— 没有 ReACT 循环的 agent 调用 Skill 没有质变收益。

## 代码清单

### 修改
- `openspec/changes/ontology-oag-retrieval/design.md`：末尾追加 "Phase 2 路线图" 章节（233 → 267 行）
- `.superpowers-memory/open-questions.md`：新增 OQ-INGEST-1 / OQ-AGENT-1 / OQ-SQLSEC-1（首次落盘）；2026-04-25 追加 OQ-SKILL-BRIDGE（D-007）

### 新增
- `.superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md`（本文件）

### 不涉及
- `apps/` 下任何源码；
- `openspec/changes/` 下任何 proposal / tasks / specs 文件；
- `docs/superpowers/archive/ontology-oag-retrieval/` 归档副本（232 行原版冻结）；
- `eval/` 数据集。

## Links

- 上游调研材料：https://github.com/Tencent/WeKnora（README / blog / zread.ai 二次解读）
- 活契约：`openspec/changes/ontology-oag-retrieval/design.md`（Phase 1 已实现并归档，活契约副本含本次追加的 Phase 2 路线图章节）
- 归档副本：`docs/superpowers/archive/ontology-oag-retrieval/`（232 行原版冻结，不含 Phase 2 章节）
- 关联 ADR：
  - ADR-27 `knowledge-graph-age`（KG sidecar 初建，Phase 2 的物质基础）
  - ADR-33 / 34 / 35（ontology 三件套：OAG Phase 1 / declarative-skills / action-framework，本 ADR 与之并行而非替代）
  - ADR-36 `eval-golden-set-realign`（eval 数据修复，Phase 1 基线数据的前置条件）
  - ADR-37 `ts-strip-types-discipline`（与本 ADR 初次命名撞号，本 ADR 改名为 39）
- 衍生 Open Questions：`OQ-INGEST-1`（已关闭 ADR-40 · 2026-04-24）/ `OQ-AGENT-1` / `OQ-SQLSEC-1` / `OQ-SKILL-BRIDGE`（D-007 追加 · 2026-04-25）（见 `.superpowers-memory/open-questions.md`）
