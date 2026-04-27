# ADR 2026-04-24-40 — Ingest 异步四阶段状态机

> 工作流 B · `superpowers-openspec-execution-workflow`。
> 契约：`openspec/changes/ingest-async-pipeline/{proposal,design,tasks}.md + specs/ingest-job-spec.md`
> 归档：`docs/superpowers/archive/ingest-async-pipeline/`
> 关联 Open Question：`OQ-INGEST-1`（关闭）
> 上游：ADR-39（WeKnora 借鉴点） / ADR-30（asset DELETE）

## Context

`services/ingestPipeline/pipeline.ts:runPipeline` 是**同步串行**：HTTP 请求要等到 "INSERT metadata_asset + 图片落档 + metadata_field + embedding + tag" 完成才返回。对于大 PDF（VLM caption 每张图片数秒）、慢 embedding（硅基流动偶发限流）、批量扫描，HTTP 侧长时间阻塞并易超时。

`services/jobRegistry.ts` 已经有完整的 LRU + phase 枚举 + 日志 + 预览，`routes/ingestJobs.ts` 有查询端点；唯一的问题是**状态只在内存、进程重启即丢**。所以方案不是"从零建任务队列"，而是**把 jobRegistry 的状态落地 + 补一个 worker 消费者 + HTTP 早返回**。

## Decision

### D-001 方案选 B：DB 状态机 + in-proc setInterval worker

方案评估见 `openspec/changes/ingest-async-pipeline/proposal.md`：

| 方案 | 代价 | 风险 |
|---|---|---|
| A HTTP timeout 拉高 | 0 | 不治本 |
| **B DB 状态机 + in-proc worker** ✓ | 中 | 单节点；但 qa-service 本身是单节点部署 |
| C BullMQ + Redis | 大 | compose 多加一个服务；当前规模过度设计 |
| D PG LISTEN/NOTIFY + 独立进程 | 中 | 进程边界复杂 |

关键：无新中间件，worker 跑在 qa-service 进程内；未来若多节点再换 Redis/BullMQ 的接口代价可控（`ingest_job` 表作为 durable log 可继续用）。

### D-002 双层 phase/status 枚举

- `ingest_job.phase` 细粒度（`pending/parse/ocr/table/chunk/tag/embed/done/failed/paused`）—— 复用 `jobRegistry.JobPhase`；
- `ingest_job.status` / `metadata_asset.ingest_status` 粗粒度（`queued/in_progress/indexed/failed/cancelled`）—— 用于索引与前端筛选。
- `phaseToStatus(phase)` 单点映射，`metadata_asset.ingest_status` 上加**部分索引** `WHERE ingest_status <> 'indexed'`，既要查询性能又不让大多数 indexed 行占索引空间。

### D-003 写 DB fire-and-forget；读路径 DB 优先

- **写**：`jobRegistry` 所有 mutation 在内存之外 `pool.query(...).catch(dbWarn)`。DB 挂了业务不阻塞，60s 去重 WARN，保持"没 PG 也能跑"的既有兼容性。
- **读**：`routes/ingestJobs.ts` 的 `GET /jobs` 和 `GET /jobs/:id` 先查 DB（真相源），DB 挂时再回落内存；`dbGetJob` 命中后顺带 `adoptJob(row)` 写回内存 LRU，下次即热缓存。
- **Worker 认领**：通过 `adoptJob(dbRow)` rehydrate 内存 JobRecord，之后一路使用既有 `updatePhase / finish / fail / appendLog`，触发 DB UPDATE + 内存同步。

### D-004 裁剪"小文件自动同步"为 MVP 简化

proposal.md §Scope 最初写了 "body ≤ `INGEST_ASYNC_THRESHOLD_BYTES` 自动走同步路径"。实现阶段权衡后**裁剪**：

- 前端 `uploadFull` 当前返回 `{jobId: string}`；若服务端自动小文件同步，前端得处理 `{jobId} | {assetId,...}` union 类型 + 分支逻辑，波及 `UploadTab` / `JobQueue` / `PreprocessingModule` 多处。
- 决定：所有非 `?sync=true` 请求都走异步队列；前端 `{jobId}` 合约一字不改。`INGEST_ASYNC_THRESHOLD_BYTES` 环境变量保留占位（在 `.env.example` 里标"占位，未生效"），留给 Phase E 按实际负载决定是否启用。
- 代价：小文件也要经过一次 worker 轮询（≤ 500ms 延迟）。实测可接受。

### D-005 SSE 走 server 端 DB 轮询而不是 PG LISTEN/NOTIFY

- 实现：`GET /api/ingest/jobs/:id/stream` 每 `INGEST_SSE_POLL_MS`（默认 250ms）查一次 DB，比对 phase/progress/log 差值推送。15s `:ping` keepalive；终态后 `res.end()`。
- 理由：`LISTEN/NOTIFY` 的 pool 连接语义在 node-pg 里要常驻连接 + reconnect 逻辑；当前规模（≤ 几十并发订阅）轮询够用。留为 Phase E 升级点。

### D-006 Cancel 走"DB status 被改 → worker 每秒轮询探测 → 抛 JobCancelledError"

- ADR-30 DELETE 端点在 Phase F 需要补一句 `UPDATE ingest_job SET status='cancelled' WHERE asset_id=$1 AND status='in_progress'`（见 Follow-up）。
- 当前 Phase 只做 worker 侧的探测：`runOne` 执行中每 1s `SELECT status`，检测到 `cancelled` 即 abort AbortController → 抛 `JobCancelledError` → `stats.cancelled++`、不调 `fail()`（避免 DB status 被覆盖为 failed）。
- 验证：`__tests__/ingestWorker.test.ts` 有对应 case。

## Consequences

### 正向

- 大文件上传 HTTP 响应从 >10s 降到 ≤ 200ms（理论值；待生产数据验）
- 进程崩溃后，下一次启动 `resetInProgressJobs()` 把 stale `in_progress` 行批量回滚为 `queued`，worker 自然重试
- jobRegistry 的内存/DB 双写保留了"没 PG 也能跑"的现有兼容性
- ADR-30 DELETE 与 ingest 的竞态有明确处置路径（worker 侧已就位）
- `openspec/changes/ingest-async-pipeline/design.md` 与 archive 副本在归档时刻一致

### 负向

- 默认异步路径对小文件加 ~500ms 延迟（worker tick）。若实测扰动大，启用 D-004 里裁剪的自动同步门槛
- `routes/ingest.ts` 的 `/fetch-url` 与 `/conversation` **未**异步化（仍 void fire-and-forget）——进程重启仍会丢这两个入口的 in-flight 任务。当前认知其流量很低，可接受
- SSE 轮询 DB 对并发订阅数扩展性有限（≤ 几十 OK，更大需升 LISTEN/NOTIFY）
- 部分测试（SIGTERM grace 精确值）是弱形式，需 Phase E 用 fake timer 补

### 归档后副本与活契约的差异治理

- 归档副本（`docs/superpowers/archive/ingest-async-pipeline/`）是**完成时刻快照**
- 活契约（`openspec/changes/ingest-async-pipeline/`）保留给未来引用（Phase E 的扩展将在活契约里追加，按 ADR-39 D-003 开的先例）
- 归档时两份副本一字一致；后续若活契约追加"Phase E 路线图"，参照 ADR-39 D-003 的处置方式

## 实施与验证

### 代码落盘（~2800 行）

**Phase A · 后端基础设施（~1210 行）**

| 文件 | 类型 | 变更规模 |
|---|---|---|
| `services/pgDb.ts` | 修改 | +50 行 · 2 列 + 1 表 + 2 索引 |
| `services/jobRegistry.ts` | 修改 | 233 → 420 行 · 7 个 mutation 挂 DB hook + `adoptJob` + `phaseToStatus` + `dbWarn` 去重 |
| `services/ingestPipeline/pipeline.ts` | 修改 | +50 行 · `PipelineProgress` 类型 + 3 个 emit 点 |
| `services/ingestPipeline/index.ts` | 修改 | +90 行 · `enqueueIngestJob` + `IngestEnqueueError` |
| `services/ingestWorker.ts` | **新建** | 318 行 · worker 全部逻辑 |
| `index.ts` | 修改 | +25 行 · 启停 hook |
| `.env.example` | 修改 | +10 行注释 |

**Phase B · HTTP 层（~1062 行）**

| 文件 | 类型 | 变更规模 |
|---|---|---|
| `routes/ingest.ts` | 修改 | +70 行 · upload-full 三分支 |
| `routes/ingestJobs.ts` | 重写 | 81 → 257 行 · SSE + DB 读回落 |
| `apps/web/src/api/ingest.ts` | 修改 | +60 行 · `streamJob` SSE helper |

**Phase C · 测试（~600 行新增）**

| 文件 | 类型 | cases |
|---|---|---|
| `__tests__/ingestWorker.test.ts` | **新建** | 5 · claim/concurrency/cancel/rollback/reset |
| `__tests__/ingestRoutesAsync.test.ts` | **新建** | 6 · 异步/sync/fallback/DB miss/SSE |
| `__tests__/ingestPipeline.pipeline.test.ts` | 扩充 | +3 · progress 回调 / 异常吞掉 / 向后兼容 |

### 验证（用户 Mac · 2026-04-24 15:00）

- `pnpm -r exec tsc --noEmit` · qa-service / mcp-service / web **三包全绿**
- `pnpm --filter qa-service test` · **Test Files 52 passed / Tests 323 passed (323)** · 13.08s
- `pnpm dev:up` 启动日志出现 `✓ ingest worker started · concurrency=2 · interval=500ms` ✅（用户实测）

**已知不在 MVP 验收 checklist 但需生产观察**：
- 大 PDF p95 ≤ 200ms
- SIGTERM 后 ≤ 5s 重新消费
- `eval-recall` recall@5 仍 1.0（异步化不碰召回链路）

## Follow-up（Phase E / F · 本 ADR 之外）

1. **PreprocessingModule / UploadTab 升级为 SSE 订阅**：当前 `setInterval(getJob, POLL_MS)` 已可用（DB 读回落已到位），SSE 是用户感知优化。对应 `streamJob()` helper 已放在 `apps/web/src/api/ingest.ts` 待用。
2. **`infra/docker-compose.yml:qa_service.environment` 补齐 5 个 `INGEST_*` 变量默认值**（当前用 `process.env.*` fallback 生效，不阻塞功能但不可审计）
3. **`/api/ingest/fetch-url` 与 `/api/ingest/conversation` 异步化**：当前仍 `void runIngestAndTrack(...)` fire-and-forget；流量低、单次耗时短，但进程重启会丢
4. **ADR-30 DELETE 端点联动 `UPDATE ingest_job SET status='cancelled' ...`**：当前 worker 侧探测已就位，DELETE 端点写入是另一半
5. **SSE 端点的非 owner 403 测试**（当前 admin principal 绕行；需 non-admin mock）
6. **SIGTERM grace 真实值的测试**（需 `vi.useFakeTimers()` 重写）
7. **Phase E 评估是否启用"小文件自动同步"**：看生产数据里 < 2 MiB 上传的 p95 延迟是否被 worker tick 拖慢
8. **SSE 升级为 PG LISTEN/NOTIFY**：若并发订阅数突破几十量级

## Links

- 设计 / 执行 / 契约：`openspec/changes/ingest-async-pipeline/`
- 归档副本：`docs/superpowers/archive/ingest-async-pipeline/ARCHIVED.md`
- Explore 草稿（历史）：`docs/superpowers/specs/ingest-async-pipeline/explore.md`
- 上游借鉴：ADR-39 `weknora-borrowing-map` D-001 第 3 条（"Ingest 异步四阶段状态机"⭐⭐⭐ 匹配）
- 相关联动：ADR-27 `knowledge-graph-age`（不影响）、ADR-30 `asset-delete`（Follow-up 4）、ADR-33..35 `ontology-*`（不影响）
