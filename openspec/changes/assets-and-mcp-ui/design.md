# Design: 资产/MCP UI

## 前端文件结构

```
apps/web/src/
  ├── knowledge/
  │   ├── Assets/                  —— G5 新模块
  │   │   ├── index.tsx            —— /assets 列表页
  │   │   ├── Detail.tsx           —— /assets/:id 容器（Banner + 3 Tab）
  │   │   ├── DetailAssets.tsx     —— Tab 1
  │   │   ├── DetailRagflow.tsx    —— Tab 2
  │   │   └── DetailGraph.tsx      —— Tab 3 SVG mock
  │   └── Mcp/
  │       └── index.tsx            —— G7 重写
  ├── api/
  │   ├── assetDirectory.ts        —— 扩展 getAssetDetail
  │   └── mcp.ts                   —— NEW
  └── App.tsx                       —— 新路由 /assets, /assets/:id
```

## 新增后端端点（两个 route 文件）

### `routes/assetDirectory.ts` 扩展

```ts
GET /api/asset-directory/:id/detail
  → {
      asset: { id, name, type, path, tags, indexed_at, author?, merged_into? },
      source: { id, name, type, connector },
      chunks: {
        headings: Array<{ page, text, heading_path }>,      // chunk_level=1
        samples: Array<{ page, text, kind }>,               // 前 10 个 level=3
        total: number,
      },
      images: Array<{ page, index, caption? }>,             // metadata_asset_image
      graph: {                                              // Neo4j mock
        nodes: Array<{ id, label, type }>,
        edges: Array<{ from, to, label }>,
      },
    }
```

### `routes/mcpDebug.ts` —— NEW

```ts
POST /api/mcp/debug-query
  body: { source: 'ERP-MySQL' | ..., sql: string }
  → {
      ok: boolean,
      authCheck: { passed: boolean; rules: string[] },
      rowFilter?: string,            // mock
      maskedFields?: string[],       // mock
      rows: Array<Record<string, unknown>>,  // mock sample data
      durationMs: number,
    }

POST /api/graph/cypher
  body: { query: string }
  → { nodes: [...], edges: [...], durationMs }
```

两个端点都挂 requireAuth + 至少读权限。

## Neo4j SVG mock 设计

硬编码 5 节点 + 4 边（见 PRD §10.3.3 的"供应商主表 · 42 条"样式）：

```
Node: 供应商主表 (42 条)      [紫色]
Node: 采购订单表 (1.2 万条)    [紫色]
Node: 物料主表 (8 千条)        [紫色]
Node: 付款记录表 (9 万条)      [紫色]
Node: 合同模板                 [橙色方块]

Edges:
  供应商主表 → 采购订单表    实线  supplier_id FK
  采购订单表 → 物料主表      实线  material_id FK
  采购订单表 → 付款记录表    实线  po_id FK
  合同模板 → 供应商主表      虚线  业务关联
```

SVG 400x300，支持 hover 显示 tooltip（字段列表 mock）。

## 详情页 Banner（PRD §10.3）

```
┌───────────────────────────────────────────┐
│ 📦 采购订单表                              │
│ 类型: 结构化 · 状态: ✓ 正常 · 更新 2 小时前│
│ 1.2 万条记录 · 标签: 采购, T1, ERP        │
│                   [返回目录] [配置权限]   │
└───────────────────────────────────────────┘
```

## Tab 细节

### Tab 1 资产列表

metadata_field 里 chunk_level=1 的 chunk 就是 heading，按 page 排序展示为表：
```
| page | heading (chunk_level=1) | heading_path |
```

### Tab 2 RAGFlow 摘要

- 顶部："RAGFlow 已接入"徽标 + "重新生成"（mock 按钮）
- 数据源概述卡：用 asset.tags / indexed_at / chunks.total 凑一段叙述
- Chunks 列表：前 10 条 level=3 chunk，显示 content + 来自 page + 标签徽标（已向量化）

### Tab 3 图谱

纯 SVG；内嵌图例；点击节点弹 alert/modal 显示 mock 字段列表。

## MCP 页重写要点

保留现有 `apps/web/src/knowledge/Mcp/index.tsx` 基本骨架，新增区域：

```
KnowledgeTabs
─ KPI 4 卡（MCP/Skill/RAGFlow/Neo4j）
─ [MCP 查询层]
  ─ 数据源列表 —— 现有 tool 卡片继续展示
  ─ SQL 调试区（NEW）—— textarea + source 下拉 + 执行
  ─ 结果回显（NEW）—— 授权链路 + rows 表
─ [Skill 文档源] (NEW) —— 列表 + 4 能力卡
─ [RAGFlow] (NEW) —— 4 指标 + 柱状图
─ [Neo4j] (NEW) —— 4 指标 + Cypher 调试
```

RAGFlow / Neo4j 状态显示 "（mock）" 标签，避免误导。

## 测试策略

- `assetDetail.route.test.ts` —— mock PG 返 asset / chunks / images；验 JSON 形状
- `mcpDebug.route.test.ts` —— 验 mock SQL 执行返带 authCheck
- 前端组件 test 本轮先省；下一轮补

## 风险

- SVG mock 用硬编码节点 —— 看起来"永远一样"；前端加注释"演示用，真实 Neo4j 接入后替换"
- chunks 列表在大 asset（数百 chunk）时只取前 10；PRD 后续要求 pagination（留 TODO）
- MCP 调试返假结果，容易让用户误以为真能查；在 UI 上明确标 "mock"
