# Spec: 资产/MCP UI

## /api/asset-directory/:id/detail

**Scenario: 已存在 asset 返完整结构**
- Given metadata_asset id=42 存在；其下有 5 chunk_level=1 + 30 chunk_level=3 + 2 张图
- When GET /api/asset-directory/42/detail
- Then 200，body 含 asset/source/chunks{headings,samples,total}/images/graph
- And graph.nodes.length >= 5（mock）

**Scenario: 不存在 → 404**
- When GET /api/asset-directory/99999/detail
- Then 404 `{error:'not found'}`

---

## /api/mcp/debug-query

**Scenario: 任意 SQL 都返 mock 结果（MVP）**
- When POST body `{source:'ERP-MySQL', sql:'SELECT 1'}`
- Then 200, body.ok=true, authCheck.passed=true, rows is non-empty array, durationMs is number

**Scenario: 缺 source/sql 返 400**

---

## /api/graph/cypher

**Scenario: mock 响应**
- When POST body `{query:'MATCH (n) RETURN n LIMIT 5'}`
- Then 200，nodes/edges 都是数组

---

## 前端 /assets 列表

**Scenario: 默认显示卡片网格**
- Given fetchAssetItems 返 N 个 asset
- Then 渲染 N 个卡片，每个含名称/类型徽标/状态

**Scenario: 类型 Pill 切换**
- Given 4 个 Pill：全部 / 结构化 / 文件型 / 在线文档
- When 点击"结构化"
- Then 仅显示 type='structured' 的卡片

**Scenario: 点击卡片跳详情**
- Then navigate('/assets/:id')

---

## 前端 /assets/:id 详情

**Scenario: Banner 显示 asset 信息**
- Given assetId=42 fetch detail 成功
- Then Banner 含名称、类型、tags、updated_at

**Scenario: 默认 Tab "资产列表"**
- Then 切到 Tab 1 表示 chunks.headings 列表

**Scenario: 切 Tab 2 RAGFlow**
- Then 显示 chunks.samples 前 10 条 + 概述卡

**Scenario: 切 Tab 3 图谱**
- Then 渲染 SVG，含 5+ 节点和边
- And 节点 hover 显示 tooltip

**Scenario: detail 加载错误**
- Given 404
- Then 显示空态 / 重试

---

## 前端 /mcp 重写

**Scenario: 4 KPI 卡同时展示**
- Then 看到 MCP数据源 / Skill文档源 / RAGFlow / Neo4j 四卡

**Scenario: SQL 调试**
- When 输入 `SELECT 1` + 选 source + 点执行
- Then 显示授权链路 + mock rows + duration

**Scenario: Cypher 调试**
- When 输入 cypher + 执行
- Then 显示 nodes/edges JSON

**Scenario: 三态：error 重试**
- API 返 500 → 错误提示 + 重试按钮
