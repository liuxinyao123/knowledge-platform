# Explore · Ingest 同步→异步 + 状态持久化

> 工作流 B · `superpowers-openspec-execution-workflow`
> 来源：OQ-INGEST-1（`.superpowers-memory/open-questions.md`）· ADR-39 D-001/D-004
> Phase：Explore（不进主分支，OpenSpec 合并后归档到 `docs/superpowers/archive/ingest-async-pipeline/`）

---

## 1. 动机

### 现存痛点

`ingestPipeline/pipeline.ts` 是**同步串行**：HTTP 请求必须等到 "asset 入库 + 图片落档 + field 写入 + embedding + tag 提取" 全部完成才返回。对于大 PDF（VLM caption 每张图片数秒）或慢 embedding（硅基流动偶发限流），HTTP 侧会超时，前端体验是"转圈 60 秒后报错"。

### 已有骨架

| 模块 | 现状 | 缺什么 |
|---|---|---|
| `services/jobRegistry.ts` | 内存注册表，phase 枚举（parse/ocr/table/chunk/tag/embed/done/failed/paused），进度权重，日志与预览 | **非持久化**（进程重启清空） |
| `routes/ingestJobs.ts` | `GET /api/ingest/jobs` / `GET /api/ingest/jobs/:id` HTTP 查询 | 无 |
| `routes/ingest.ts` | 4 处调 `updatePhase(jobId, 'parse'/'ocr'/...)` | **HTTP 仍同步等整个 pipeline 完成** |
| `services/syncWorker.ts` | BookStack 全量同步，和 ingest 是不同用途 | —（误会一下，不要复用） |

所以**真正要做的不是"从零建状态机"**，而是"把内存 jobRegistry 落地到 DB + 让 HTTP 早返回"。

---

## 2. 读的代码

- `apps/qa-service/src/services/jobRegistry.ts`（完整 LRU + phase + preview）
- `apps/qa-service/src/routes/ingest.ts`（4 种入口：upload / fetch-url / batch / scan-folder）
- `apps/qa-service/src/routes/ingestJobs.ts`（HTTP 查询端点）
- `apps/qa-service/src/services/ingestPipeline/pipeline.ts`（`runPipeline` 真身，同步调 DB）
- `apps/qa-service/src/services/ingestPipeline/router.ts`（按扩展名路由到 extractor）
- `apps/qa-service/src/services/folderScan.ts`（批量扫描走同一 pipeline）

### 4 条 ingest 入口现状

| 入口 | 当前行为 | 异步化后行为 |
|---|---|---|
| `POST /api/knowledge/ingest`（单文件上传） | 同步跑完 pipeline，返回 asset_id | 返回 `{job_id, ingest_status:'queued'}`，前端订阅 SSE |
| `POST /api/ingest/fetch-url` | 抓 URL + 同步 pipeline | 同上 |
| `POST /api/ingest/scan-folder`（批量）| 串行 N 个文件同步 | N 个独立 job 异步并行（受 concurrency 限流）|
| BookStack sync（`syncWorker.ts` / `indexBookstackPage.ts`）| 定期任务 | 不变（已是后台作业） |

---

## 3. 候选方案评估

| 方案 | 改动面 | 依赖 | 风险 | 评分 |
|---|---|---|---|---|
| A 完全不做异步，只把 HTTP timeout 提到 5 min | 0 | 无 | 不解决根因；前端仍在等 | ✗ |
| B DB 状态机 + setInterval 轮询 worker（in-proc） | 中 | 只用已有 `pg_db` | 单节点，扩展性有限；但 qa-service 目前就是单节点 | ✓ **本 change 采用** |
| C 引入 BullMQ + Redis 队列 | 大 | 新中间件 | compose 多一个服务；小规模过度设计 | 未来阶段 |
| D 用 PostgreSQL `LISTEN/NOTIFY` + 独立 worker 进程 | 中 | 已有 pg | 进程边界复杂 | 未来阶段 |

**选 B** 的理由：

1. 无新组件；qa-service 内部起一个 `ingestWorker` 模块（`setInterval` 或 `async while`），DB 作为任务队列。
2. 和现有 jobRegistry API 表面最接近，改动局限在 "存储层" 而非 "调用层"。
3. 可演进：一旦出现多节点或高并发，换成 BullMQ 的接口成本可控（DB 表本身可继续作为 durable log）。

---

## 4. 推荐范围（进 OpenSpec 的粗粒度）

### 4.1 数据库

- `metadata_asset` 加两列：`ingest_status ENUM('queued','parsing','ocr','table','chunk','tag','embed','indexed','failed')`（复用 jobRegistry 现有 phase 词汇，+ `queued`/`indexed`）、`ingest_error TEXT NULL`
- 新表 `ingest_job`（持久化 jobRegistry 语义）：
  ```
  id UUID PRIMARY KEY
  asset_id INT NULL          -- pipeline 到 INSERT asset 后回填
  kind VARCHAR                -- upload/fetch-url/batch/scan-folder
  source_id INT
  name TEXT
  input_payload JSONB         -- 原始请求数据（含 bytes 字段不入，只存 ref）
  status VARCHAR              -- 同 ingest_status 枚举
  phase_started_at TIMESTAMPTZ
  last_progress INT           -- 0-100
  error TEXT NULL
  log JSONB                   -- 精简版日志尾部（最近 50 条）
  preview JSONB               -- chunks/images/tags
  created_at / updated_at / finished_at
  created_by TEXT
  ```

### 4.2 HTTP 接口

- `POST /api/knowledge/ingest` 新返回 `202 Accepted + {job_id, ingest_status:'queued'}`；
- **`?sync=true` 兼容参数**：小文件 / 老客户端可继续走同步路径（阈值 `INGEST_ASYNC_THRESHOLD_BYTES` 默认 2 MiB，超阈强制异步）；
- 新增 `GET /api/ingest/jobs/:id/stream`（SSE），前端订阅进度 / phase / preview / done；
- `GET /api/ingest/jobs` / `GET /api/ingest/jobs/:id` 行为对齐 DB（原内存 API 降级为内存缓存层，命中即用、否则查 DB）。

### 4.3 Worker

- `apps/qa-service/src/services/ingestWorker.ts`：
  - `startWorker(intervalMs=500)`；
  - 每 tick 用 `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N` 取 `status='queued'` 的 job；
  - 并发上限 `INGEST_WORKER_CONCURRENCY`（默认 2）；
  - 每个 job 跑完现有 `runPipeline`，phase 变化回写 DB（沿用 `updatePhase` 语义，目标从 registry 改为 DB）；
  - 进程退出时把 `in_progress` job 安全标回 `queued`（下次启动时继续）。

### 4.4 前端

- `/ingest` 页从"轮询 `GET /api/ingest/jobs` 每 2s"改为"订阅 SSE `/api/ingest/jobs/:id/stream`"；
- 上传按钮改为"提交后立即关闭 modal，进度条出现在 job 列表"；
- 重启进程刷新后 job 列表仍可见（DB 持久化副作用）。

### 4.5 Out of Scope

- **跨节点 worker**（会引入 Redis 或 PG advisory lock 复杂度；当前单节点部署）；
- **失败回滚**（失败 job 只标 `status=failed`，不自动清理已部分入库的 chunks/images —— 由 `find-zombie-assets.mjs` + ADR-30 DELETE 处置；单独一个 follow-up change 做自动清理）；
- **任务优先级**（FIFO 即可，不做 priority queue）；
- **子阶段重试粒度**（比如"只重跑 VLM 不重跑 parse"；第二期再说）；
- **动态 concurrency**（观察 VLM / embedding 后端负载再说）。

---

## 5. 风险

### 高

- **VLM 超时的重试语义**：当前 VLM 失败 chunk 保留无 caption。异步化后如果整个 job 标 `failed`，下次重试是整个重跑还是只重 VLM？**建议 MVP 粗粒度整体重跑**，重试细化放 follow-up。
- **并发引入的数据竞态**：2 个 job 同时处理同一 source 下的不同文件 OK；但同一 `(file_source_id, external_id)` UPSERT 在并发下有 PG constraint 保护（已存在 unique index），风险可控。
- **内存 jobRegistry 与 DB 双写**：过渡期若 registry 先写、worker 后读，查询 API 可能读到不一致。**建议 DB 作为唯一真相，registry 降级为 per-request 缓存**，或直接移除。

### 中

- **前端兼容性**：老客户端不发 SSE 订阅，会一直轮询 `/api/ingest/jobs/:id`。DB 持久化保证轮询能拿到最新状态，但流量比 SSE 大。验收加一条 "polling fallback 可用"。
- **ADR-30 DELETE 与异步状态竞态**：用户在 job 跑一半时删 asset。需要 worker 在每步前 `SELECT ... WHERE NOT deleted`，检测到删除即 abort job 并标 `failed(reason=asset_deleted)`。
- **BookStack sync 路径**：目前走 `syncWorker.ts`，不走 `ingestPipeline`。异步化后是否统一？**建议不动，BookStack sync 作为独立调度**，但其产生的 chunk 写入时也更新 `metadata_asset.ingest_status='indexed'` 保持语义一致。

### 低

- `ingest_job.log` / `preview` JSONB 列随 job 积累可能变大。上限硬截：log 只留最近 50 条、preview 只存最终态（不存中间态）。
- `FOR UPDATE SKIP LOCKED` 在 PG < 9.5 不可用 —— 项目 PG 16，无风险。

---

## 6. 前置条件

- [x] eval recall@5 = 1.000 基线（PROGRESS-SNAPSHOT-2026-04-24-ontology §八）——异步化后再跑一次，确认 recall 不受影响（异步不应该影响召回，但验收必须）。
- [x] `metadata_asset` / `metadata_field` / `metadata_asset_image` 表结构稳定（近期 ADR-28/29/30/31/32 已收敛）。
- [ ] 需要 review：`jobRegistry.ts` 是否被前端 `/ingest` 页之外的地方消费（例如 eval 或 BookStack sync）。Explore 阶段未全量核对，OpenSpec proposal 阶段需要 grep 补齐。

---

## 7. 给 OpenSpec 阶段的关键问题

1. **`ingest_status` 是放在 `metadata_asset` 还是只放 `ingest_job`？** 建议两边都放——asset 上留 enum 方便查询"哪些资产还未就绪"（前端 / eval 过滤），job 表保留完整历史。
2. **阈值 `INGEST_ASYNC_THRESHOLD_BYTES` 合理默认值**：2 MiB 偏保守；需要结合实际上传样本分布决定。
3. **SSE 端点鉴权**：复用 `requireAuth` + `enforceAcl('READ', {asset_id})`？但 job 初始阶段 asset_id 为 null，需要用 `created_by` 做 owner 检查替代。
4. **worker 进程边界**：MVP 内嵌到 qa-service 进程（启动时 `startWorker()`），还是独立 `ingest-worker` 进程？**建议 MVP 内嵌**，减少 compose 复杂度；Phase 2 视负载再拆。
5. **历史数据迁移**：已入库 asset 的 `ingest_status` 默认值？建议统一填 `'indexed'` 不报错即可。

---

## 8. 预估工作量

| 阶段 | 人天 | 说明 |
|---|---|---|
| OpenSpec 契约（proposal + design + tasks + specs） | 0.5 | D 流程就能完成；锁 HTTP 与 DB 契约 |
| DB migration 落 qa-service pgDb.runPgMigrations | 0.3 | 两列 + 一表 + unique index |
| `ingestWorker.ts` + `runPipeline` 迁移 | 1.0 | 拿现有 `runPipeline` 改回调式进度 |
| 路由改造（`routes/ingest.ts` + `routes/ingestJobs.ts` + SSE） | 0.8 | 兼容 `?sync=true` |
| 前端 `/ingest` 页 SSE + 上传 flow | 0.5 | TanStack Query 订阅 SSE |
| 测试（单元 + 集成 + eval 回归） | 0.8 | 含并发场景 |
| 归档 + PROGRESS-SNAPSHOT | 0.2 | |
| **合计** | **~4.1 人天** | 不含联调与回归边缘 case |
