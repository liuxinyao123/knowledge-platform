# Tasks: Declarative Skills in mcp-service

> 工作流 D 仅产契约。执行阶段由下游 B 流程承接。

## 执行阶段（契约合并后由执行方勾选）

### 框架与目录

- [x] 新建 `apps/mcp-service/skills/` 目录
- [x] 新建 `apps/mcp-service/skills/_lib/backendProxy.ts`
- [x] 新建 `apps/mcp-service/src/skillLoader.ts`
  - [x] `loadAllSkills(rootDir)`
  - [x] `registerAll(server, skills)`
  - [x] `buildMcpSchema(skills)`
- [x] 修改 `apps/mcp-service/src/server.ts`：改走 skill loader
- [x] 修改 `apps/mcp-service/package.json` 增加 `schema:build` / `schema:check` 脚本

### Legacy 迁移

- [x] 创建 `skills/search_knowledge.skill.yaml` + `skills/search_knowledge.hook.ts`
- [x] 创建 `skills/get_page_content.skill.yaml` + `skills/get_page_content.hook.ts`
- [x] 删除（或归档）`apps/mcp-service/src/tools/*.ts`（确保迁移后再删）

### 新 Skill 声明

- [x] `skills/ontology/query_chunks.skill.yaml`
- [x] `skills/ontology/traverse_asset.skill.yaml`
- [x] `skills/ontology/path_between.skill.yaml`
- [x] `skills/ontology/match_tag.skill.yaml`
- [x] `skills/action/execute.skill.yaml`
- [x] `skills/action/status.skill.yaml`

### 生成 mcp-schema.json

- [x] 实现 `schema:build` 命令，输出 `apps/mcp-service/mcp-schema.json`
- [x] 实现 `schema:check` 命令（diff 失败即 exit 1）
- [x] 接入 CI 前置步骤（本 change 不配 CI，仅在 tasks 中提示）

### 测试

- [x] `apps/mcp-service/__tests__/skillLoader.test.ts`
- [x] `apps/mcp-service/__tests__/skills/search_knowledge.test.ts`（从旧 test 迁移）
- [x] `apps/mcp-service/__tests__/skills/get_page_content.test.ts`（从旧 test 迁移）
- [x] `apps/mcp-service/__tests__/skills/ontology/traverse_asset.test.ts`
- [x] `apps/mcp-service/__tests__/skills/action/execute.test.ts`
- [x] `apps/mcp-service/__tests__/skills/action/status.test.ts`
- [x] `pnpm --filter mcp-service test` 全 GREEN

### 验证

- [x] `npx tsc --noEmit` 在 mcp-service 通过
- [x] stdio 模式启动 MCP，`list-tools` 返回所有 8 个 Skill
- [x] HTTP 模式启动，`GET /mcp` schema 匹配 `mcp-schema.json`
- [x] 用 Claude Desktop 实测一次 `search_knowledge`（无 regression）
- [x] 用 Claude Desktop 实测一次 `ontology.traverse_asset`（需 `ontology-oag-retrieval` change 已上线）

### 归档

- [x] 归档到 `docs/superpowers/archive/ontology-declarative-skills/`
- [x] 新增 ADR `.superpowers-memory/decisions/<date>-<seq>-ontology-skills.md`

---

## 依赖

- **强依赖**：`ontology-oag-retrieval` 必须先上线（`traverse_asset` / `query_chunks` 需要 qa-service 端点就绪）
- **强依赖**：`ontology-action-framework` 必须先上线（`action.execute` / `action.status` 需要 API 就绪）
- 若上游未就绪，skill 启动可加载但调用会 502，已在 spec scenario 中覆盖该行为
