# ADR 2026-04-24-34 — Declarative Skills · MCP 声明式技能框架

> 工作流 B。OpenSpec 契约：`openspec/changes/ontology-declarative-skills/`。

## 背景

`mcp-service` 原只暴露 2 个硬编码 tool（`search_knowledge` / `get_page_content`）。新增一个 tool 要改 TypeScript + 注册 server + 手动同步 `mcp-schema.json`，成本高且易漂移。Ontology 平台要求 Agent 能按配置消费图查询 / Action API。

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | Skill 由 `<name>.skill.yaml` + 可选 `<name>.hook.ts` 组成 | YAML v1：name/version/input/output/backend{kind:http\|hook\|compose}/auth |
| D-002 | `backend.kind=http` 走声明式模板，`hook` 走 TypeScript，`compose` 占位抛 `SkillComposeNotImplementedError` | 90% skill 走 http；legacy 走 hook |
| D-003 | 模板语法只支持 3 种：纯变量、default filter、JSON 字面量 | 拒绝循环 / 条件 / 自定义函数 → `SkillTemplateError` |
| D-004 | Skill loader 自写 `globFiles` 基于 `fs.readdir` 递归 | 不引入 globby 依赖（沙箱无法装） |
| D-005 | `js-yaml` 通过动态 import + try/catch，加载失败时抛 runtime error | tsc 仍可过（`@ts-ignore` 在 import 行） |
| D-006 | `mcp-schema.json` 从 YAML 反射出；新增 `schema:build` / `schema:check` 脚本 | CI 可接入 drift 检测 |
| D-007 | Legacy 迁移：`search_knowledge` / `get_page_content` 工具名不变，YAML + hook 复用现有 `services/bookstack.ts` 的函数 | I/O 字节级兼容 |
| D-008 | Startup 失败语义：YAML 非法 / 重名 → fatal；hook import 失败 → 跳过 + WARN；整个系统可降级 | 单个 skill 坏不拖累其他 |
| D-009 | Backend Proxy 统一封装 qa-service 调用，支持 JWT 透传 / 服务账号 token 切换 / 401/403/5xx/timeout 错误映射 | Skill 不直接写 fetch |

## 代码清单

### 新增
- `apps/mcp-service/src/skillLoader.ts` — 核心 loader + registerAll + buildMcpSchema
- `apps/mcp-service/skills/_lib/backendProxy.ts` — HTTP proxy
- `apps/mcp-service/scripts/build-schema.ts` — schema 构建 / 校验
- 8 个 skill 声明：
  - legacy: `search_knowledge.skill.yaml` + `.hook.ts`，`get_page_content.skill.yaml` + `.hook.ts`
  - `skills/ontology/query_chunks.skill.yaml`
  - `skills/ontology/traverse_asset.skill.yaml`
  - `skills/ontology/path_between.skill.yaml`
  - `skills/ontology/match_tag.skill.yaml`
  - `skills/action/execute.skill.yaml`
  - `skills/action/status.skill.yaml`
- 测试：`__tests__/skillLoader.test.ts` + `__tests__/skills/**`

### 修改
- `apps/mcp-service/src/server.ts` — 改为 async，调 `loadAllSkills` + `registerAll`
- `apps/mcp-service/src/index.ts` — await async createServer
- `apps/mcp-service/mcp-schema.json` — 生成文件（8 tools）
- `apps/mcp-service/package.json` — 新增 `schema:build` / `schema:check` 脚本；删除 `globby`（未使用），保留 `js-yaml`

### 删除
- `apps/mcp-service/src/tools/search_knowledge.ts` → 迁至 hook
- `apps/mcp-service/src/tools/get_page_content.ts` → 迁至 hook

## 依赖处理（沙箱限制）

- `js-yaml@4.1.1` 已在 `node_modules/.pnpm/` 里（项目其他包的 transitive）
- 沙箱无 npm/pnpm 网络权限，无法 `pnpm install`
- 工作区以 symlink 形式把 `node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml` 映射到 `apps/mcp-service/node_modules/js-yaml`
- 用户在本地 Mac 跑 `pnpm install` 会把 symlink 替换为 pnpm 正常布局，行为一致

## 向后兼容

- `search_knowledge` / `get_page_content` 两个 MCP tool name 不变；I/O 结构按老 spec 字节级一致
- 老 test 迁移到 `__tests__/skills/` 下，原有 Scenario 全部保留
- `mcp-schema.json` 工具条目增加，老客户端忽略新工具

## 验证

- `npx tsc --noEmit` 清
- vitest 本地跑（沙箱受 rollup darwin native 限制不能跑）
- 启动两种 transport：
  - stdio：`pnpm --filter mcp-service dev`，用 Claude Desktop 列 tools 应返回 8 个
  - HTTP：`pnpm --filter mcp-service dev:http`，`GET /mcp` 应返回与 `mcp-schema.json` 一致

## 关联

- 下游：`ontology.traverse_asset` 依赖 ADR-33 的 `POST /api/ontology/context`
- 下游：`action.execute` / `action.status` 依赖 ADR-35 的 `/api/actions/*`
- 未决（OQ-ONT-3）：跨 Skill 的 `compose` pipeline 是否进入平台范围
