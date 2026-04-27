# Tasks: 资产/MCP UI

## 后端
- [x] BE-1: `routes/assetDirectory.ts` 加 `GET /:id/detail`
- [x] BE-2: `routes/mcpDebug.ts` —— `POST /api/mcp/debug-query` + `POST /api/graph/cypher`（mock）
- [x] BE-3: `index.ts` 挂 mcpDebug

## 前端 G5 资产
- [x] FE-1: `api/assetDirectory.ts` —— getAssetDetail()
- [x] FE-2: `knowledge/Assets/index.tsx` —— /assets 列表（卡片网格 + 类型 Pill）
- [x] FE-3: `knowledge/Assets/Detail.tsx` —— /assets/:id 容器（Banner + 3 Tab）
- [x] FE-4: `knowledge/Assets/DetailAssets.tsx` —— Tab 1 chunks.headings 表
- [x] FE-5: `knowledge/Assets/DetailRagflow.tsx` —— Tab 2 概述 + samples
- [x] FE-6: `knowledge/Assets/DetailGraph.tsx` —— Tab 3 SVG mock
- [x] FE-7: `App.tsx` 加 /assets, /assets/:id 路由
- [x] FE-8: `KnowledgeTabs.tsx` 加"资产"入口

## 前端 G7 MCP
- [x] FE-9: `api/mcp.ts` —— debugQuery(), runCypher()
- [x] FE-10: `knowledge/Mcp/index.tsx` 重写：4 KPI + SQL 调试 + Skill + RAGFlow + Neo4j

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-11-assets-and-mcp-ui.md`

## 验证
- [x] VR-1: `tsc --noEmit` 零错（沙箱）—— apps/web + apps/qa-service 双 0
- [ ] VR-2: 本机点 /assets → /assets/:id → 3 Tab 切换
- [ ] VR-3: 本机 /mcp 4 KPI 显示 + SQL 调试可用
- [x] VR-4: 归档 —— docs/superpowers/archive/assets-and-mcp-ui/
