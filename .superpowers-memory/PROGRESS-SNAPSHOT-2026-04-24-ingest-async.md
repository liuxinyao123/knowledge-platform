# Progress Snapshot · 2026-04-24 Ingest Async Pipeline

> 今日第二根主线：`ingest-async-pipeline` 从 Explore → OpenSpec → 执行 → 测试 → 归档的
> B 工作流完整闭环。上午是 ontology 三件套（见 `PROGRESS-SNAPSHOT-2026-04-24-ontology.md`），
> 下午是这条。

## 源起

用户上午关闭 ontology 三件套后问"下一步做什么"。结合 ADR-39 WeKnora 调研，
4 条借鉴点里 KG 三路召回归并进 OAG Phase 2（ADR-39 D-002）、ReACT 量化门槛
在开发期项目不可用（OQ-AGENT-1 修订条款），剩下 **Ingest 异步化**（⭐⭐⭐ 匹配度、
无硬前置、骨架已在）是最清晰的下一步。

## 工作流节奏

| 阶段 | 产物 | 行数 |
|---|---|---|
| Explore（B 第一步） | `docs/superpowers/specs/ingest-async-pipeline/explore.md` | 170 |
| OpenSpec 契约（B 第二步） | `openspec/changes/ingest-async-pipeline/{proposal,design,tasks,specs}` | 646 |
| Phase A · 后端基础设施 | DB migration / `ingestWorker.ts` / `jobRegistry.ts` 持久化 / `runPipeline` progress / `enqueueIngestJob` / `index.ts` 启停 hook / env.example | 1210 |
| Phase B · HTTP 层 | `routes/ingest.ts` 三分支 / `routes/ingestJobs.ts` SSE + DB 读回落 / `apps/web/src/api/ingest.ts` `streamJob` helper | 1062 |
| Phase C · 测试 | `ingestWorker.test.ts` 5 cases / `ingestRoutesAsync.test.ts` 6 cases / `ingestPipeline.pipeline.test.ts` +3 cases | 600 |
| Phase D · 归档（本文件）| 本 snapshot + ADR-40 + `docs/superpowers/archive/.../ARCHIVED.md` + tasks.md 打勾 + 关 OQ-INGEST-1 | — |

**合计新增/改动代码 ~2870 行**（实现 + 测试；不含文档）。

## 关键设计决策

详见 ADR-40（`decisions/2026-04-24-40-ingest-async-pipeline.md`）：

- **D-001** 选方案 B：DB 状态机 + in-proc setInterval worker（不引 Redis / BullMQ）
- **D-002** 双层 phase/status 枚举；粗粒度 `ingest_status` 上加部分索引
- **D-003** 写 DB fire-and-forget；读 DB 优先 + 内存降级；`adoptJob` 用于 rehydrate
- **D-004** 裁剪"小文件自动同步"为 MVP 简化（前端 `{jobId}` 合约零改动）
- **D-005** SSE 走 server 端 DB 轮询而不是 PG `LISTEN/NOTIFY`
- **D-006** Cancel 通过 worker 每秒 `SELECT status` 探测

## 用户本机 Mac 验证（2026-04-24 15:00）

| 闸门 | 结果 |
|---|---|
| `pnpm install` | OK |
| `pnpm -r exec tsc --noEmit` | 三包全绿（qa-service / mcp-service / web）|
| `pnpm --filter qa-service test` | **Test Files 52 passed / Tests 323 passed** · 13.08s |
| `pnpm dev:up` | qa-service 启动日志出现 `✓ ingest worker started · concurrency=2 · interval=500ms` |

### 测试过程遇到的唯一 regression

`ingestWorker.test.ts > respects concurrency upper bound` 首跑 322/323。
根因：`__tickForTest()` 只认领当前空闲 slot 数量；手动 tick 2 次 + sleep 100ms
不足以让全部 5 个 job 走完。修法：改为 `for` 循环最多 20 轮 tick，每轮 `sleep(20)`
让 fire-and-forget 的 `runOne` 让出控制权；并把断言从"单次 tick 观察"改为
"整条时间线的 maxObservedRunning"。一次修完。

## 验证表（Deliverable vs Spec）

| Spec 条目 | 交付 |
|---|---|
| P1 大 PDF HTTP 响应 p95 ≤ 200ms | **待生产数据验收**（理论路径已通；异步化不改变 HTTP 应答耗时的关键结构）|
| P2 SIGTERM 重启 in_progress 恢复 ≤ 5s | **待生产数据验收**（`resetInProgressJobs` 已在 `index.ts` 启动 hook 里）|
| P3 `?sync=true` shape 向后兼容 | ingestRoutesAsync.test 覆盖 ✓ |
| P4 `eval-recall` recall@5 不回归 | **待运行**；异步化不碰召回链路，理论无影响 |
| P5 前端 `/ingest` 重启后列表仍可见 | DB 读回落已到位，待手动验 |
| P6 `docker logs qa_service` 无异常 ERR | 待手动验 |

## 刻意裁剪进 Phase E 的 Follow-up

1. **前端 PreprocessingModule / UploadTab 升级 SSE**：`streamJob` helper 已就位，现有轮询可用；SSE 是感知优化
2. **`/fetch-url` 与 `/conversation` 异步化**：流量低 + 单次耗时短，仍 fire-and-forget；重启会丢 in-flight
3. **ADR-30 DELETE 端点联动 `UPDATE ingest_job SET status='cancelled'`**：worker 侧探测就位，DELETE 写入是另一半
4. **`infra/docker-compose.yml` env 同步**：`process.env.*` fallback 工作正常但不可审计
5. **"小文件自动同步" 阈值是否启用**（D-004 裁剪的决定）
6. **SIGTERM grace 真实值测试**（需 `vi.useFakeTimers()` 重写）
7. **SSE 非 owner 403 测试**（当前 admin principal 绕行）
8. **SSE 升级为 `LISTEN/NOTIFY`**（并发订阅上量再说）

## 当日收尾后的仓库状态

- 40 条 ADR（35→38 是今日上午 ontology 三件套 + 38 governance-actions-wire；39 是 WeKnora 借鉴；40 是本条）
- 21 个 openspec change（`openspec/changes/` 新增 `ingest-async-pipeline/`，作为活契约）
- `docs/superpowers/archive/` 新增一个归档目录
- `.superpowers-memory/open-questions.md` 关闭 OQ-INGEST-1，挪到"已关闭"区；当前未决仍有 OQ-ONT-1..5 / OQ-EVAL-1 / OQ-AGENT-1 / OQ-SQLSEC-1

## 下一次 session 的候选

按 ADR-39 D-001 借鉴点与当前未决 OQ 排：

1. **OQ-AGENT-1 ReACT 升级** — 前置条件修订后需要"真实流量 3 个月"或"eval set 扩多跳题"，都不是下周能做的
2. **Phase E 中的任一 Follow-up**（如 PreprocessingModule SSE 升级）— 小工作量、立即可感知
3. **OQ-SQLSEC-1 NL2SQL SQL AST 校验** — 要等 `structured_query` change 启动
4. **观察生产数据**：大 PDF p95 / worker 并发使用率 / SSE 订阅数量级 → 反哺 Phase E 的优先级
