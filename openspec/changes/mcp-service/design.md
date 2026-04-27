# Design: 知识中台 MCP 服务

## 目录结构

```
apps/mcp-service/
  src/
    server.ts           # MCP Server 实例 + 工具注册
    index.ts            # 入口：stdio / HTTP 传输选择
    services/
      bookstack.ts      # BookStack 只读 API 客户端
    tools/
      search_knowledge.ts    # search_knowledge 工具实现
      get_page_content.ts    # get_page_content 工具实现
  __tests__/
    search_knowledge.test.ts
    get_page_content.test.ts
  mcp-schema.json       # 静态 tool schema（构建时生成）
  package.json
  tsconfig.json
  .env.example
```

---

## 环境变量

```
BOOKSTACK_URL=http://localhost:6875
BOOKSTACK_MCP_TOKEN=token_id:token_secret   # 只读服务账号
MCP_HTTP_PORT=3002                          # HTTP 模式端口（可选，默认 3002）
```

---

## BookStack API 客户端（services/bookstack.ts）

```ts
// 使用 BOOKSTACK_MCP_TOKEN（只读账号，独立于 qa-service 的读写账号）
const bs = axios.create({
  baseURL: `${process.env.BOOKSTACK_URL}/api`,
  headers: { Authorization: `Token ${process.env.BOOKSTACK_MCP_TOKEN}` },
})

export async function searchKnowledge(query: string, count: number, shelfId?: number)
export async function getPageContent(pageId: number)
export function stripHtml(html: string): string
```

**shelf_id 过滤实现**：
- 若提供 `shelf_id`，先调 `GET /api/shelves/{shelf_id}` 获取 books 列表
- 搜索结果中过滤 `result.book.id` 在该书架的 book IDs 内
- 若无匹配，返回空数组（不降级到全局搜索）

---

## Tool: search_knowledge

**输入 schema**：
```json
{
  "query": { "type": "string", "description": "搜索关键词" },
  "shelf_id": { "type": "number", "description": "限定知识空间 ID（可选）" },
  "count": { "type": "number", "description": "返回数量，默认 10" }
}
```

**输出**：
```ts
{
  results: Array<{
    name: string
    excerpt: string      // preview_html.content 去除 HTML 标签，截取前 300 字符
    url: string
    type: string         // page / chapter / book
    book_name: string    // result.book?.name ?? ''
  }>
}
```

---

## Tool: get_page_content

**输入 schema**：
```json
{
  "page_id": { "type": "number", "description": "BookStack 页面 ID" }
}
```

**输出**：
```ts
{
  name: string
  content: string      // html → 纯文本（stripHtml），最多 10000 字符
  url: string
  tags: string[]       // tag.name 数组
  updated_at: string   // ISO 8601
}
```

---

## Transport 设计

```
启动方式：
  node src/index.ts           → stdio 模式
  node src/index.ts --http    → HTTP/SSE 模式（端口 MCP_HTTP_PORT）
```

- **stdio**：`StdioServerTransport` — 标准输入输出，适合 Claude Desktop
- **HTTP**：`StreamableHTTPServerTransport` — Express + MCP HTTP 端点 `/mcp`
  - `GET /mcp` → SSE 流
  - `POST /mcp` → JSON-RPC 请求
  - `GET /health` → `{ ok: true }`

---

## mcp-schema.json 格式

供李炀技能市场注册，静态文件，随代码提交：

```json
{
  "name": "knowledge-mcp",
  "version": "1.0.0",
  "description": "知识中台 MCP 服务 — 搜索与内容读取",
  "tools": [
    {
      "name": "search_knowledge",
      "description": "在知识库中搜索相关内容",
      "inputSchema": { ... }
    },
    {
      "name": "get_page_content",
      "description": "获取指定知识库页面的完整内容",
      "inputSchema": { ... }
    }
  ]
}
```

---

## 测试策略

- Mock `axios`（BookStack API），测试两个 tool 的输入→输出转换
- 测试 `shelf_id` 过滤逻辑（有/无匹配）
- 测试 `stripHtml` 去标签
- 不测试 transport 层（MCP SDK 内部）
