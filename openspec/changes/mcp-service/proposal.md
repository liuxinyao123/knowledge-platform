# Proposal: 知识中台 MCP 服务

## Problem

外部 AI 工具（Claude Desktop、李炀技能市场）无法直接访问 BookStack 知识库内容。需要一个标准 MCP 服务暴露搜索和页面读取能力。

## Scope（本 Phase）

1. **apps/mcp-service**：独立 Node.js 服务，基于 `@modelcontextprotocol/sdk`
2. **Tool: search_knowledge**：调用 BookStack `/api/search`，支持 `shelf_id` 过滤
3. **Tool: get_page_content**：调用 BookStack `/api/pages/:id`，返回纯文本
4. **双 Transport**：stdio（默认）+ HTTP/SSE（`--http` 启动参数）
5. **mcp-schema.json**：供外部技能市场注册用的 tool schema 输出文件

## Out of Scope

- 写操作（创建/编辑页面）
- 用户鉴权透传（服务账号只读即可）
- 与 qa-service 共享部署
