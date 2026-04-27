# 资产目录模块 — 详细设计

> 本文在参考《Claw 对话 + 右侧资产工作台》产品设想的基础上，与当前 **knowledge-platform** 仓库实现（BookStack、qa-service、Web 问答、治理、入库/解析、向量同步）对齐，给出可落地的模块设计。文中 **「Claw 对话」** 对应本仓库 **Web 端「问答」主界面**（`/qa`）；后续若独立 Claw Shell，本设计仍适用，仅需替换宿主容器。

---

## 1. 模块目标

资产目录用于统一管理平台内 **数据源** 与 **数据资产**，并以 **右侧工作台（Drawer / Panel）** 形式嵌入对话主界面，使用户 **不离开对话上下文** 即可查看与管理资产。

核心目标（与参考设计一致，略作工程化表述）：

1. **非阻塞入口**：在问答主界面提供资产目录入口（如右上角图标）；打开/关闭工作台 **不刷新、不重载** 左侧对话区。
2. **两级信息架构**：先 **按数据源** 浏览，再进入 **数据源详情**（资产列表、RAG/摘要状态、图谱映射状态等）。
3. **预处理结果承载**：目录展示的是 **预处理/索引管道产出**（摘要、标签、映射状态、异常），**不把预处理做成独立 C 端大页面**；管道以 qa-service 任务、Skill 或内部 Job 形式运行。
4. **Agent 协作**：支持通过 **「数据管理员专家」**（专用 System Prompt + 工具集）用自然语言完成查询、跳转、状态解释；必要时 **驱动右侧工作台定位**（高亮数据源/资产）。

---

## 2. 模块定位

| 维度 | 说明 |
|------|------|
| **宿主** | 嵌入 **问答页**（`/qa`）右侧；左侧保持会话列表 + 消息流 + 输入框。 |
| **与权限** | 数据源、资产、标签是 **治理/权限规则** 的作用对象；列表与详情 API **必须按用户/角色过滤**（继承现有 `knowledge_user_roles`、BookStack Token 能力边界）。 |
| **与专家** | 「数据管理员专家」的默认可操作范围 = 当前用户可见的数据源与资产子集。 |
| **与技能** | 文档访问、BookStack 代理、ingest 解析、sync 向量等 Skill **声明绑定的 source_id / asset_id**（或 BookStack 实体映射），与目录一致。 |
| **与现有「治理」页** | 治理页（`/governance`）侧重 **成员与空间策略**；资产目录侧重 **数据源—资产—增强知识映射**，二者在导航上 **并列**，数据上 **可引用同一套 metadata 表**。 |

---

## 3. 与当前仓库的映射（现状 → 目标）

| 概念 | 当前实现 | 资产目录中的角色 |
|------|----------|------------------|
| 在线文档源 | BookStack（Shelves/Books/Pages） | **数据源类型**：`bookstack`；书籍/页面映射为资产或资产组 |
| 文件入库 | Web `/ingest` + qa-service `/api/ingest` | 产出 **文件型资产** 的解析状态、摘要占位 |
| 向量/RAG | `knowledge_chunks`、RAG 管道、BookStack 搜索回退 | **RAGFlow 映射**：索引状态、chunk 数量、最近同步时间 |
| 知识图谱 | 未实现 | **预留** `metadata_knowledge_link.graph_mapping_id`；一期可展示「未接入」 |
| 结构化 DB | BookStack MySQL 已共用；业务库未接 | **二期** `metadata_source.type = rdbms` + schema 发现任务 |
| MCP | `apps/mcp-service` | 可作为 **结构化/外部源** 的统一访问入口之一 |

---

## 4. 交互模式

### 4.1 主体布局

- **左侧**：现有 QA 对话 UI（不变）。
- **右侧**：可折叠 **资产目录工作台**（宽度建议 380px～480px，大屏可调）。
- **入口**：问答页顶栏 **资产目录图标**；点击切换 Drawer 开/关。

### 4.2 核心原则（必须满足）

1. 打开/关闭资产目录 **不改变** 左侧 messages state、不重新请求历史会话（除非用户主动刷新会话）。
2. 在右侧切换数据源、Tab **不打断** 当前流式输出（SSE）。
3. 二级详情为 **同 Drawer 内路由**（内部 state 或 `/qa?assetPanel=source:123` 的 shallow 状态），避免整页跳转。

### 4.3 Agent 联动（行为契约）

- 用户在左侧 @数据管理员专家 发起指令后，后端/工具可返回 **结构化指令**：`{ action: 'open_asset_panel', sourceId?, assetId?, tab? }`。
- 前端 **订阅** 该元数据（经 SSE 事件或独立 `postMessage` 通道），更新 Drawer：打开、选中数据源、切换 Tab、滚动到资产行。
- **不强制** 每次对话都打开右栏；仅在有展示需求或用户显式要求时展开。

---

## 5. 页面结构

### 5.1 一级视图：数据源列表

**展示字段（建议）**

| 字段 | 说明 |
|------|------|
| 名称 | `source_name` |
| 类型 | `source_type`（bookstack / fs / rdbms / feishu / …） |
| 所属系统 | `system_name` |
| 状态 | `status`（healthy / degraded / indexing / error） |
| 最近更新时间 | `updated_at` |
| 资产数量 | `asset_count`（冗余计数，定时任务刷新） |

**操作**：搜索、类型筛选、状态筛选、点击进入二级详情。

### 5.2 二级视图：数据源详情

建议 **Tab 分区**（与参考设计一致）：

1. **资产列表**  
   - 表 / 字段 / 文件 / 文档（按 `asset_type` 分栏或过滤器）。  
   - 对本仓库：优先 **文档（BookStack Page）**、**附件**、未来 **表/字段**。

2. **RAG / 摘要**  
   - 文档级摘要（来自预处理或 LLM）、关键片段列表、检索标签、**索引状态**（已入 `knowledge_chunks` / 未入 / 失败原因）。

3. **知识图谱**  
   - 实体、类型、关系、关联资产；**一期** 可占位 + 只读「映射状态」字段。

4. **元信息**  
   - 标签、业务说明、**映射状态**（vector / graph / feishu link）、异常信息。

---

## 6. 数据预处理（内置能力）

### 6.1 原则

- **无独立「预处理首页」**；用户在目录中看到 **状态与结果列**（是否有摘要、是否已向量化、图谱是否已映射）。
- 管道任务：目录扫描、类型识别、OCR、表格提取、轻量解析、标签与摘要生成、**写回 `asset_*` 元数据表**与向量表 `knowledge_chunks`。

### 6.2 与现有能力衔接

| 能力 | 现状 | 目录中的体现 |
|------|------|--------------|
| 文档解析 | `/api/ingest` + officeparser | `asset_item.ingest_status`、`summary` 渐进填充 |
| 全量同步 | `POST /api/sync/run` | 数据源级 `last_index_at`、`chunk_count` |
| 摘要生成 | 可新增异步 Job 调 LLM | `asset_item.summary`、`summary_status` |

### 6.3 数据源类型与策略（摘要）

与参考文档 8.3 对齐；落地时 **按 `source_type` 注册 Handler**（策略模式），输出统一写入 **资产 + link 表**。

---

## 7. 数据模型设计

在 **BookStack 同一 MySQL**（与 `knowledge_chunks` 一致）新增元数据表；命名空间前缀 `asset_` 以避免与现有 `knowledge_*` 混淆。

### 7.1 `asset_source`（数据源）

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK | |
| name | VARCHAR(255) | |
| source_type | ENUM/VARCHAR | bookstack, filesystem, rdbms, feishu, … |
| system_name | VARCHAR(255) | 展示用 |
| config_json | JSON | 连接配置、BookStack 无敏感引用 id 等（密钥走 env） |
| status | VARCHAR(32) | healthy / degraded / … |
| asset_count | INT | 缓存 |
| created_at / updated_at | TIMESTAMP | |

**初始化策略**：可插入一条 `source_type=bookstack` 的默认源，与当前 `BOOKSTACK_URL` 对应。

### 7.2 `asset_item`（资产）

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK | |
| source_id | FK → asset_source | |
| external_ref | VARCHAR(512) | 如 `bookstack:page:123` |
| name | VARCHAR(512) | |
| asset_type | VARCHAR(64) | table, column, file, document, … |
| project_tag / domain_tag | VARCHAR(128) | 可选 |
| summary | TEXT | |
| summary_status | VARCHAR(32) | pending / ok / failed |
| ingest_status | VARCHAR(32) | 与解析/入库对齐 |
| updated_at | TIMESTAMP | |

### 7.3 `asset_field`（结构化字段，二期）

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK | |
| asset_id | FK → asset_item（表级资产） | |
| column_name | VARCHAR(255) | |
| data_type | VARCHAR(64) | |
| description | TEXT | |
| … | | |

### 7.4 `asset_tag`

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK | |
| tag_type | VARCHAR(32) | project / domain / business / … |
| tag_value | VARCHAR(255) | |
| item_id | FK → asset_item | |

### 7.5 `asset_knowledge_link`（增强能力映射）

| 列 | 类型 | 说明 |
|----|------|------|
| id | BIGINT PK | |
| item_id | FK → asset_item | |
| vector_mapping_id | VARCHAR(128) | 如 chunk 集合或 sync job id |
| graph_mapping_id | VARCHAR(128) | Neo4j 节点/边批次 id，可空 |
| mapping_type | VARCHAR(32) | rag / graph / hybrid |
| status | VARCHAR(32) | ok / pending / error |
| last_error | TEXT | |

**与现有表关系**：`knowledge_chunks.page_id` 可与 `asset_item.external_ref` 中 BookStack page id 对齐；同步任务写 link 时更新 `vector_mapping_id` 与 `status`。

---

## 8. 后端 API 设计（qa-service）

建议统一前缀：`/api/asset-directory`（或 `/api/assets`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sources` | 列表 + 筛选 + 分页 |
| GET | `/sources/:id` | 详情 + 聚合统计 |
| GET | `/sources/:id/items` | 资产列表 |
| GET | `/items/:id` | 单资产详情（含 link） |
| GET | `/items/:id/rag-summary` | 摘要 + 片段 + 索引状态（可聚合 chunk 表） |
| GET | `/items/:id/graph` | 图谱子图（一期可 501 + message） |
| POST | `/internal/reindex-hook` | 可选，供预处理回调 |

**权限**：中间件读取当前用户（未来 OIDC / 会话）；与 BookStack Token 角色对齐前，可先 **与 governance 角色同源**，禁止跨租户 source。

**Agent 工具**：为「数据管理员专家」注册 MCP/Function tools：`list_sources`、`get_source`、`list_items`、`explain_asset_status`，内部即调用上述 HTTP。

---

## 9. 前端实现方案（apps/web）

### 9.1 组件拆分

| 组件 | 职责 |
|------|------|
| `AssetDirectoryToggle` | 顶栏图标 + 打开状态 |
| `AssetDirectoryDrawer` | 右侧容器、宽度、与 QA 布局 flex |
| `SourceListPanel` | 一级列表 + 筛选 |
| `SourceDetailView` | 二级：Tab 容器 |
| `AssetListPanel` | 资产表 |
| `RagSummaryPanel` | 摘要 + 片段 + 索引状态 |
| `KnowledgeGraphPanel` | 图谱占位/二期 |
| `useAssetDirectoryStore` | 开关、选中 source/item、当前 tab、Agent 定位 payload |

### 9.2 状态与路由

- 全局 UI：`assetDrawerOpen: boolean`。
- 选中态：`selectedSourceId`, `selectedItemId`, `detailTab: 'assets' | 'rag' | 'graph' | 'meta'`。
- 可选：URL query `?adSource=&adItem=&adTab=` 便于分享与刷新恢复（不触发左侧会话重载）。

### 9.3 与问答联动

- QA 页布局改为左右分栏：左侧 `min-width` 保证对话可用；右侧 `Drawer` 覆盖或挤压由产品设计定（建议 **挤压 + 可拖拽宽度**）。

---

## 10. 核心用户流程（与参考对齐）

1. 用户点击资产目录图标 → 右侧展开 → 左侧对话不变。  
2. 用户点击数据源 → 右侧进入详情 Tab → 左侧仍可输入。  
3. 用户 @数据管理员专家 → Agent 调工具 → 返回定位指令 → 前端打开 Drawer 并选中对应源/资产。  

---

## 11. 风险与注意事项

| 风险 | 缓解 |
|------|------|
| 右侧栏挤压导致 QA 可读性差 | 默认窄宽 + 可折叠；小屏默认关闭 Drawer |
| 元数据与 BookStack 不一致 | `external_ref` 规范 + 定时对账任务 |
| 图谱/RAG 未就绪却强展示 | Tab 内明确「未接入」与 roadmap |
| 敏感配置进 `config_json` | 仅存 id/路径；密钥只放 env |

---

## 12. 实施分期建议

| 阶段 | 范围 |
|------|------|
| **MVP** | `asset_source` + `asset_item` + BookStack 同步脚本；列表/详情仅文档资产；RAG Tab 读 `knowledge_chunks` 计数与 `sync/health`；图谱 Tab 占位 |
| **P1** | 摘要字段流水线、标签表、Agent 工具 + 前端定位协议 |
| **P2** | 结构化源 MCP、asset_field、Neo4j 映射展示 |
| **P3** | 飞书等在线源 Handler |

---

## 13. 文档与后续工件

- 本文件：**详细设计**（`design.md`）。  
- 后续可拆：`proposal.md`（立项）、`spec.md`（验收用例）、`tasks.md`（迭代任务）。  
- 与现有 **治理 RBAC**、**ingest**、**sync** 方案并列，避免重复造表时引用本文 **§7**。  
- **落地时请同步阅读 §14**，按本仓库路径改代码与配置。

---

## 14. 本仓库对接清单（knowledge-platform）

以下条目把「资产目录」**钉死**到当前 monorepo 的目录、路由与数据层，实施时按行勾选即可。

### 14.1 仓库与运行时

| 项目 | 路径 / 说明 |
|------|-------------|
| 前端 | `apps/web` — React + Vite + React Router |
| 问答宿主页 | `apps/web/src/knowledge/QA/index.tsx` — **右侧 Drawer 挂载点** |
| 全局路由 | `apps/web/src/App.tsx` — `/qa` 已存在；资产目录 **不新增顶层路由**，仅嵌入 QA |
| 顶栏布局 | `apps/web/src/components/Layout.tsx` — 若入口做在全局，可在此加 icon；**推荐仅在 QA 页顶栏**加「资产目录」避免其它页干扰 |
| BFF / API | `apps/qa-service` — Express，`apps/qa-service/src/index.ts` 挂载路由 |
| 代理 | `apps/web/vite.config.ts` — 已有 `/api/bookstack`、`/api/qa`、`/api/governance`、`/api/sync`、`/api/ingest`；**新增** `/api/asset-directory` → `http://localhost:3001`（与现有 `apiProxy` 并列） |
| 环境变量 | 与治理、向量共用 **`apps/qa-service/.env`** 中的 `DB_*`、`BOOKSTACK_*`；无需新库，**同库不同表** |
| 容器 | `infra/docker-compose.yml` 中 `qa_service` — 发布新接口时 **重建镜像**；`bookstack_db` 的 MySQL 即 `asset_*` 表所在实例 |

### 14.2 数据层（与现有迁移同模式）

| 项目 | 路径 / 约定 |
|------|-------------|
| 连接池与迁移 | `apps/qa-service/src/services/db.ts` 的 `runMigrations()` — **追加** `CREATE TABLE IF NOT EXISTS asset_source / asset_item / …`（与 §7 一致） |
| 向量与同步 | `knowledge_chunks`、`knowledge_sync_meta` — **只读关联**：按 `page_id` 与 `asset_item.external_ref`（`bookstack:page:{id}`）对齐 |
| 治理 | `knowledge_user_roles`、`knowledge_shelf_visibility` — 权限过滤时 **可 join 或复用** `govApi` 同一用户模型（后续接登录后） |

### 14.3 后端模块落点（qa-service）

| 能力 | 建议路径 |
|------|----------|
| 资产目录 REST | 新建 `apps/qa-service/src/routes/assetDirectory.ts`，`Router` 挂到 `app.use('/api/asset-directory', …)`（与 `ingest.ts`、`sync.ts` 并列） |
| BookStack 读 | 复用已有 `apps/qa-service/src/services/bookstack.ts`，列表/详情 **服务端**拉取，避免浏览器直连 BookStack |
| 同步任务扩展 | `apps/qa-service/src/services/syncWorker.ts` — 全量同步后 **可选**：upsert `asset_item` + 更新 `asset_knowledge_link` |
| 健康/诊断 | 可扩展 `GET /api/sync/health` 或资产路由下 `GET /health`，返回 chunk 数与 `asset_count` 摘要（按需） |

### 14.4 前端模块落点（web）

| 能力 | 建议路径 |
|------|----------|
| API 客户端 | 新建 `apps/web/src/api/assetDirectory.ts` — `baseURL: '/api/asset-directory'` |
| 资产 UI 组件 | 新建目录 `apps/web/src/knowledge/QA/assetDirectory/`（或 `apps/web/src/components/assetDirectory/`）— `Drawer`、`SourceList`、`SourceDetail` 等 §9 组件 |
| 状态 | 优先 `useState` + `useCallback`；若跨 QA 子树复杂再引入轻量 store |
| Agent 定位 | `apps/web/src/knowledge/QA/index.tsx` 消费 SSE 时解析 **扩展事件类型**（如 `asset_panel`），与 `apps/qa-service/src/routes/qa.ts` 约定字段（实施阶段定稿） |

### 14.5 与现有功能边界的调用关系

```
用户 / Agent
    → Web /qa（左侧对话 + 右侧资产 Drawer）
    → /api/asset-directory/*（qa-service，MySQL asset_*）
    → 可选读 BookStack（服务端 axios + Token，同 bookstackProxy 模式或复用内部 client）
    → knowledge_chunks / sync（只读统计 RAG 状态）
    → /api/ingest（解析状态回写 asset_item，异步）
```

| 现有模块 | 与资产目录的关系 |
|----------|------------------|
| `apps/web/.../Ingest` | 入库成功后 **回调或轮询** 更新对应 `asset_item`（MVP 可手动脚本同步） |
| `apps/web/.../Governance` | **不替代** 资产目录；权限策略以后可引用 `source_id` / `item_id` |
| `apps/web/.../SpaceTree` | BookStack **空间树 UI**；资产目录 **数据源视图** 可链到 BookStack URL，二者互补 |
| `apps/mcp-service` | 二期 **结构化源** 工具入口；与 `asset_source.source_type = rdbms` 绑定 |

### 14.6 MVP 最小代码增量（建议顺序）

1. `db.ts` 增加 `asset_source`、`asset_item`（及可选 `asset_knowledge_link`）迁移。  
2. `routes/assetDirectory.ts` + `index.ts` 挂载 + `vite` 代理。  
3. 种子数据：插入默认 `bookstack` 源；脚本或迁移把现有 BookStack books/pages **批量写入** `asset_item`（或首期仅 API 实时拉取 + 不落库）。  
4. `QA/index.tsx` 布局 + Drawer + 列表/详情占位。  
5. RAG Tab：`JOIN` / 子查询 `knowledge_chunks` 按 `page_id` 聚合。  
6. `qa.ts` SSE 增加 `asset_panel` 事件（与数据管理员专家工具联动）。

---

*版本：2026-04-20 · 含 §14 与本仓库路径对齐。*
