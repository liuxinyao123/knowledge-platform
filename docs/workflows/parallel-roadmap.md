# 并行执行路线图（未开发功能 TODO）

> 截至 2026-04-21，三轮 Execute 已完成：`knowledge-qa` · `unified-auth` · `agent-orchestrator`。
> 本文档把剩余未完成内容拆为**可并行的 Track**，每 Track 声明范围 / 依赖 / 产出 /
> 建议走的 workflow 命令。

## 总览

```
Track A  StructuredQuery 填坑           ◎ 独立可起
Track B  数据源扩展（B1 飞书 / B2 文件夹扫描）  ◎ 独立可起（B1/B2 互不依赖）
Track C  Neo4j 知识图谱                ◎ 独立可起（最大 / 最久）
Track D  Portal / Agent 控制台 UI       ◎ 独立可起（UI 骨架可先做）
Track E  收尾体验增强（5 个子项）        ◎ 完全独立
Track F  Open Questions 收敛            ◎ 元工作，不阻塞但需决策
```

依赖图（唯一的强依赖）：

```
  Track A ─┐
           │（完成后真实 structured_query 能力上线，Agent 占位可替换）
 D 控制台 ◀┘
```

其余 Track 两两互不依赖，**可同时拉四条并行**。

---

## Track A · StructuredQuery 真实实现

**目标**：让 `StructuredQueryAgent` 从占位升级为真实能力；下游 MCP 接入方
（Claude Desktop / 技能市场）能做结构化查询。

**范围**
- 在 `apps/qa-service` 暴露 `/api/knowledge/schema` 与 `/api/knowledge/query`（只读 SQL）
- 或扩展 `apps/mcp-service` 新增两 tool：`list_tables` / `query_sql`
- 把 Agent 改为真实调用上述能力
- 对接 `unified-auth`（action=READ；含 mask/filter）
- 只读白名单：仅允许 `SELECT`；禁止 DDL/DML；LIMIT 上限 10000

**建议 workflow** `A · openspec-superpowers-workflow`（需求还要澄清）

**提示词卡**
```
Use $openspec-superpowers-workflow to run this feature from clarification through verification.

Feature: 结构化查询能力（MCP structured query + Agent 填坑）
背景：当前 StructuredQueryAgent 是占位。需要给 MCP 消费方和内部 Agent 提供 schema 发现 + 只读 SQL。
需要覆盖：
  - 后端 /api/knowledge/schema、/api/knowledge/query
  - MCP 工具 list_tables / describe_table / query_sql
  - Agent 替换占位实现
  - unified-auth 接入（READ 粒度 + mask）
  - 只读白名单（SELECT only + LIMIT 上限）
请先澄清：
  1) 结构化数据源范围？（只 pg metadata_* / 还是 BookStack MySQL 也要查）
  2) SQL 执行方式？（模板参数 / 任意只读 SQL）
  3) 查询超时策略？
  4) MCP 层要不要同步暴露？
```

**拆解参考（合并后再用 B 流执行）**
- BE-1..5：schema/query route + SELECT-only guard
- BE-6..8：MCP tool 增补
- BE-9：Agent 实现替换
- BE-10：ACL 接入
- TE-1..3：白名单 / 超时 / ACL 集成测试

---

## Track B · 数据源扩展

### Track B1 · 飞书知识库接入

**目标**：`FEISHU_CLIENT_ID / _SECRET` 不再是占位；能把飞书知识库作为
`metadata_source` 灌入 pgvector。

**范围**
- 接入 `lark-oapi` 或自写 OAuth 客户端
- 新 route：`POST /api/sync/feishu`（拉知识库列表 + 分页爬文档 + 走 ingest pipeline）
- 在 `metadata_source` 里创建 type=feishu 的记录
- 定时同步（可选，走 scheduled-tasks）

**建议 workflow** `A · openspec-superpowers-workflow`

**提示词卡**
```
Use $openspec-superpowers-workflow for "飞书知识库数据源接入".

Feature: 飞书知识库作为 metadata_source 灌入 pgvector
背景：infra/.env.example 已有 FEISHU_CLIENT_ID/SECRET 占位，但 qa-service 无任何飞书代码。
需要覆盖：OAuth 客户端；知识库/文档拉取；走现有 ingest pipeline；
         在 metadata_source 建 type=feishu 的记录；增量同步策略。
请先澄清：使用 app_id+app_secret 服务端凭证？增量依据 updated_at 还是 event 订阅？
```

**拆解参考**
- BE-1：`services/feishu.ts` —— 封装飞书 API 客户端（OAuth / fetch）
- BE-2：`routes/sync.ts` 扩展 `/feishu` —— 初次全量 + 增量
- BE-3：metadata_source 建 feishu 记录
- BE-4：增量策略（游标存 `knowledge_sync_meta` 表）
- TE-1..3：mock 飞书 API 的端到端测试

---

### Track B2 · 文件夹扫描 / 文件服务器

**目标**：支持把"一个文件夹"作为 metadata_source 批量 ingest，而不是单文件上传。

**范围**
- 新 route：`POST /api/ingest/scan-folder` 入参 `{ path, recursive, include_glob }`
- 扫描本地路径 / SMB 挂载；对每个文件复用 `ingestExtract` 流水线
- 进度回传 SSE（和 QA pipeline 同一 pattern）
- 文件黑白名单（忽略 .git / node_modules / 二进制超大文件）

**建议 workflow** `B · superpowers-openspec-execution-workflow`（比飞书轻，契约已经清楚）

**提示词卡**
```
Use $superpowers-openspec-execution-workflow for "文件夹扫描批量 ingest".

Feature: /api/ingest/scan-folder —— 本地路径递归 ingest
需要实现：递归遍历 + glob 过滤 + 黑白名单 + SSE 进度；复用 services/ingestExtract.ts。
前置依赖：ingestExtract pipeline（已稳定）；metadata_source / metadata_asset 表（已稳定）。
跳过澄清，按四步走。
```

---

## Track C · Neo4j 知识图谱

**目标**：架构图里"知识图谱"方块落地。

**范围**
- `infra/docker-compose.yml` 新增 neo4j 服务
- `apps/qa-service/src/services/graph.ts` —— neo4j-driver 客户端
- 实体抽取（复用 LLM tool-call）：从 `metadata_field` 批量抽出实体 / 关系
- 三张概念表 / 图结构：Entity / Relation / AssetLink
- `/api/knowledge/graph/search` —— 按实体名找相关 assets
- 融入 RAG：作为 Step 1.5 "图谱命中补充"

**建议 workflow** `A · openspec-superpowers-workflow`（这是 P0 级新大块，需求还要澄清）

**提示词卡**
```
Use $openspec-superpowers-workflow for "Neo4j 知识图谱子系统".

Feature: 知识图谱模块（实体抽取 + 关系图 + 查询）
背景：架构图中"知识图谱"方块当前零实现。需要从 metadata_field 抽实体关系，
     在 Neo4j 中建图，并接入 RAG 作为补充检索。
请先澄清：
  1) 实体抽取用本地规则 / LLM / 预训练 NER？
  2) 关系类型开放 vs 固定本体？
  3) Neo4j 部署：容器 vs Aura 托管？
  4) 是否做图可视化？
  5) Agent 层是否加 GraphAgent，还是只作为 RAG 补充？
```

⚠️ 这是最大一块，预估 ≥ 10 人天。先决策 Q 再做。

---

## Track D · Portal / Agent 控制台 UI

**目标**：架构图最顶部"Portal / Agent UI"独立页面。

**范围**
- 新增 route `/agent`（在 `apps/web/src/knowledge/` 或顶级 `/agent`）
- 面板：
  - 左 · 对话流（复用 QA 气泡组件）
  - 中 · Dispatch 轨迹可视化（agent_selected / 每步耗时 / 命中 agent / confidence）
  - 右 · 工具调用 & trace 详情
- 支持强制 `hint_intent` 下拉
- 历史 session 列表（localStorage 维度）

**建议 workflow** `C · superpowers-feature-workflow`（纯 UI，无跨人契约）

**提示词卡**
```
Use $superpowers-feature-workflow to drive the Superpowers stages for this feature.

Feature: Agent 控制台（/agent 路由）
所在页面：顶层 /agent；复用 KnowledgeTabs 布局
需要实现：
  - 对话流（复用 QA AiBubble）
  - Dispatch 轨迹可视化（消费 agent_selected 事件，时间轴渲染）
  - hint_intent 下拉强制路由
  - history session 列表（localStorage kc_agent_sessions）
Tech stack: React + Tailwind。
跳过 OpenSpec 归档，完成验证后直接关闭任务。
```

---

## Track E · 体验增强（5 个独立子项，任选并行）

这些互不依赖，每个都是小改动。可以开 5 个并发分支。

### E1 · 标签提取 service
- 产出：`apps/qa-service/src/services/tagExtract.ts`（LLM tool-call，输出 `string[]`）
- 挂到 `ingestExtract` 末尾，把 tag 写进 `metadata_asset.tags`
- **Workflow C**

### E2 · OCR 独立化
- 替换 officeparser 内置 OCR 为 `tesseract.js`
- `.env` 增 `OCR_LANGS=chi_sim+eng`
- **Workflow C**

### E3 · mcp-service 缺失测试
- 补 `apps/mcp-service/__tests__/search_knowledge.test.ts` 与 `get_page_content.test.ts`
- 跑通后更新 `openspec/changes/mcp-service/tasks.md` 勾掉
- **直接写**（已有 OpenSpec spec.md 场景清单）

### E4 · 前端 pre-existing TS 错误清理
- 具体错误：
  - `KnowledgeTabs.test.tsx` 未用 import
  - `Ingest/index.tsx` ExtractIngestResponse 联合类型未收窄
  - `TreeNode.test.tsx` / `TreePane.test.tsx` `selectedPageUrl` prop 名错
  - `Search/index.test.tsx` 未用 `waitFor`
  - `QA/index.test.tsx` 已在 Round 1 修掉
- **Workflow C** 或直接修（各 5-10 分钟）

### E5 · `pdf-parse` default import 修复
- `apps/qa-service/src/routes/knowledgeDocs.ts:58`
- 改为 `const { default: pdfParse } = await import('pdf-parse')` 或改用 `pdf-parse/lib/pdf-parse.js`
- 或换 `pdfjs-dist`
- **直接修**

---

## Track F · Open Questions 收敛（并行进行，不阻塞代码）

这些不是 code task，但如果不决就会延迟或推翻某些 Track。

| ID | 问题 | 影响 | 建议处理方式 |
|---|---|---|---|
| Q-001 | RBAC Token 是否走 BookStack OIDC？ | unified-auth 生产配置 | 短会决策；若走 OIDC 要在 BookStack 启用；否则 HS256 自签即可 |
| Q-002 | pgvector / MySQL source-of-truth | Track B2 / Track C 数据模型 | Round 1 已初定 pgvector = RAG 源头；Q-002 可关闭一半，剩下"MySQL 用途"要文档化 |
| Q-003 | 审批队列复用 Mission Control？ | 若未来做审批 UI | 非紧急，可暂缓 |

**Workflow**：无，属于 ADR 产出。每关闭一个写一条 `.superpowers-memory/decisions/<date>-NN-*.md`。

---

## 并行编排建议（一个实际的排兵方式）

假设你有若干时间并行做四件事，我给一个推荐顺序：

### 并行组 1（立刻起，无需决策）
- **Track E1 + E2 + E3 + E4 + E5** —— 5 个小收尾，半天内可全清
- **Track B2** —— 文件夹扫描，契约清晰
- **Track D 骨架** —— 控制台 UI 框架（无需后端新能力）

### 并行组 2（需要一次决策会就能起）
- **Track A** —— 决策 Q1（结构化数据源范围）+ Q3（超时策略）→ 开工
- **Track B1** —— 决策 Q1（增量方式）→ 开工

### 并行组 3（大块，需要立项会）
- **Track C Neo4j** —— 决策 5 个 Q → 独立立项，2 人周起步

### 并行组 4（元工作）
- **Track F** 全部 Open Questions 在下次周会过掉，产出 ADR

---

## 启动模板（复制粘贴即可）

每条 Track 起新会话时，第一句必须包含 workflow 名。模板如下：

```
Use $<workflow-name> for "<feature name>".

Feature: <feature>
背景：<为什么做 / 现状>
需要覆盖：<交付清单>
前置依赖：<已完成的 change 目录>
请先澄清：<问题列表> （如果是工作流 A）
```

---

## 产物去处

| 工作流 | 草稿（Explore） | 契约（Lock） | 实现计划 |
|---|---|---|---|
| A / B | `docs/superpowers/specs/<feature>/` | `openspec/changes/<feature>/` | `docs/superpowers/plans/<feature>-impl-plan.md` |
| C | `docs/superpowers/specs/<feature>/`（仅 design） | 无 | `docs/superpowers/plans/<feature>-impl-plan.md` |
| D | `docs/superpowers/specs/<feature>/`（仅 design） | `openspec/changes/<feature>/` | 无 |

归档：通过验证后，把 `docs/superpowers/specs/<feature>/` 移到 `docs/superpowers/archive/<feature>/`。

---

## 快速回答（FAQ）

**Q：我能一次同时跑多少 Track？**
A：不同 Claude Code 会话互不干扰，硬件允许的话开 4-6 条完全没问题。但要避免同时改同一文件（比如两条 Track 都要改 `index.ts`），约定改动顺序。

**Q：Track 之间要怎么切？**
A：每个 Track 第一句明确写工作流名称（如 `$superpowers-feature-workflow`），AI 就会切换行为模式。

**Q：怎么知道某条 Track 可以开工？**
A：看它的"前置依赖"。Track A/B/C/D/E/F 都标清了依赖；当前除了 A 被 D 依赖外，其他都可以立刻开工。

---

## 里程碑（最后更新 2026-04-21）

| ID | 内容 | 状态 |
|----|------|------|
| **M1（小收尾）** | Track E1-E5 + Track F 三个 Q 关闭 | ✅ **已达成** |
| **M2（数据源完备）** | Track B1 飞书 + B2 文件夹扫描 | 🟡 **B2 ✅；B1 飞书未做** |
| **M3（结构化能力）** | Track A StructuredQuery 真实实现 | ⬜ 未做（等 MCP 结构化层 change） |
| **M4（全栈 UI）** | Track D Agent 控制台 | ✅ **已达成** |
| **M5（图谱）** | Track C Neo4j | ⬜ 未做（最大块；需立项会） |

## 已完成的 Change（截至 2026-04-21）

按落地顺序：

| 序 | Change | 一句话 | OpenSpec |
|----|--------|--------|----------|
| 1 | knowledge-qa | RAG 切 pgvector + history + session_id | ✅ |
| 2 | unified-auth | Principal + ACL 引擎 + DEV BYPASS | ✅ |
| 3 | agent-orchestrator | dispatch + 4 Agent + SSE agent_selected | ✅ |
| 4 | M1 cleanup（E1-E5 + F） | tagExtract / OCR / 前端 TS 清零 / pdf-parse / 3 ADR 关 Q | — |
| 5 | B2 folder-scan | `/api/ingest/scan-folder` SSE 批量 | — |
| 6 | D agent-console | `/agent` 路由三栏布局 | — |
| 7 | pdf-pipeline-v2 | opendataloader-pdf + 可选 VLM 图意 | ✅ |
| 8 | ingest-pipeline-unify | 单一 ingestDocument 入口 + 统一 ACL WRITE | ✅ |

## 下一批可起的并行组合（剩余 Track）

| Track | 状态 | 决策门槛 |
|---|---|---|
| **A** StructuredQuery | 待开决策会 | 4 个澄清问题 |
| **B1** 飞书接入 | 待开决策会 | 1 个问题（凭证 + 增量） |
| **C** Neo4j 图谱 | 待立项 | 5 个问题（最大投入） |

辅助清理（小）：
- 真正下线 MySQL `knowledge_chunks` 老路径（目前是双写）
- docx zip 内嵌图抽取
- xlsx per-sheet 切片
- async 任务队列（202 + 状态）

---

## PRD 补全路线图（基于 知识中台产品需求文档 v1.0）

收到 PRD 后梳理出剩余的 7 个 change（按工作流 A 拆分）：

| 序 | Change | 范围 | 依赖 | 备注 |
|---|---|---|---|---|
| **G1** | `knowledge-governance` | 标签体系 / 重复检测 / 质量评分 / 审计日志 | 无 | **本轮在做** |
| **G2** | `unified-auth-permissions` | 把 unified-auth 的 role 模型升级为 permissions（兼容现有 role） | unified-auth | PRD §2 |
| **G3** | `permission-rule-editor` | 数据权限管理 + 规则编辑器三栏 + 命中说明 | G2 | PRD §11-13；UI 占位 + 后端规则 CRUD |
| **G4** | `iam-panel` | IAM 5 Tab：用户 / 角色 / OIDC / DSClaw 信任 / 角色映射 | G2 | PRD §15；登录留 DEV BYPASS |
| **G5** | `asset-detail-page` | 资产详情页三 Tab（资产列表 / RAGFlow 摘要 / Neo4j 图谱占位） | 无 | PRD §10；图谱用 SVG mock |
| **G6** | `ingest-ui-rich` | 入库 4 入口（上传/抓取/沉淀/批量）+ 6 步流水线可视化 + 表格预览 | ingest-pipeline-unify | PRD §7 |
| **G7** | `mcp-skill-panel-extend` | MCP 调试区 / Skill 文档源 / RAGFlow + Neo4j 占位 | 无 | PRD §14 |
| **G8** | `dsclaw-task-knowledge-drawer` | DSClaw 任务内知识检索抽屉 | 无 | PRD §16；DSClaw 集成 |

**后续大块（标黑色为外部依赖）**：
- 真接 **Neo4j**（替换图谱占位）—— Track C 路线
- 真接 **RAGFlow**（或彻底文档化"我们用 pgvector + 自实现 RAG"）—— ADR 决策
- 飞书 SSO + 钉钉 SSO + 企业微信（PRD §3）

**预估**：8 个 change 全部跑完后 PRD 实现度 ~85%（剩 Neo4j/RAGFlow/SSO 这些外部依赖块）。
节奏：每个 change 半天到一天；并行 2-3 条可三天内完成 G1-G8。
