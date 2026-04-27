# ARCHIVED — ontology-action-framework

- **Archived at**: 2026-04-24
- **ADR**: `.superpowers-memory/decisions/2026-04-24-35-ontology-action-framework.md`
- **Verification**:
  - `npx tsc --noEmit` clean in `apps/qa-service` and `apps/web`
  - `pnpm --filter qa-service test`: 308/308 GREEN（含 actionEngine state / preconditions / webhook / routes/actions / built-in handlers）
  - 前端 Governance UI "操作与审批" tab 注册成功，`/web` tsc 清
- **Post-execution fixes folded in**:
  - 17 个 tsc 错误修复（handler 泛型 / `evaluateAcl` 未 await / `req.query` 联合类型 / `principal.user_id: number` 强转 string / `def.webhook.url` 回调窄化）
  - migration SQL 内联到 `services/pgDb.ts:runPgMigrations`（项目约定不走文件式 migration）
  - `ajv@8.x` symlink 修补（沙箱限制，正常 `pnpm install` 后自动就绪）
- **Live contract**: `openspec/changes/ontology-action-framework/`
- **新增环境变量**（用户需写入 `infra/.env` 或 `apps/qa-service/.env`）：
  ```
  ACTION_WEBHOOK_ALLOWLIST=https://ci.example.com,https://incident.example.com
  ACTION_WEBHOOK_SECRET=<openssl rand -hex 32>
  ```
