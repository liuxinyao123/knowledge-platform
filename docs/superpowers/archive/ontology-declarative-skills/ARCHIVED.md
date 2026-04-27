# ARCHIVED — ontology-declarative-skills

- **Archived at**: 2026-04-24
- **ADR**: `.superpowers-memory/decisions/2026-04-24-34-ontology-declarative-skills.md`
- **Verification**:
  - `npx tsc --noEmit` clean in `apps/mcp-service`
  - `pnpm --filter mcp-service test`: 42/42 GREEN
  - 验收集成：`schema:build` / `schema:check` 命令就绪；8 个 Skill 全部可被 MCP Loader 解析并注册
- **Post-execution fixes folded in**:
  - JSON-Schema → Zod 桥接层（`jsonSchemaObjectToZodShape`）—— MCP SDK 1.29 的 `server.tool()` 要 Zod，YAML 作者写 JSON Schema，运行时自动翻
  - `_registeredTools` 替代 `_tools` 断言（MCP SDK 1.29 内部字段改名）
- **Live contract**: `openspec/changes/ontology-declarative-skills/`
