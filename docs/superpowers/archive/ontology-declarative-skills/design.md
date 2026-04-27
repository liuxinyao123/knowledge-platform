# Design: Declarative Skills in mcp-service

## 目录结构

```
apps/mcp-service/
  src/
    server.ts                    ← 修改：改走 skillLoader.registerAll()
    index.ts                     ← 不变
    skillLoader.ts               ← 新增
    services/
      bookstack.ts               ← 保留（被 legacy hook 调用）
    tools/                       ← 废弃为"legacy 目录"，新增向下兼容 shim
  skills/                        ← 新增目录
    _lib/
      backendProxy.ts            ← 代理 qa-service 的 fetch 工具
    search_knowledge.skill.yaml
    search_knowledge.hook.ts     ← legacy shelf_id 过滤逻辑迁移到这里
    get_page_content.skill.yaml
    get_page_content.hook.ts
    ontology/
      query_chunks.skill.yaml
      traverse_asset.skill.yaml
      path_between.skill.yaml
      match_tag.skill.yaml
    action/
      execute.skill.yaml
      status.skill.yaml
  mcp-schema.json                ← 改为构建产物
  __tests__/
    skillLoader.test.ts          ← 新增
    skills/*.test.ts             ← 各 skill 的 I/O 测试
```

---

## Skill YAML 规范（v1）

### 顶层字段

```yaml
# Required
name: ontology.traverse_asset       # 全局唯一；MCP tool name
version: 1
description: 从给定 Asset 出发 1-2 跳拿 Ontology Context

# Optional
category: ontology                  # 分组；仅用于 mcp-schema.json 的 grouping
stability: stable | beta | deprecated
legacy_tool_name: search_knowledge  # 仅用于向后兼容迁移

# I/O 契约
input:
  type: object
  properties:
    asset_id: { type: string }
    max_hop: { type: integer, minimum: 1, maximum: 2, default: 2 }
  required: [asset_id]

output:
  type: object
  properties:
    entities: { type: array, items: { $ref: "#/definitions/OntologyEntity" } }
    edges:    { type: array, items: { $ref: "#/definitions/OntologyEdge" } }
  required: [entities, edges]

# 后端调用（三种二选一）
backend:
  kind: http                        # http | hook | compose
  method: POST
  path: /api/ontology/context
  body:
    chunks: "{{ [{asset_id: input.asset_id, score: 1}] }}"
    maxHop: "{{ input.max_hop }}"
  response:
    map:
      entities: "{{ response.entities }}"
      edges: "{{ response.edges }}"

# 鉴权传递
auth:
  forward: true                     # 默认 true，JWT 透传
  required_principal: user          # user | admin | any

# 审计（可选）
audit:
  level: info                       # off | info | detail
```

### backend.kind 三种形态

| kind | 说明 | 典型用途 |
|------|------|---------|
| `http` | 声明式模板渲染 → fetch `qa-service` 某端点 | 90% Skill |
| `hook` | 执行同名 `.hook.ts` 导出的 `run(input, ctx)` 函数 | legacy 兼容 / 复杂转换 |
| `compose` | 顺序调多个 skill，合并结果（本 change 不实现，仅声明占位） | 未来扩展 |

### 模板语法（最小子集）

使用 `{{ expr }}`：
- 纯变量：`{{ input.asset_id }}`、`{{ response.items.length }}`
- 字面量兜底：`{{ input.count | default: 10 }}`
- JSON 对象/数组：`{{ [{a: input.x}] }}`

**不支持**：循环、条件分支、自定义函数。需要就用 `hook.ts`。

---

## Skill Loader

```ts
// skillLoader.ts
export interface LoadedSkill {
  name: string
  version: number
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  handler: (input: unknown, ctx: SkillContext) => Promise<unknown>
  manifest: SkillYaml
}

export interface SkillContext {
  principalJwt?: string     // 从 MCP request headers 透传
  requestId: string
}

export async function loadAllSkills(rootDir: string): Promise<LoadedSkill[]>
export function registerAll(server: McpServer, skills: LoadedSkill[]): void
export async function buildMcpSchema(skills: LoadedSkill[]): Promise<unknown>  // 输出 mcp-schema.json 内容
```

启动流程（`server.ts`）：

```ts
const skills = await loadAllSkills(resolve(__dirname, '../skills'))
registerAll(mcpServer, skills)
// stdio / http 照旧
```

**加载失败策略**：
- YAML 解析失败 → fatal，启动退出（明确报错位置）
- Hook import 失败 → 该 skill 跳过，启动继续，`WARN` 日志
- 同名 skill 重复 → fatal

---

## Backend Proxy

```ts
// skills/_lib/backendProxy.ts
export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PATCH'
  path: string                       // e.g. /api/ontology/context
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number                 // 默认 5000
}

export async function proxyQaService(
  req: ProxyRequest,
  ctx: SkillContext,
): Promise<{ status: number; body: unknown; headers: Record<string,string> }>
```

- **Base URL**：环境变量 `QA_SERVICE_URL`（默认 `http://localhost:3001`）
- **鉴权头透传**：`Authorization: Bearer ${ctx.principalJwt}`；若 `auth.forward: false`，使用服务账号 token（`QA_SERVICE_SKILL_TOKEN` 环境变量）
- **错误映射**：
  - `401/403` → 抛 `SkillAuthError`，MCP 返回 `error.code="unauthorized"`
  - `5xx` → 抛 `SkillUpstreamError`，MCP 返回 `error.code="upstream_error"`
  - 超时 → `error.code="timeout"`
- **日志**：每次 proxy 记录 `{skill_name, qa_path, status, latency_ms}`

---

## MCP Schema 自动生成

`mcp-schema.json` 从 `LoadedSkill[]` 反射：

```ts
const schema = await buildMcpSchema(skills)
await fs.writeFile(resolve(__dirname, '../mcp-schema.json'), JSON.stringify(schema, null, 2))
```

构建命令：

```
pnpm --filter mcp-service schema:build       # 生成
pnpm --filter mcp-service schema:check       # CI 用，diff 失败即 fail
```

---

## Legacy 兼容

`search_knowledge` / `get_page_content` 两个老工具**不改 MCP tool 名**，而是：

### search_knowledge.skill.yaml

```yaml
name: search_knowledge
version: 1
legacy_tool_name: search_knowledge
description: 在知识库中搜索相关内容（向后兼容接口）
input:
  type: object
  properties:
    query: { type: string }
    shelf_id: { type: number }
    count: { type: number, default: 10 }
  required: [query]
output:
  type: object
  properties:
    results: { type: array }
backend:
  kind: hook
auth:
  forward: false                   # 继续用 BOOKSTACK_MCP_TOKEN
```

### search_knowledge.hook.ts（契约）

```ts
export async function run(
  input: { query: string; shelf_id?: number; count?: number },
  ctx: SkillContext,
): Promise<{ results: Array<{ name: string; excerpt: string; url: string; type: string; book_name: string }> }>
```

实现方直接复用 `services/bookstack.ts` 的 `searchKnowledge`。

---

## 六个新 Skill 的契约摘要

### ontology.query_chunks
- input: `{ query: string; top_k?: number; space_id?: string }`
- output: `{ chunks: Array<{ asset_id, score, preview }> }`
- backend: `POST /api/qa/retrieve`（执行方负责在 qa-service 暴露；若暂无可用 `/api/knowledge-qa/search` 占位）

### ontology.traverse_asset
- input: `{ asset_id: string; max_hop?: 1|2 }`
- output: `OntologyContext`（复用 `ontology-oag-retrieval` 定义）
- backend: `POST /api/ontology/context`

### ontology.path_between
- input: `{ from_id: string; to_id: string; max_depth?: number }` (max_depth 默认 4)
- output: `{ paths: Array<{ nodes: OntologyEntity[], edges: OntologyEdge[], length: number }> }`
- backend: `POST /api/ontology/path`（**新端点**，契约见 `specs/ontology-path-spec.md`）
- 上限：返回 ≤ 3 条路径

### ontology.match_tag
- input: `{ text: string; top_k?: number }`
- output: `{ tags: Array<{ id, name, score }> }`
- backend: `POST /api/ontology/match`（基于 Tag.semantic_embedding）

### action.execute
- input: `{ action_name: string; args: object; reason?: string }`
- output: `{ run_id: string; state: 'pending'|'executing'|'succeeded'|'failed' }`
- backend: `POST /api/actions/:action_name/run`（来自 `ontology-action-framework`）
- audit: `detail`

### action.status
- input: `{ run_id: string }`
- output: `{ run_id, state, attempts, last_error?, audit_log_id? }`
- backend: `GET /api/actions/runs/:run_id`

---

## 与 Agent 的交互方式

Agent 调 MCP 工具时，MCP Server 从请求元数据拿 JWT（stdio 模式用 `initialize` 请求里的 `clientInfo.principalToken`；HTTP 模式从 `Authorization` 头），塞进 `SkillContext.principalJwt`，后续 proxy 自动透传到 qa-service。qa-service 的 `requireAuth` 照常鉴权。

**不信任客户端自报的 principal**：所有鉴权决策由 qa-service 的 Permissions V2 定。

---

## 测试策略

- `skillLoader.test.ts`：
  - 正常加载 + 注册
  - YAML 非法 → 启动失败
  - hook import 失败 → 跳过 + WARN
  - mcp-schema 与加载结果一致

- `skills/search_knowledge.test.ts`（迁移后）：延续现有 Scenario，确保 I/O 完全一致
- `skills/ontology/traverse_asset.test.ts`：mock `proxyQaService` 返回 OntologyContext，校验映射
- `skills/action/execute.test.ts`：mock 返回 `{run_id, state:'pending'}`，校验映射

**不测**：模板语法的全部边界（交给内部 unit test）、网络真实调用。
