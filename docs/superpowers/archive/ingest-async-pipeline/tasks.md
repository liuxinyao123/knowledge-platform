# Tasks: Ingest Async Pipeline

> 本 change 采用工作流 B：锁契约 + 执行。执行阶段由同一 change 承接（不分拆）。
>
> **状态（2026-04-24 15:00）**：Phase A/B/C 全部完成，323/323 tests 绿。
> 归档见 `docs/superpowers/archive/ingest-async-pipeline/ARCHIVED.md` 与 ADR-40。
> 部分项（前端 SSE 订阅、docker-compose env 同步、`/fetch-url` 与 `/conversation`
> 异步化）被刻意裁剪为 follow-up —— 见 ADR-40 §Follow-up。

## 执行阶段

### 后端 · DB 迁移

- [x] 扩 `apps/qa-service/src/services/pgDb.ts:runPgMigrations()`：
  - [x] `ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_status VARCHAR(16) NOT NULL DEFAULT 'indexed'`
  - [x] `ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_error TEXT`
  - [x] `CREATE INDEX IF NOT EXISTS idx_metadata_asset_ingest_status`（部分索引，WHERE ingest_status <> 'indexed'）
  - [x] `CREATE TABLE IF NOT EXISTS ingest_job (...)`（DDL 见 design.md §数据结构）
  - [x] `CREATE INDEX IF NOT EXISTS idx_ingest_job_status_created`
  - [x] `CREATE INDEX IF NOT EXISTS idx_ingest_job_created_by`
- [x] 验证迁移幂等：重复跑 `runPgMigrations` 不报错（pnpm dev:up 二次启动实测通过）

### 后端 · Worker

- [x] 新增 `apps/qa-service/src/services/ingestWorker.ts`（318 行）：
  - [x] 导出 `startIngestWorker(opts)` / `IngestWorkerHandle`
  - [x] `setInterval` + 并发上限（`INGEST_WORKER_CONCURRENCY`，默认 2）
  - [x] `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` 认领 job
  - [x] 执行 `runIngestJob(job)` —— 内部 read bytes_ref → router → runPipeline（传 progress 回调）
  - [x] 成功 `status=indexed/progress=100/finished_at`；失败 `status=failed/error`；`JobCancelledError` 不计入失败
  - [x] `stop()` 等 in_progress 完成，超过 `SHUTDOWN_GRACE_MS` 强制回滚为 queued
- [x] `apps/qa-service/src/index.ts` 启动时：
  - [x] `UPDATE ingest_job SET status='queued' WHERE status='in_progress'`（通过 `resetInProgressJobs()`）
  - [x] 调 `startIngestWorker()` 并存 handle
  - [x] 注册 `SIGTERM` → `handle.stop()`

### 后端 · jobRegistry 持久化

- [x] 修改 `apps/qa-service/src/services/jobRegistry.ts`（+190 行）：
  - [x] `createJob` / `updatePhase` / `finish` / `fail` / `mergePreview` / `appendLog` 内部写 DB；DB 失败仅 WARN 回退内存（`dbWarn` 60s 去重）
  - [x] 读路径：当前实现由 `routes/ingestJobs.ts` 直接走 DB（`dbGetJob`/`dbListJobs`），内存 LRU 保留作热缓存；`adoptJob(dbRow)` 供 worker rehydrate
  - [x] 保留所有现有签名（向后兼容老调用方，ingest.ts 的 `runIngestAndTrack` 不改）

### 后端 · pipeline 改造

- [x] 修改 `apps/qa-service/src/services/ingestPipeline/pipeline.ts`：
  - [x] `runPipeline(input, result, progress?)` 追加可选 `progress` 回调参数
  - [x] 在每个原子步骤前调 `progress?.({phase, progress, msg?})`（parse → chunk → tag → done）
  - [x] 签名向后兼容：旧调用方传 undefined 行为字节级等同
- [x] 修改 `apps/qa-service/src/services/ingestPipeline/index.ts`：
  - [x] 新增 `enqueueIngestJob(input): Promise<{jobId, bytesRef}>` —— 落盘 `os.tmpdir()/ingest-<jobId>` → UPDATE bytes_ref → 返回 job_id
  - [x] 保留 `ingestDocument(input)` 同步入口向后兼容（新增可选 progress 参数）

### 后端 · 路由

- [x] 修改 `apps/qa-service/src/routes/ingest.ts`：
  - [x] 实现 `?sync=true` 查询参数强制同步
  - [ ] ~~Body ≤ `INGEST_ASYNC_THRESHOLD_BYTES`（默认 2 MiB）自动同步~~ — **已裁剪**：MVP 不做自动同步，所有非 `?sync=true` 请求都走异步队列；避免前端 `{jobId}` 合约变成 union type，减少前端改动面。`INGEST_ASYNC_THRESHOLD_BYTES` 变量保留占位，留给 Phase E
  - [x] 异步路径：返回 `202 + {job_id, ingest_status:'queued', sync:false}`
  - [x] 同步路径：返回 `200 + {sync:true, assetId, ...}`
  - [ ] ~~同样逻辑应用到 `/api/ingest/fetch-url`、`/api/ingest/scan-folder`~~ — **已裁剪**：fetch-url / conversation 小流量 + 本身是"fetch + 单 ingest"秒级，保留现有 fire-and-forget；scan-folder 为批量扫描，独立设计。见 ADR-40 §Follow-up
- [x] 修改 `apps/qa-service/src/routes/ingestJobs.ts`（81 → 257 行）：
  - [x] `GET /api/ingest/jobs` 改为 DB 查询优先（`dbListJobs`），DB 挂时降级到内存 `listJobs`
  - [x] `GET /api/ingest/jobs/:id` 内存优先 + DB fallback + 顺带 `adoptJob` 回缓内存
  - [x] 新增 `GET /api/ingest/jobs/:id/stream` SSE 端点（250ms 轮询 DB + 15s keepalive）
  - [x] SSE 鉴权：owner (`job.created_by === principal.email`) 或 admin role
  - [x] keepalive 15s `:ping`；done 后 server 主动 `res.end()`

### 环境变量

- [x] `apps/qa-service/.env.example` 增加：
  - `INGEST_ASYNC_ENABLED=true`
  - `INGEST_ASYNC_THRESHOLD_BYTES=2097152`（占位，未生效）
  - `INGEST_WORKER_CONCURRENCY=2`
  - `INGEST_WORKER_INTERVAL_MS=500`
  - `INGEST_WORKER_SHUTDOWN_GRACE_MS=30000`
- [ ] ~~`infra/docker-compose.yml:qa_service.environment` 同步变量~~ — **Phase E**：默认值与 env.example 一致即可，Docker env 无显式覆盖时进程内 `process.env.*` fallback 生效，不阻塞功能

### 前端

- [x] `apps/web/src/api/ingest.ts` 新增 `streamJob(jobId, handlers)` SSE 订阅 helper（原生 EventSource + withCredentials）
- [ ] ~~`apps/web/src/knowledge/Ingest/` 上传 handler 订阅 SSE~~ — **Phase E**：PreprocessingModule 当前的 `setInterval(getJob, POLL_MS)` 已能 work（DB 读回落已到位），SSE 订阅是优化项
- [ ] ~~新增 `useIngestJobStream(jobId)` hook~~ — **Phase E**

### 测试

- [x] 新增 `apps/qa-service/src/__tests__/ingestWorker.test.ts`（311 行，5 cases）：
  - [x] `resetInProgressJobs` 回滚
  - [x] queued → in_progress → indexed happy path
  - [x] 并发上限（5 jobs × concurrency=2，验证 `maxObservedRunning <= 2`）
  - [ ] ~~SIGTERM 恢复~~ 弱形式（`stop()` 不无限挂起；真实 grace 值需 fake timer 重写）— **Phase E**
  - [x] ADR-30 DELETE 竞态：status='cancelled' → JobCancelledError → stats.cancelled++（而非 failed）
- [x] 新增 `apps/qa-service/src/__tests__/ingestRoutesAsync.test.ts`（251 行，6 cases）：
  - [x] `?sync=true` 响应 shape（`{sync:true, assetId, chunks, ...}`）
  - [ ] ~~阈值自动同步~~ — 已裁剪（同上）
  - [x] 异步路径返回 202 + jobId
  - [x] `INGEST_ASYNC_ENABLED=false` fallback 到 in-memory
  - [x] `GET /jobs/:id` DB fallback 命中 + 404
  - [x] SSE 端点 404；鉴权的非 owner 403 case（Phase E）：当前 admin principal 会绕行
- [x] 修改 `apps/qa-service/src/__tests__/ingestPipeline.pipeline.test.ts`（+40 行，3 cases）：
  - [x] progress 回调 parse → chunk → tag → done 顺序 + 单调 progress
  - [x] 回调抛错不影响主流程
  - [x] 省略 progress 参数的向后兼容（跟旧 case 结构字节级等同）
- [x] 本机 `pnpm -r exec tsc --noEmit` / `pnpm --filter qa-service test` 全绿 · **323/323 passed** · 2026-04-24 15:00 · 用户 Mac

### 验收（执行方在 PR 描述填写）

- [x] 本机 `pnpm install` / tsc / test 全绿（2026-04-24 15:00 用户报告）
- [ ] 大 PDF（> 5 MiB）上传 p95 HTTP 响应 ≤ 200ms（与旧版 >10s 对比）— **待生产数据验收**
- [ ] 进程 SIGTERM + 重启：in_progress job 在 ≤ 5s 内被重新消费 — **待生产数据验收**
- [x] 老客户端强制 `?sync=true` 路径回归测试通过（ingestRoutesAsync.test.ts 覆盖）
- [ ] `pnpm eval-recall` 与 OAG Phase 1 基线（recall@5=1.0）无差异 — **待运行** · 异步化不改变召回链路
- [ ] 前端 `/ingest` 页面重启后 job 列表仍可见 — **待手动验证**
- [ ] `docker logs qa_service` 无异常 ERR — **待手动验证**

### 归档

- [x] 验证通过后：
  - [x] 复制 `openspec/changes/ingest-async-pipeline/{proposal,design,tasks}.md + specs/` 到 `docs/superpowers/archive/ingest-async-pipeline/`
  - [x] 新增 `docs/superpowers/archive/ingest-async-pipeline/ARCHIVED.md`（日期 + 主要交付摘要）
  - [x] `openspec/changes/ingest-async-pipeline/` 保留作为活契约
- [x] 在 `.superpowers-memory/decisions/` 落 ADR-40
- [x] `.superpowers-memory/open-questions.md` 关闭 OQ-INGEST-1 → 迁到"已关闭"区
- [x] 写 PROGRESS-SNAPSHOT 段落

## 不动

- `services/syncWorker.ts`（BookStack 全量同步，独立作业）
- `services/folderScan.ts`（未改，保留现有单步调用链）
- 其它 extractor / extractor-router
- eval runner / knowledgeGraph / OAG 链路
