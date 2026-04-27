# PROGRESS SNAPSHOT — 2026-04-25 · graph-insights

> 工作流 B（`superpowers-openspec-execution-workflow`）一贴到底：Explore → Lock → Execute → Archive。
> 上下游关系一览见 ADR-41 §Links。

## §一 · 起因

用户 2026-04-24 提出"想接入 https://github.com/nashsu/llm_wiki"。该项目是单机 Tauri 桌面应用、GPL-3，与本项目（多租户 Web + Postgres/pgvector + AGE）异构，三个硬门槛使"直接接入"不成立：

1. 架构异构（桌面 vs Web）
2. 数据层不可互换（文件系统 vs PG）
3. 许可证污染（GPL-3 → 整仓库 GPL）

按 ADR-39 范式给用户列了 17 项借鉴度对照表。用户挑选第 4 项 **"图谱洞察 + 一键 Deep Research"** 作为唯一接入点，明确：从 README 概念级重写，不引源代码。

## §二 · 工作流四步执行

### Step 1 · Explore（不进主分支）

- 派 Explore 子代理勘察 6 个维度（AGE 现状 / RAG 管线 / 前端 / 缓存 / OpenSpec 依赖 / 工程纪律）；产出 `docs/superpowers/specs/graph-insights/design.md`（~280 行）。
- 关键发现：
  - AGE schema 已锁（ADR-27），无新节点/边类型需求；
  - `runRagPipeline.opts.assetIds/spaceId` 已支持（`ragPipeline.ts:498-514`），Deep Research 零代码改动；
  - 子代理误报 `runRagPipeline` 不支持 asset 过滤的风险，被 grep 当场核对订正；
  - `metadata_*_cache` 类表全仓库无先例 → graph-insights 自定 schema；
  - Louvain 必须跑在 Node 侧（AGE/PG 无原生支持）。
- 5 个 Open Question 由用户当场拍板（Louvain resolution=1.0 / 仅 CO_CITED / topic 模型走 llmProviders / v1 不做 Notebook / payload 带 score / **v1 持久化 dismissed**）。

### Step 2 · Lock（OpenSpec 契约）

- 起草 4 个文件：
  - `openspec/changes/graph-insights/proposal.md`（~80 行 · scope / out-of-scope / 8 条 success metrics）
  - `openspec/changes/graph-insights/design.md`（~140 行 · D-001~D-009 决策 + DDL + API 表 + 权重公式）
  - `openspec/changes/graph-insights/specs/graph-insights-spec.md`（~250 行 · 40+ 条 BDD 场景）
  - `openspec/changes/graph-insights/tasks.md`（~150 行 · Phase A–K 检查清单）
- 用户在 mockup 评审环节追加 MiniGraph 入 v1 → tasks.md Phase H 同步追加 MiniGraph 任务条；design.md 的 `metadata_space` 拼写错误（实际表名 `space`）也在 Lock 阶段订正。

### Step 3 · Execute（生产代码 + 测试）

后端 11 文件 / 前端 9 文件 / 测试 3 文件 / 5 处既有文件改动。详细清单见 ARCHIVED.md 与 ADR-41。

技术亮点：
- **零 RAG 链路改动**：Deep Research 直接 `POST /api/agent/dispatch { intent:'knowledge_qa', spaceId, assetIds }` 复用既有 SSE 流。
- **PG advisory lock 防并发重算**：`pg_try_advisory_lock(hashtext('graph_insights:'||space_id))` 非阻塞，未拿锁直接返旧 cache。
- **降级路径明确**：`|E|>10_000` / `LouvainFailureError` / `KgUnavailableError` 三类各自有 status code + payload `degraded` 标记。
- **稳定 insight_key**：sha256(`type:asset_id` 或 `type:sorted_ids`)，跨重算保持 dismiss 一致。
- **ADR-37 纪律遵守**：扫一遍自己的代码发现 louvain.ts 用了 parameter property，立即改成显式字段。

### Step 4 · Verify（待用户本机执行）

ARCHIVED.md 列了 7 项 checkbox，预期：
1. `pnpm --filter qa-service add graphology graphology-communities-louvain`
2. `pnpm -r exec tsc --noEmit` 全绿
3. `pnpm --filter qa-service test -- graphInsights` 35 case 全绿
4. `pnpm dev:up` 冷启 30s 无报错
5. `pnpm eval-recall` recall@5 = 1.000（无回归 —— graph-insights 不改 RAG 链路）
6. curl 冒烟 `/api/insights?spaceId=N` 200 + payload shape
7. 前端冒烟 `/insights` 渲染 + dismiss + Deep Research

## §三 · 关键决策回顾

| ADR-41 编号 | 决策 | 理由 |
|---|---|---|
| D-001 | 走工作流 B 而非 ADR-39 的"借鉴+OQ" | graph-insights 是正交新路线，不依赖 recall 数据触发 |
| D-002 | Louvain 跑 Node 侧 + 仅 CO_CITED | AGE/PG 无原生；HAS_TAG 受 ontology 污染 |
| D-003 | 惊奇度权重自定 | GPL-3 合规，常量自定 |
| D-004 | TTL + signature 双失效 + advisory lock | 兼顾新鲜度与并发 |
| D-005 | dismissed 二级表 + sha256 稳定 key | 跨重算一致性，sparse 成员变化时主动失效（预期行为） |
| D-006 | Deep Research 复用 runRagPipeline | 零 Agent 改动 |
| D-007 | 路由 ACL 双重保护 | R8 风险缓解 |
| D-008 | 四类降级路径 | KG 不可用 / 图过大 / Louvain 抛 / Space 空 各自 graceful |
| D-009 | 新路由 `/insights`，不耦合 DetailGraph | per-Space vs per-asset 心智分离 |

## §四 · 衍生 Open Questions

新增 3 条 OQ-GI-FUTURE-* 进 `open-questions.md`：

- **OQ-GI-FUTURE-1** — 跨 Space 全局视图（Admin）触发条件
- **OQ-GI-FUTURE-2** — Notebook 级洞察下钻
- **OQ-GI-FUTURE-3** — Dismissed 列表管理 UI

均为"可选 v2"，不阻塞当前归档。

## §五 · 复盘要点

- **流程纪律有效**：CLAUDE.md "每次会话第一句写工作流名"在第二轮交互被显式强制（用户最初没写工作流名，被反向追问），帮助规避了"直接跳进代码"的反模式。
- **Lock 阶段抓 drift**：design.md 写 `metadata_space` 时被 pgDb.ts 的实际表名 `space` 当场打脸——Lock 阶段贴着真实代码写契约的价值再次被印证（ADR-40 复盘也说"5 处左右 drift"）。
- **mockup 优先**：用户在 Execute 前要求看图片预览，导致 MiniGraph 从"v2 议题"提前到 v1。这一变更在尚未合并契约时进入还相对便宜（动 tasks.md 一行 + 后续多写 1 个组件）；若 Lock 已合并合并后才加，就要走"工作流 A 提 change request"。
- **GPL-3 合规边界**：在 Explore 阶段就明确"概念级重写、不引源代码"；权重常量自定也是合规延伸。这条 ADR-41 D-003 写明，给未来类似借鉴留范本。
- **ADR-39 范本可继承**：项目对外部项目借鉴的工艺已经从 WeKnora（ADR-39 全部 OQ 化）演进到 llm_wiki（ADR-41 选其中一项落实）。范本核心：先借鉴度对照、用户挑选、再决定走 OQ 还是工作流 B。

## §六 · 不动清单（与 graph-insights 无依赖）

- AGE schema（ADR-27）
- pgvector / MySQL 真相源（Q-002）
- ragPipeline / hybridSearch / agent dispatch
- DetailGraph 的 SVG 环形布局
- 既有的 ingest pipeline / file-source / BookStack 同步
