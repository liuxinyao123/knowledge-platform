# Spec: Ingest Async Job

## enqueueIngestJob

**Scenario: 首次 enqueue 成功**
- Given worker 已启动，`INGEST_ASYNC_ENABLED=true`
- When 调 `enqueueIngestJob({source_id: 1, name: 'a.pdf', bytes, kind: 'upload', created_by: 'u@x'})`
- Then 响应 `{job_id: <uuid>}`
- And `ingest_job` 表中存在 `status='queued', phase='pending', progress=0` 的新行
- And bytes 已写到 `bytes_ref` 路径（`os.tmpdir()/ingest-<jobId>`）
- And `metadata_asset` 表**无**新行（要等 worker 执行到 upsertAsset 才插入）

**Scenario: DB 写失败时返回明确错误**
- Given PG 不可达
- When 调 `enqueueIngestJob(...)`
- Then 抛 `IngestEnqueueError` 且消息包含原因
- And **不**落盘 bytes_ref（避免孤儿文件）

## HTTP `POST /api/knowledge/ingest`

**Scenario: 大文件（> 2 MiB）默认走异步**
- Given body 大小 = 5 MiB，未传 `?sync`
- When 发起请求
- Then 响应 `202 Accepted`
- And body 为 `{"job_id":"<uuid>","ingest_status":"queued","sync":false}`
- And HTTP 响应时间 ≤ 200ms

**Scenario: 小文件（≤ 2 MiB）自动走同步**
- Given body 大小 = 500 KiB，未传 `?sync`
- When 发起请求
- Then 响应 `200 OK`
- And body 为 `{"asset_id":<int>,...,"sync":true}`（形状等同旧版 + `sync` 字段）

**Scenario: `?sync=true` 强制同步**
- Given body 大小 = 10 MiB（本该异步），查询 `?sync=true`
- When 发起请求
- Then 响应 `200 OK` 且 body 为旧版 `{asset_id, chunks, images, ...}` 结构
- And 当请求过程中 SIGTERM 被触发，响应依然完整返回（同步路径不走 worker）

**Scenario: `INGEST_ASYNC_ENABLED=false` 全部回退同步**
- Given env `INGEST_ASYNC_ENABLED=false`
- When 发起任何大小的请求（含大文件）
- Then 全部响应 `200 OK + {asset_id, ...}`（同步路径）
- And 服务启动日志出现 `[ingest] async disabled, running sync-only`

## Worker 执行

**Scenario: Worker 按 FIFO 认领 job**
- Given 表中已有 3 个 `status='queued'` 的 job，`created_at` 分别为 T0, T1, T2（T0 最早）
- When worker 并发=1 跑一轮
- Then **T0 的 job** 被认领（`status='in_progress'`），其余两个仍 `queued`

**Scenario: Worker 并发上限生效**
- Given 10 个 queued job，`INGEST_WORKER_CONCURRENCY=2`
- When worker 连续 tick 5 次
- Then 任意时刻 `SELECT count(*) FROM ingest_job WHERE status='in_progress'` ≤ 2

**Scenario: 成功完成 → indexed**
- Given worker 拿到一个 kind='upload' 的 job，文件合法
- When pipeline 正常执行完
- Then `ingest_job.status='indexed'`, `progress=100`, `finished_at IS NOT NULL`, `error IS NULL`
- And `metadata_asset.ingest_status='indexed'`

**Scenario: 任一 phase 抛异常 → failed**
- Given worker 执行中 `embed` 阶段抛异常 `Error: 429 rate limit`
- When pipeline 捕获
- Then `ingest_job.status='failed'`, `phase='embed'`, `error='Error: 429 rate limit'`
- And `metadata_asset.ingest_status='failed'`（若 asset 已插入）
- And `metadata_asset.ingest_error='Error: 429 rate limit'`
- And 不影响 worker 继续认领下一个 queued job

**Scenario: 进程崩溃 → 重启后 in_progress 回滚 queued**
- Given 进程 A 在 job J 的 `chunk` 阶段崩溃（无清理机会），此时 `ingest_job.status='in_progress'`
- When 进程 B 启动
- Then 启动 hook 执行 `UPDATE ingest_job SET status='queued' WHERE status='in_progress'`
- And worker B 在下一个 tick 重新认领 J
- And J 从 `parsing` 阶段重新跑（粗粒度重试，不支持断点续传）

**Scenario: SIGTERM 优雅关停**
- Given worker 有 1 个 in_progress job J
- When 进程收到 SIGTERM，`SHUTDOWN_GRACE_MS=30000`
- Then worker 停止认领新 job
- And 若 J 在 30s 内完成：正常 `indexed/failed`
- And 若 J 未完成：`status` 回滚为 `queued`，进程退出

## ADR-30 DELETE 竞态

**Scenario: DELETE 在 job queued 阶段触发**
- Given job J 的 asset 还未被插入，job `status='queued'`
- When DELETE `/api/metadata/asset/:id`（按 ADR-30）
- Then 因 asset 不存在，DELETE 返回 404（或按 ADR-30 既定行为）
- And job J 不受影响（没 asset 可删）

**Scenario: DELETE 在 job in_progress 阶段触发**
- Given job J 的 asset 已插入（`upsertAsset` 后），处于 `chunk` phase
- When DELETE `/api/metadata/asset/:asset_id`
- Then DELETE 端点额外执行 `UPDATE ingest_job SET status='cancelled' WHERE asset_id=$1 AND status='in_progress'`
- And worker 在下一个 phase 切换前 `SELECT status` 发现 `cancelled` → 抛 `JobCancelledError`
- And worker 回收 tmp 文件、清理部分 chunks（由 DELETE 的 CASCADE 完成）
- And job 最终状态 `status='cancelled'`, `error=null`（非失败）

## GET /api/ingest/jobs

**Scenario: 默认返回进行中 + 最近 50 条已完成/失败**
- Given DB 中有 3 queued、2 in_progress、100 indexed、50 failed
- When 调 `GET /api/ingest/jobs`
- Then 响应 items.length = 3 + 2 + 50 + 50 = 105
- And 按 `created_at DESC` 排序

**Scenario: `?status=failed` 过滤**
- When 调 `GET /api/ingest/jobs?status=failed`
- Then 仅返回 `status='failed'` 的条目（上限 100）

**Scenario: 老客户端轮询 job 详情**
- Given job J in_progress, phase='embed', progress=70
- When 老客户端 `GET /api/ingest/jobs/J`
- Then 响应 `{id:'J', kind:'upload', name:'a.pdf', phase:'embed', progress:70, log:[...], preview:{...}}`
- And 响应 shape 与内存版一致（字段命名 / 类型不变）

## GET /api/ingest/jobs/:id/stream (SSE)

**Scenario: 订阅成功立即收到当前快照**
- Given job J in_progress, phase='chunk', progress=60
- When 客户端 SSE 订阅 `/api/ingest/jobs/J/stream`（带 JWT）
- Then 订阅建立后 ≤ 500ms 内收到一条 `phase` 事件，data 为 `{phase:'chunk', progress:60, at:<ts>}`

**Scenario: Phase 切换推事件**
- Given 客户端已订阅 J 的 stream，worker 把 J 从 `chunk` 推进到 `tag`
- When worker 调 `updatePhase(J, 'tag')`
- Then 客户端在 ≤ 500ms 内收到 `phase` 事件 `{phase:'tag', progress:75, ...}`

**Scenario: done 事件后关闭**
- Given job J 在订阅期间完成
- When 最终状态 `indexed`
- Then 客户端收到一条 `done` 事件 `{ingest_status:'indexed', asset_id:<id>}`
- And server 主动关闭连接

**Scenario: 非 owner 订阅被拒**
- Given job J 由 `u1@x` 创建
- When `u2@x`（不具备 READ 权限）订阅
- Then 响应 `403 Forbidden`

**Scenario: keepalive ping**
- Given 客户端订阅并保持连接 60s 不发生任何 phase 变化
- Then 期间至少收到 3 条 `:ping` 注释事件（每 15s 一次）

## 鉴权

**Scenario: 未登录访问异步入口**
- When 匿名 `POST /api/knowledge/ingest`
- Then 响应 `401 Unauthorized`

**Scenario: 异步入口写 job 使用调用者 email**
- Given `requireAuth` 注入 `principal={email:'u@x', ...}`
- When 调用异步入口
- Then `ingest_job.created_by='u@x'`

## 向后兼容

**Scenario: 老客户端不知 `?sync` 参数且上传大文件**
- Given 老客户端 POST 大文件（不传 `?sync`），期望 200 响应
- When 异步路径返回 202
- Then 老客户端可能报错（预期风险）
- Note: 前端本次 change 同步升级；外部集成方需升级到 SSE 订阅或使用 `?sync=true`

**Scenario: `pnpm eval-recall` 不变**
- Given 异步化合并后
- When 跑 `pnpm eval-recall eval/gm-liftgate32-v2.jsonl`
- Then recall@5 与 PROGRESS-SNAPSHOT-2026-04-24-ontology §八 记录的 1.000 一致
