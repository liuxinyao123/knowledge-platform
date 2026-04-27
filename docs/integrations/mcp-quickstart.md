# MCP 接入指南 · 3 步把 ZhiYuan 知识库接进 Cursor / Claude Desktop

> 面向：客户工程师、Demo 现场对接、第三方 Agent 开发者
> 服务版本：mcp-service v1.0（基于 `@modelcontextprotocol/sdk` 1.12）
> 本指南配套 ADR：mcp-service / ontology-declarative-skills / agent-orchestrator

---

## 工具清单（截至 2026-04-26 · ADR-33 后全 8 通）

mcp-service 进程通过 declarative skill yaml 暴露 8 个工具，**全部生产就绪**：

| 工具 | 状态 | 后端 qa-service 路由 | 用途 |
|---|---|---|---|
| `search_knowledge` | ✅ | BookStack `/api/search` | 全库搜索，支持 shelf_id 过滤 |
| `get_page_content` | ✅ | BookStack `/api/pages/:id` | 按 page_id 拉完整页面正文 |
| `ontology.query_chunks` | ✅ | `POST /api/qa/retrieve` | 纯语义召回（不跑 RAG），返回 chunk preview |
| `ontology.traverse_asset` | ✅ | `POST /api/ontology/context` | 给定 chunks 返回 ontology 上下文（实体+边）|
| `ontology.path_between` | ✅ | `POST /api/ontology/path` | BFS 找两个 asset 间最短路径（默认 maxDepth=4）|
| `ontology.match_tag` | ✅ | `POST /api/ontology/match` | 自然语言查 tag，子串+token 重叠打分 |
| `action.execute` | ✅ | `POST /api/actions/:name/run` | 触发一个 Action（结构化任务执行） |
| `action.status` | ✅ | `GET /api/actions/runs/:run_id` | 查 run_id 状态 |

> ontology.match_tag 当前是 v1 实现（substring + Jaccard 打分）；语义嵌入版本留 follow-up。

---

## 部署形态

mcp-service 是独立 Node 进程，两种 transport 任选：

```text
┌── stdio transport ──────┐         ┌─ Cursor / Claude Desktop / 自研 Agent
│  pnpm dev               │ <─────> │  通过本地命令启动并 stdio pipe 通信
└─────────────────────────┘         └──────────────────────────────────────

┌── streamable HTTP ──────┐         ┌─ 远程 Agent / 服务端调用方
│  pnpm dev:http          │ <─────> │  POST http://host:3002/mcp
│  --port 3002 --path /mcp│         │  支持流式响应 + 多并发会话
└─────────────────────────┘         └──────────────────────────────────────
```

mcp-service 需要环境变量 `BOOKSTACK_MCP_TOKEN`（**只读**）和 `KNOWLEDGE_API_BASE`（指向 qa-service）。和 qa-service 主写 token 账号隔离，对外协议最小权限。

---

## Step 1 · 启动 mcp-service

### 选项 A：本机 stdio 模式（最常见，给 Claude Desktop / Cursor 用）

不需要专门起进程——客户端会自己 spawn 子进程。直接配置文件指过去即可（见 Step 2）。

### 选项 B：HTTP 模式（给远程 Agent / 服务端用）

```bash
# 仓库根
pnpm --filter mcp-service dev:http
# → listening on http://0.0.0.0:3002/mcp
```

或走 docker-compose（如果你的部署里把 mcp-service 也加进了 compose）：

```bash
docker compose -f infra/docker-compose.yml up -d mcp_service
curl -fsS http://localhost:3002/mcp -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## Step 2 · 配置客户端

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows），加入：

```json
{
  "mcpServers": {
    "zhiyuan-knowledge": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/knowledge-platform/apps/mcp-service/src/index.ts"
      ],
      "env": {
        "KNOWLEDGE_API_BASE": "http://localhost:3001",
        "BOOKSTACK_API_BASE": "http://localhost:6875",
        "BOOKSTACK_MCP_TOKEN": "<你的只读 token>"
      }
    }
  }
}
```

重启 Claude Desktop。Settings → MCP 里能看到 `zhiyuan-knowledge` 一项，5 个 ✅ 工具会出现在工具列表。

### Cursor

`Settings → MCP → + Add server`：

```json
{
  "name": "zhiyuan-knowledge",
  "command": "node",
  "args": [
    "--experimental-strip-types",
    "/absolute/path/to/knowledge-platform/apps/mcp-service/src/index.ts"
  ],
  "env": {
    "KNOWLEDGE_API_BASE": "http://localhost:3001",
    "BOOKSTACK_API_BASE": "http://localhost:6875",
    "BOOKSTACK_MCP_TOKEN": "<你的只读 token>"
  }
}
```

### 远程 Agent / curl

```bash
# tools/list
curl -fsS http://your-host:3002/mcp \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# tools/call · search_knowledge
curl -fsS http://your-host:3002/mcp \
  -X POST -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,
    "method":"tools/call",
    "params":{
      "name":"search_knowledge",
      "arguments":{"query":"知识图谱","count":5}
    }
  }'
```

---

## Step 3 · 在客户端里验证

在 Claude Desktop / Cursor 里发起一句对话：

> 请用 search_knowledge 工具搜索"知识图谱"，列出前 3 条结果的 name 和 url

模型应该自动调用 `search_knowledge`，返回结构化结果。看到 `[Used tool search_knowledge]` 提示就算通了。

进阶验证：

> 拿第一个结果的 page_id，用 get_page_content 读出全文摘要

确认 `get_page_content` 也能调起来。这两个就证明 stdio + 后端两层都活。

---

## 故障排查

| 现象 | 原因 | 修法 |
|---|---|---|
| Claude Desktop 看不到 server | 配置文件路径 / JSON 语法错 | `cat .../claude_desktop_config.json | jq` 验证 |
| 调用 tool 报 401 | `BOOKSTACK_MCP_TOKEN` 无效 | 去 BookStack `/settings/users/<id>` 创建只读 API token |
| 调用 ontology.match_tag 命中过少 | v1 用 substring/Jaccard，没用语义嵌入 | 短期：把查询改写得更接近 tag 字面；中期：等语义嵌入版本 |
| HTTP mode 跨域 fail | Express CORS 没开 | mcp-service 暂未加 CORS；需要的话 set `MCP_HTTP_CORS=*` |
| `node --experimental-strip-types` 报错 | Node 版本 < 22 | 升级 Node 22+；老版本跑 `pnpm --filter mcp-service build && node dist/index.js` |

---

## 工具更详细的 schema

工具入参出参 schema 直接看：

```bash
cat apps/mcp-service/mcp-schema.json | jq '.tools[] | {name, description}'
```

或线上：

```bash
curl -fsS http://your-host:3002/mcp \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq
```

---

## 第三方系统接入（不走 MCP）

如果你的系统不支持 MCP（比如老 IM / OA），可以直接走 qa-service 的 REST API：

```bash
# 鉴权（HS256 或 JWKS 双栈）
curl -X POST http://your-host:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
# → { token: "...", expires_at: ... }

# 问答（SSE 流式）
curl -N http://your-host:3001/api/agent/dispatch \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"question":"什么是知识图谱？","session_id":"abc"}'
```

完整路由列表：`apps/qa-service/src/routes/`。常用：

- `/api/auth/login` 登录
- `/api/agent/dispatch` Agent 编排（SSE 流）
- `/api/qa/ask` 旧版 RAG 入口（向后兼容）
- `/api/knowledge/ingest` 上传文档
- `/api/notebooks` Notebook CRUD
- `/api/spaces` 空间管理

---

## 相关 ADR / 文档

- 协议设计：`docs/superpowers/archive/mcp-service/`
- skill yaml 规范：`docs/superpowers/specs/ontology-declarative-skills/`
- agent dispatch 契约：`openspec/changes/agent-orchestrator/`
- 路由列表：`apps/qa-service/src/routes/`
