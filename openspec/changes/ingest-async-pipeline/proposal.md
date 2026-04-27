# Proposal: Ingest 同步 → 异步四阶段状态机

## Problem

当前 `ingestPipeline/pipeline.ts:runPipeline` **同步串行**：HTTP 请求等完 "asset 入库 + 图片落档 + metadata_field + embedding + tag" 全链路才返回。对大 PDF（VLM caption 单图数秒）、慢 embedding（硅基流动偶发限流）、大量批量扫描任务，HTTP 超时频发，前端表现是"转圈 30-60 秒后报错"。

骨架其实已在：`services/jobRegistry.ts` 有完整的 LRU + phase 枚举 + 日志 + 预览；`routes/ingestJobs.ts` 有查询端点。缺两件事——**状态持久化**（进程重启即丢）与**HTTP 早返回**（注册 job 后立刻 202 Accepted，不等 runPipeline）。

参考来源：ADR-39（WeKnora 借鉴点对照）/ OQ-INGEST-1。详细探索 see `docs/superpowers/specs/ingest-async-pipeline/explore.md`。

## Scope（本 change）

1. **DB 结构**：
   - `metadata_asset` 追加 `ingest_status ENUM` 与 `ingest_error TEXT` 两列；
   - 新建 `ingest_job` 表作为持久化任务队列，复用 `jobRegistry` 词汇。
2. **Worker**：`apps/qa-service/src/services/ingestWorker.ts`，`SELECT ... FOR UPDATE SKIP LOCKED` 取 `queued` job，并发上限 `INGEST_WORKER_CONCURRENCY`（默认 2）；进程退出前把 `in_progress` job 安全回滚为 `queued`。
3. **HTTP 契约变更**（向后兼容）：
   - `POST /api/knowledge/ingest`、`/api/ingest/fetch-url`、`/api/ingest/scan-folder` 改为**默认 202 Accepted + `{job_id, ingest_status:'queued'}`**；
   - 新增 `?sync=true` 查询参数：小文件（< `INGEST_ASYNC_THRESHOLD_BYTES`，默认 2 MiB）或老客户端可强制同步路径；
   - 新增 `GET /api/ingest/jobs/:id/stream`（SSE）供前端订阅进度；
   - `GET /api/ingest/jobs` / `GET /api/ingest/jobs/:id` 读 DB（内存 `jobRegistry` 降级为热缓存）。
4. **Metadata 新字段对接**：`metadata_asset.ingest_status` 在 pipeline 结束时由 worker 统一置为 `indexed` / `failed`，供前端筛选与 eval 避开未就绪资产。
5. **可观测性**：每次 phase 切换 emit 结构化日志 `ingest_phase`；worker 启停 emit `ingest_worker_started` / `..._stopped`。
6. **降级策略**：
   - `ingest_job` 表未迁移成功 / worker 未启动 → 所有入口 fallback 到老同步路径并 WARN；
   - 现有 `?sync=true` 参数永久保留作为逃生路径。

## Out of Scope

- 跨节点 worker（引入 Redis / advisory lock；当前单节点部署足够）；
- 失败 job 自动回滚已入库的 chunks/images（保留 ADR-30 + `find-zombie-assets.mjs` 手动清理路径）；
- 子阶段重试粒度（如"只重跑 VLM 不重跑 parse"；MVP 粗粒度整体重跑）；
- 任务优先级 / 动态并发（FIFO 即可，env var 静态配）；
- BookStack sync 路径的异步化改造（`syncWorker.ts` 已是后台作业，维持不变）；
- 前端 `/ingest` 页面 UI 大改造（仅最小改动支持 SSE 订阅 + 重启后列表持久化）；
- 历史数据回填 `ingest_status` 的策略（migration 一次性填 `'indexed'` 即可）。

## Success Metrics（OpenSpec 合并后由执行方验证）

- `POST /api/knowledge/ingest` 对大 PDF 的 **p95 HTTP 响应时间 ≤ 200ms**（当前 >10s）；
- `ingest_job` 表任意时刻 `status='queued'` 数量 > 0 时 worker 必须在 ≤ 3s 内取走（intervalMs 默认 500，并发 2）；
- 进程 SIGTERM 后重启，之前 `in_progress` 的 job 在 5s 内被重置为 `queued` 并继续；
- 老客户端走 `?sync=true` 路径行为**字节级兼容**当前同步路径；
- `pnpm -r exec tsc --noEmit` / `pnpm -r test` 全绿；
- eval-recall@5 不因异步化发生变化（异步不应影响召回，但必须验证）。
