# Design: Ingest Async Pipeline

## 模块与调用位置

```
apps/qa-service/src/
  services/
    ingestWorker.ts              ← 本 change 新增（in-proc setInterval worker）
    jobRegistry.ts               ← 本 change 修改（DB 写入 + 内存降级为热缓存）
    ingestPipeline/
      index.ts                   ← 本 change 修改（入口接 job_id）
      pipeline.ts                ← 本 change 修改（phase hook 回调签名化）
      router.ts                  ← 不变
      extractors/*               ← 不变
  routes/
    ingest.ts                    ← 本 change 修改（同步路径 + 异步 202 + ?sync=true）
    ingestJobs.ts                ← 本 change 修改（DB 读 + SSE 端点）
  auth/
    requireAuth.ts               ← 复用
    evaluateAcl.ts               ← 复用（SSE 端点需 owner 或 READ 鉴权）
  index.ts                       ← 修改（启动时 `ingestWorker.start()`，SIGTERM 时 stop）
  services/
    pgDb.ts                      ← 修改（runPgMigrations 追加 ingest_job DDL 与 ingest_status 列）
```

---

## 数据结构

### DB 迁移（内联到 `pgDb.runPgMigrations()`，幂等）

```sql
-- 1. metadata_asset 增列
ALTER TABLE metadata_asset
  ADD COLUMN IF NOT EXISTS ingest_status VARCHAR(16) NOT NULL DEFAULT 'indexed',
  ADD COLUMN IF NOT EXISTS ingest_error  TEXT;

CREATE INDEX IF NOT EXISTS idx_metadata_asset_ingest_status
  ON metadata_asset(ingest_status)
  WHERE ingest_status <> 'indexed';  -- 部分索引：只在未就绪时占用

-- 2. ingest_job 表
CREATE TABLE IF NOT EXISTS ingest_job (
  id              UUID PRIMARY KEY,
  asset_id        INT NULL REFERENCES metadata_asset(id) ON DELETE SET NULL,
  kind            VARCHAR(32) NOT NULL,   -- upload/fetch-url/batch/scan-folder
  source_id       INT NULL,
  name            TEXT NOT NULL,
  input_payload   JSONB NOT NULL,         -- 原始参数（不含 bytes，仅 ref / url）
  bytes_ref       TEXT NULL,              -- 文件字节暂存路径（os.tmpdir/ingest-<jobId>）
  status          VARCHAR(16) NOT NULL DEFAULT 'queued',
  progress        SMALLINT NOT NULL DEFAULT 0,
  phase           VARCHAR(16) NOT NULL DEFAULT 'pending',
  phase_started_at TIMESTAMPTZ NULL,
  error           TEXT NULL,
  log             JSONB NOT NULL DEFAULT '[]'::jsonb, -- 最近 50 条日志
  preview         JSONB NOT NULL DEFAULT '{}'::jsonb, -- 最终态预览
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ NULL,
  created_by      VARCHAR(255) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_job_status_created
  ON ingest_job(status, created_at)
  WHERE status IN ('queued', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_ingest_job_created_by ON ingest_job(created_by);
```

### `ingest_status` 枚举

| 值 | 语义 |
|---|---|
| `queued` | 已入表等 worker 认领 |
| `parsing` / `ocr` / `table` / `chunk` / `tag` / `embed` | 对应 `jobRegistry.JobPhase`（直接复用词汇） |
| `indexed` | 成功结束（对应老 phase 'done'） |
| `failed` | 失败，`ingest_error` 非空 |
| `cancelled` | 用户或 ADR-30 DELETE 触发中断 |

**`metadata_asset.ingest_status`** 仅有 `queued / in_progress / indexed / failed / cancelled` 五种粗粒度（不复制 phase 细粒度），避免 UPDATE 风暴。细粒度 phase 仅存 `ingest_job.phase`。

---

## 核心 API

### `ingestWorker.ts`

```ts
export interface IngestWorkerOptions {
  intervalMs?: number          // 默认 500
  concurrency?: number         // 默认 process.env.INGEST_WORKER_CONCURRENCY || 2
  signal?: AbortSignal
}

export function startIngestWorker(opts?: IngestWorkerOptions): IngestWorkerHandle
export interface IngestWorkerHandle {
  stop(): Promise<void>        // 等当前 in_progress job 完成或超时
  stats(): { running: number; picked: number; failed: number }
}
```

行为：

1. `setInterval(tick, intervalMs)`；
2. 每 tick 在并发窗口空闲时执行：
   ```sql
   UPDATE ingest_job SET status='in_progress', phase='parsing',
     phase_started_at=NOW(), updated_at=NOW()
   WHERE id = (
     SELECT id FROM ingest_job
     WHERE status='queued'
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
   )
   RETURNING *;
   ```
3. 拿到 job 后调 `runIngestJob(job)`（内部跑 `ingestPipeline/index.ts:ingestDocument`）；
4. 每次 phase 切换回调 `updatePhase(jobId, phase, msg)` → 写 DB + 并写内存 registry 热缓存；
5. 成功 → `status='indexed', phase='done', progress=100, finished_at=NOW()`；失败 → `status='failed', error=e.message`；
6. 进程 SIGTERM：worker 停止认领新 job；已 in_progress job 等 `SHUTDOWN_GRACE_MS`（默认 30_000ms）后若未结束强制中止并回滚 status 为 `queued`。

### 启动 / 关机 hook（`index.ts`）

```ts
// 启动
const ingestWorker = startIngestWorker({ concurrency: Number(process.env.INGEST_WORKER_CONCURRENCY) || 2 })

// 优雅关机：
process.on('SIGTERM', async () => {
  await ingestWorker.stop()
  // … 现有 shutdown 流程
})

// 启动时恢复：把 status='in_progress' 的 job 重置为 queued（前一进程非正常退出）
await pgPool.query(`
  UPDATE ingest_job SET status='queued', phase='pending', updated_at=NOW()
  WHERE status='in_progress'
`)
```

### `jobRegistry.ts` 改造

保留既有 API 签名（`createJob / updatePhase / finish / fail / mergePreview / appendLog`）向后兼容；内部改为：

- 写路径：**DB 先行**，写成功后同步内存缓存；DB 失败不阻塞（WARN + 回退内存）；
- 读路径：**先内存后 DB**，miss 时 DB 查完写回内存；
- LRU 上限不变（200）。

### HTTP 路由

#### `POST /api/knowledge/ingest`

**请求**（同当前）：`multipart/form-data` 或 `application/json` + `source_id`

**查询参数**：
- `?sync=true` —— 强制同步路径（仍返回最终 asset_id；用于小文件 / 老客户端 / 测试）

**异步路径响应**（默认）：

```json
{
  "job_id": "7f2a...",
  "ingest_status": "queued",
  "sync": false
}
```
HTTP `202 Accepted`。

**同步路径响应**（`?sync=true`）：
字节级等同当前 `{asset_id, chunks, images, ...}` 结构；HTTP `200 OK`。

**小文件自动同步**（不加 `?sync=true` 也触发）：request body 大小 ≤ `INGEST_ASYNC_THRESHOLD_BYTES`（默认 2 MiB）时 server 自动走同步路径，响应加 `sync:true`。

#### `GET /api/ingest/jobs/:id/stream` (SSE, 新增)

- **鉴权**：`requireAuth`，并检查 `job.created_by === principal.email` 或 principal 有 READ 权限；
- **事件**：
  - `phase`：`{phase, progress, at}`
  - `log`：`{level, msg, at}`
  - `preview`：`{chunks, images, tags}`
  - `done`：`{ingest_status: 'indexed'|'failed'|'cancelled', asset_id?, error?}`
- **keepalive**：每 15s emit `:ping`；
- **终止**：`done` 事件后 server 主动关闭。

#### `GET /api/ingest/jobs` / `GET /api/ingest/jobs/:id`

行为对齐 DB：
- 默认 `status IN ('queued','in_progress')` + 最近 50 条 `indexed` + 最近 50 条 `failed`；
- 支持 `?status=<v>` 过滤；
- 返回字段与当前内存版一致（job id、kind、name、phase、progress、log、preview、created_at）。

---

## ingestPipeline / pipeline.ts 集成点

当前：

```ts
export async function runPipeline(input: IngestInput, result: ExtractResult): Promise<IngestOutput>
```

异步化后签名**不变**；新增可选 `progress` 回调：

```ts
export interface PipelineProgress {
  (event: { phase: JobPhase; progress: number; msg?: string }): void
}

export async function runPipeline(
  input: IngestInput,
  result: ExtractResult,
  progress?: PipelineProgress,
): Promise<IngestOutput>
```

旧调用方（同步路径）传 `undefined`；worker 传 `(ev) => updatePhase(jobId, ev.phase, ev.msg)`。

**向后兼容**：签名只做可选参数追加；现有调用点无需改动。

---

## 前端（最小改动）

`apps/web/src/knowledge/Ingest/`：

- 上传后若返回 `202 + {job_id}`：关闭 modal，job 出现在下方列表（通过 `useEventSource`/SSE 订阅 `/api/ingest/jobs/:id/stream`）；
- 若返回 `200 + {asset_id}`（小文件自动同步）：保留当前行为；
- 列表仍调 `GET /api/ingest/jobs`，现在返回 DB 数据，重启不丢；
- **无**新建页面 / 新建组件；重用现有 `JobCard` / `JobList` 组件，只改 data source。

---

## 环境变量

```
# 全局开关（默认 on；关闭回退为同步）
INGEST_ASYNC_ENABLED=true

# 阈值
INGEST_ASYNC_THRESHOLD_BYTES=2097152   # 2 MiB；低于此值自动同步

# worker
INGEST_WORKER_CONCURRENCY=2
INGEST_WORKER_INTERVAL_MS=500
INGEST_WORKER_SHUTDOWN_GRACE_MS=30000
```

---

## 并发与竞态

### 关键场景

1. **同一 `(file_source_id, external_id)` 并发触发 ingest**：现有 UNIQUE 约束保护 asset 层；job 表允许多条，但 worker 的 `FOR UPDATE SKIP LOCKED` 在同 job_id 维度天然串行。
2. **ADR-30 DELETE 在 job 执行中触发**：
   - DELETE 端点检测 `asset.ingest_status IN ('queued', 'in_progress')` → 置 `ingest_job.status='cancelled'` + 标 `metadata_asset.ingest_status='cancelled'`；
   - worker 在每个 phase 切换前 `SELECT status FROM ingest_job WHERE id=$1`，若 `cancelled` 即 throw `JobCancelledError`，回收现场资源。
3. **进程崩溃**：`in_progress` job 在下次进程启动时统一回滚为 `queued`（见上"启动 hook"）。对"下半句写入 DB、上半句没写"的微妙窗口，接受"重新跑一遍"的粗粒度重试。

### SSE 端点的竞态

- 并发订阅同一 job 的多个客户端：每个客户端独立轮询 DB（`SELECT phase/progress FROM ingest_job WHERE id=$1`，每 250ms），worker 不直接 push。
- 避免"事件错过"：订阅开始时先发一次当前状态快照，再进入轮询差分推送。

---

## 测试策略

执行方在 `__tests__/` 下覆盖：

1. **Worker 基础**：创建 queued job → 500ms 内被 pick → phase 切换顺序正确 → 最终 `indexed`
2. **并发上限**：10 个 queued job，`concurrency=2`，任意时刻 `in_progress` ≤ 2
3. **SIGTERM 恢复**：停 worker 时 in_progress job 回滚为 queued；重启后被重新认领
4. **ADR-30 DELETE 竞态**：job in_progress 中 DELETE asset → job 变 cancelled，worker 停止该 job
5. **同步路径兼容**：`?sync=true` 的响应 shape 字节级等同旧版（snapshot test）
6. **阈值自动同步**：2 MiB 以下请求自动走同步
7. **SSE**：phase 切换能收到对应事件；done 后连接关闭
8. **DB migration 幂等**：重复调用 `runPgMigrations` 不报错
9. **老客户端 polling**：不订阅 SSE 情况下 `GET /api/ingest/jobs/:id` 也能看到进度

---

## 性能预算

- DB 连接池共用主 pg_db pool（`getPgPool`，max=10）；worker 每个 tick 至多占 1 连接；
- `SELECT ... FOR UPDATE SKIP LOCKED` 在 PG 16 上对百万级表仍 ms 级；
- SSE 客户端 250ms 轮询 × 并发 N：小规模（N < 50）忽略；未来若成瓶颈换 LISTEN/NOTIFY。

---

## 降级矩阵

| 条件 | 行为 |
|------|------|
| `INGEST_ASYNC_ENABLED=false` | 所有入口走同步路径，worker 不启动 |
| DB 迁移失败 | 启动时 WARN，回退纯同步；`/api/ingest/jobs` 返回内存版（老行为） |
| worker 启动失败 | 同上；async 入口仍接 202，但 job 不会被消费 → 需 ops 告警 |
| SSE 客户端断线 | 客户端可重连（`GET /api/ingest/jobs/:id/stream` 幂等）|
| ADR-30 cancelled | 见上文竞态说明 |

---

## 未来（Out of Scope，明确留档）

- **跨节点 worker**：引入 Redis / PG advisory lock + 进程级 leader election；
- **子阶段重试粒度**：基于 `phase_started_at` 精细化 resume；
- **优先级队列**：`ingest_job.priority SMALLINT`；
- **BookStack sync 异步化**：`syncWorker.ts` 并入同一 `ingest_job` 表。
