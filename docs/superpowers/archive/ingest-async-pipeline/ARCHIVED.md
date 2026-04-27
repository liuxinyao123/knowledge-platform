# ARCHIVED — ingest-async-pipeline

- **Archived at**: 2026-04-24
- **ADR**: `.superpowers-memory/decisions/2026-04-24-40-ingest-async-pipeline.md`
- **Progress Snapshot**: `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-24-ingest-async.md`
- **Verification** (用户本机 macOS · 2026-04-24 15:00)：
  - `pnpm -r exec tsc --noEmit` clean in `apps/qa-service` · `apps/mcp-service` · `apps/web`
  - `pnpm --filter qa-service test` · **Test Files 52 passed (52) / Tests 323 passed (323)** · 13.08s
  - `pnpm dev:up` 启动日志出现 `✓ ingest worker started · concurrency=2 · interval=500ms`
- **Live contract** (frozen, 后续扩展在此追加): `openspec/changes/ingest-async-pipeline/`
- **交付摘要**：
  - Phase A 后端 · DB 迁移 + `services/ingestWorker.ts`（318 行新建）+ `jobRegistry.ts` DB 持久化 + `runPipeline` progress 回调 + `enqueueIngestJob`（+1210 行）
  - Phase B HTTP · `/upload-full` 三分支路由 + `/jobs/:id/stream` SSE + `GET /jobs/*` DB 读回落 + 前端 `streamJob` helper（+1062 行）
  - Phase C 测试 · `ingestWorker.test.ts`（5 cases） + `ingestRoutesAsync.test.ts`（6 cases） + `ingestPipeline.pipeline.test.ts` 新增 3 cases（+600 行）
- **已裁剪进 Phase E**：
  1. 前端 PreprocessingModule / UploadTab 升级为 SSE 订阅（`streamJob` helper 已就位）
  2. `/fetch-url` 与 `/conversation` 入口异步化
  3. ADR-30 DELETE 端点联动 `UPDATE ingest_job SET status='cancelled'`
  4. `infra/docker-compose.yml` env 同步
  5. "小文件自动同步" 阈值（`INGEST_ASYNC_THRESHOLD_BYTES` 当前占位）
  6. SIGTERM grace 真实值测试（需 fake timer）
  7. SSE 非 owner 403 测试
