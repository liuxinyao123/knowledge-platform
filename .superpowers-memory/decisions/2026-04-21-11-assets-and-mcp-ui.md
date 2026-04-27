# ADR 2026-04-21-11 · 资产详情 + MCP 接入层 UI（PRD §10 + §14）

## Context

PRD §10/§14 的页面缺失：资产无独立列表/详情入口；MCP 页只有基础 tool 状态。
G3 Neo4j、G3 RAGFlow 真接入因 Q3=c 推迟，但 UI 骨架不能等。

## Decision

1. 两个模块合并为一个 change（小而强相关）
2. 资产详情 Tab 3 知识图谱用 SVG mock；后端 `/api/graph/cypher` 也是 mock
3. MCP 调试区返 mock 行 + mock 授权链路（与未来 G3 规则编辑器对接）
4. RAGFlow 4 指标全 mock；UI 上明确标注"演示数据"

## Consequences

**正面**
- PRD §10/§14 UI 100% 落地
- 未来真接 Neo4j/RAGFlow 时只换组件实现，路由和数据形状不变
- 与 G2 unified-auth-permissions 联动：所有写操作入口可用 `<RequirePermission>` 包

**负面 / 取舍**
- 用户可能误以为图谱/SQL 真能用 → UI 必须明显标 mock
- chunks 列表前 10 条限制简单粗暴；分页 / 检索留 Phase 2

## Links

- openspec/changes/assets-and-mcp-ui/
- PRD §10 资产目录 / §14 数据接入
