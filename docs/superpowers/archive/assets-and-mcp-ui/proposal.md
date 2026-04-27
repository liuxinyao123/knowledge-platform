# Proposal: 资产目录/详情 + MCP 接入层 UI（PRD §10 + §14）

## Problem

PRD §10（资产目录 / 资产详情）与 §14（数据接入 MCP / Skill）现状：

- §10.2 资产列表页 **无独立入口**；仅治理子 Tab 有占位
- §10.3 **资产详情页完全缺失**（无 3 Tab：资产列表 / RAGFlow 摘要 / Neo4j 图谱）
- §14 `/mcp` 页 **仅基础 Mcp tool 状态**；缺 KPI 看板 / SQL 调试区 / Skill 文档源 / RAGFlow 状态 / Neo4j 状态

## Scope（本 Change）

### G5 — 资产目录与详情页（PRD §10）

1. **新路由** `/assets`（列表）+ `/assets/:id`（详情）
2. **列表页** 按 PRD §10.2：类型 Pill 筛选、资产卡片双列网格（图标 + 名称 + 状态徽标 + 元信息三栏）
3. **详情页** 按 PRD §10.3：Banner + 3 Tab
   - Tab 1 资产列表 — 子资产（metadata_field 聚合按 chunk_level=1 的 heading 展示）
   - Tab 2 RAGFlow 摘要 — 数据源概述卡 + chunks 列表（metadata_field 的 L3 chunks）
   - Tab 3 知识图谱 — **SVG mock**（Q3=c 不接真实 Neo4j）；5-8 个节点 + 边
4. **后端** 新端点 `GET /api/asset-directory/:id/detail` — 返 asset + 聚合 chunks + mock graph nodes
5. 顶部 `KnowledgeTabs` 新增"资产"入口（用 RequirePermission 包 `assets:view`）

### G7 — MCP 数据接入层扩展（PRD §14）

1. 重写 `/mcp` 页（保留现有信息）按 PRD §14：
2. **连接总览 KPI**（4 卡）：MCP 数据源 / Skill 文档源 / RAGFlow（mock）/ Neo4j（mock）
3. **MCP 查询层** — 数据源列表 + 字段管控表 + **SQL 调试区**（输入 + 数据源选择 + 执行按钮 + 结果回显，后端 mock 一个"授权检查 + 返 sample rows"）
4. **Skill 文档源** — 列表 + 4 能力卡（目录扫描/原文读取/轻量解析/标签提取）
5. **RAGFlow 实例** — 4 指标（模型/维度/切片数/P95，mock 数据）+ 今日 8 段柱状图 mock
6. **Neo4j 实例** — 4 指标 + Cypher 调试区（mock 响应）
7. **后端** 新端点（两个全 mock）：
   - `POST /api/mcp/debug-query` — 返假结果 + 授权链路说明
   - `POST /api/graph/cypher` — 返假图数据

## Out of Scope

- Neo4j / RAGFlow 真实接入（Q3=c 推迟）
- 资产详情页的"配置权限"入口真联动 G3 rule editor（本 change 只放链接占位）
- 资产卡片分页（初期全量拉）
- MCP 真实 SQL 执行 / 权限裁剪链路（mock）

## 决策记录

- D-001 /assets 列表页与 /governance 的资产 Tab 共享数据源 `metadata_source + metadata_asset`；双入口并存，列表页是主入口
- D-002 详情页的"RAGFlow 摘要"其实就是展示 pgvector metadata_field chunks（PRD 要求的叙事型描述由 LLM 未来生成）
- D-003 Neo4j 图谱用纯 SVG mock：5-8 节点硬编码演示，后续真 Neo4j 接入时只替换 DetailGraph 组件
- D-004 MCP 调试区的"授权通过/拒绝/行过滤条件/字段脱敏"显示 mock 文案；等 G3 完成后可连真规则
- D-005 所有需要 `permission:manage` 的操作入口都用 `<RequirePermission>` 包
