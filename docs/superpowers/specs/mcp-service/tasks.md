# Tasks: 知识中台 MCP 服务

## 初始化

- [x] 创建 `apps/mcp-service/package.json`（依赖：@modelcontextprotocol/sdk, axios, express）
- [x] 创建 `apps/mcp-service/tsconfig.json`

## 实现

- [x] 创建 `apps/mcp-service/src/services/bookstack.ts`（BookStack 只读客户端）
- [x] 创建 `apps/mcp-service/src/tools/search_knowledge.ts`
- [x] 创建 `apps/mcp-service/src/tools/get_page_content.ts`
- [x] 创建 `apps/mcp-service/src/server.ts`（MCP Server + 工具注册）
- [x] 创建 `apps/mcp-service/src/index.ts`（stdio/HTTP 入口）
- [x] 生成 `apps/mcp-service/mcp-schema.json`
- [x] 创建 `apps/mcp-service/.env.example`

## 测试

- [x] 编写 `apps/mcp-service/__tests__/tools.test.ts` — 覆盖 runSearchKnowledge + runGetPageContent 两 tool 的 JSON 包装
- [x] 编写 `apps/mcp-service/__tests__/bookstack.test.ts` — 覆盖 searchKnowledge（query/shelf_id 过滤）、getPageContent（字段映射/10000 字截断）、stripHtml
- [x] 全部测试通过（按现有 `pnpm --filter mcp-service test` 验证）

## 验证

- [ ] TypeScript 编译无报错
- [ ] 测试全部 GREEN
