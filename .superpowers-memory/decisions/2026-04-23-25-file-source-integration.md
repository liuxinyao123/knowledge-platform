# ADR 2026-04-23-25 · File Source Integration（SMB 起步 · adapter 抽象）

## Context

用户诉求：从外部文件服务器（SMB/CIFS 起步，后续扩 S3 / WebDAV / SFTP）定时拉文件入库，不想过度工程化。

Explore / Lock 产物：
- `docs/superpowers/specs/file-source-integration/design.md`（Explore）
- `openspec/changes/file-source-integration/{proposal,design,tasks}.md` + 3 份 spec（Lock）

工作流：A `openspec-superpowers-workflow`。

## Decision

### 抽象层
`FileSourceAdapter` 接口 = `init / listFiles(cursor) / fetchFile(id) / close`；`type` 枚举预留 4 协议；工厂 `makeAdapter(type)` 只实现 SMB，其它 3 种 `throw FileSourceTypeNotImplemented`。

### Cursor / 增量
`{ lastScanAt, seenIds }`。首次扫 lastScanAt=null 全量；增量按 mtime > lastScanAt 判 updated，set-diff seenIds 判 added / removed。scan 失败不推进 cursor（保守，下次从头）。

### 存储
- 新表 `metadata_file_source`（含加密的 config_json / cron / last_cursor / last_scan_* / permission_source_id / enabled）
- 新表 `file_source_scan_log`（per-scan status + 计数 + failed_items）
- `metadata_asset` 扩 4 列：`external_path` / `source_mtime` / `offline` / `file_source_id`（`external_id` 已存在）
- 部分唯一索引 `(file_source_id, external_id) WHERE file_source_id IS NOT NULL` 作为 UPSERT 冲突键

### 加密
AES-256-GCM，key 来自 env `MASTER_ENCRYPT_KEY`（64 hex chars）。密文格式 `"iv:ct:tag"` (base64)。secret 字段（`password` / `secret` / `access_key_secret`）加密后字段名追加 `_enc`。`redactConfig` 在 API 返回前把 `_enc` 值 mask 成 `"***"`。`MasterEncryptKeyMissing` 不在 boot 时 fail-fast——允许 enabled=false 的 source 存在；scan 时触发则标 error + API 返 503。

### 权限
- 管理接入点（`/api/file-sources/*` 全部）：`iam:manage`
- scan 入库：`SYSTEM_PRINCIPAL = { user_id:0, email:'system', roles:['system'], team_ids:[] }`
- 终端用户读 chunk：按 `permission_source_id` 命中 permissions V2 ACL

### Scan 主循环
`runScan(sourceId, signal?)` 由 `withSourceLock(id)` 包，同 source 重入复用 Promise。listFiles → 对 added+updated 逐个 fetchFile + ingestDocument（SYSTEM 身份、带 externalId/externalPath/mtime/fileSourceId）→ removed 走 `markAssetOffline`。单文件失败进 failed_items 不中断；全部成功 `status='ok'`，有失败但 ≥1 成功 `'partial'`，全失败 `'error'`。

### Ingest 接入
`IngestInput.opts` 加 4 可选字段：`externalId / externalPath / mtime / fileSourceId`。`pipeline.ts` 分叉：有 fileSourceId + externalId → `ON CONFLICT (file_source_id, external_id) WHERE ... DO UPDATE` UPSERT，冲突时先 DELETE 老 `metadata_field` + `metadata_asset_image` 再重跑抽取（覆盖 chunks / images）；否则走旧 INSERT 路径（不受影响）。

### 软删
`metadata_asset.offline=true`。`knowledgeSearch.ts` 检索 WHERE 加 `(ma.offline IS NULL OR ma.offline = false)` 过滤；老行 offline IS NULL → 不受影响。

### 调度
`node-cron` 进程内；`bootScheduler()` 启动时 load 所有 enabled + cron ≠ '@manual' 的 source 排期；`rescheduleOne(id, cron, enabled)` 在 PATCH 后被调；`unschedule(id)` 在 DELETE / 禁用时调；SIGTERM → `abortAllScans()`。node-cron 未装时调度关闭但手动扫仍可用。

### UI
`/ingest` 的「批量任务」Tab 下新增折叠区「文件服务器」（默认收起）。包含列表（状态徽标 + 行动按钮）+ 新建/编辑表单 + 日志抽屉。不新建顶层 Tab。

## Files changed / created

### 后端
```
apps/qa-service/package.json                                    +@marsaud/smb2, +node-cron
apps/qa-service/src/types/smb2.d.ts                             新 · 最小 types stub
apps/qa-service/src/types/node-cron.d.ts                        新 · 最小 types stub
apps/qa-service/src/services/fileSource/types.ts                新 · 接口 + errors + SYSTEM_PRINCIPAL
apps/qa-service/src/services/fileSource/crypto.ts               新 · AES-256-GCM + redact / merge
apps/qa-service/src/services/fileSource/lock.ts                 新 · 同源串行内存锁
apps/qa-service/src/services/fileSource/factory.ts              新 · adapter 工厂
apps/qa-service/src/services/fileSource/adapters/smbAdapter.ts  新 · SMB 实现
apps/qa-service/src/services/fileSource/index.ts                新 · runScan / testConnection
apps/qa-service/src/services/fileSource/scheduler.ts            新 · node-cron 调度
apps/qa-service/src/routes/fileSource.ts                        新 · 8 HTTP 端点
apps/qa-service/src/services/pgDb.ts                            +metadata_file_source / scan_log / asset 扩列
apps/qa-service/src/services/ingestPipeline/types.ts            +IngestInput.opts 4 字段
apps/qa-service/src/services/ingestPipeline/pipeline.ts         +UPSERT 分支
apps/qa-service/src/services/knowledgeSearch.ts                 +offline 过滤
apps/qa-service/src/index.ts                                    +挂路由 +bootScheduler +SIGTERM abort
```

### 前端
```
apps/web/vite.config.ts                                         +/api/file-sources 代理
apps/web/src/api/fileSource.ts                                  新 · API 封装
apps/web/src/knowledge/Ingest/FileSourceForm.tsx                新 · 新建/编辑 SMB 表单
apps/web/src/knowledge/Ingest/FileSourceList.tsx                新 · 列表 + 行动按钮 + toast
apps/web/src/knowledge/Ingest/FileSourceLogDrawer.tsx           新 · 日志抽屉
apps/web/src/knowledge/Ingest/BatchTab.tsx                      重构 · ZIP + 文件服务器折叠区
```

## 验证

### 编译
- `apps/qa-service` `npx tsc --noEmit` → **EXIT=0**，0 错误
- `apps/web` `npx tsc --noEmit -p tsconfig.app.json` → 仍 5 条 pre-existing（RunDetail × 3 + ChatPanel × 2 · `web-react19-typefix` followup），**本 change 新增 0 错**

### 运行期前置
用户本机需要：
1. `pnpm -w install`（拉新增依赖 `@marsaud/smb2` + `node-cron`）
2. 根 `.env` 或 `apps/qa-service/.env` 配 `MASTER_ENCRYPT_KEY=<64 hex>`（32 bytes）
   - 不配则启动能跑，但创建 source 时 API 返 503，scan 触发时写 log status=error
3. 重启 qa-service（见 `pnpm dev:down && pnpm dev:up`）

### 手测（用户本机）
走 `openspec/changes/file-source-integration/tasks.md` §H-5 六步：
1. /ingest → 批量任务 Tab → 展开「文件服务器」→ 新建
2. 填 SMB 字段 → 点「试连」→ 前 5 个样本
3. 保存 → 列表现行 → 点「立即扫」
4. ~20s 后看日志 status='ok' · added_count > 0
5. /search 搜新入库文件内容 → 看到 chunk（带 external_path 面包屑要 UI 下一轮优化）
6. 远端删一份 → 再扫 → removed_count=1 → asset 在 /assets 显示 offline pill（offline UI 标记留下一轮做，本轮只做后端软删语义）

## Follow-up

本轮 OUT 未实现的项，未来独立 change：

| 项 | change 建议 |
|---|---|
| S3 / MinIO / OSS adapter | `file-source-s3` · 工作流 B（上游 = 本 change 接口） |
| WebDAV adapter | `file-source-webdav` · 同上 |
| SFTP adapter | `file-source-sftp` · 同上 |
| 事件驱动（S3 notification / webhook） | `file-source-events` · 工作流 A（需求不清） |
| 逐目录 ACL 映射 | `file-source-acl-per-path` · 工作流 A |
| vault 凭据托管 | `secrets-vault` · 工作流 B |
| 离线 asset 自动清 chunk 策略 | `cleanup-offline-chunks-auto` · 工作流 C（或脚本） |
| k8s CronJob / 分布式锁（多副本部署） | `file-source-distributed-scheduler` · 工作流 A |
| Asset 详情页 offline pill + external_path 面包屑 | 工作流 C 小改 |
| /assets 列表 offline 过滤 checkbox | 工作流 C 小改 |
| 单测：adapter / crypto / lock / scheduler / route（tasks §B-TE / §C-TE / §D-TE / §E-TE） | 本 change 未写；下一轮补测试 change（不急） |

## 风险已知

- 生产多副本部署会让 scheduler 重复排期；本轮约定单实例。未来需 distributed lock
- SMB 大目录（> 10k 文件）首次扫可能几十分钟；目前无进度 SSE（UI 只有 "running" 徽标）
- `@marsaud/smb2` 对 SMB3 加密共享支持一般；若 NAS 强制加密，可能需要切 native `smbclient` 子进程方案
- 中文文件名在某些 SMB server 上仍可能 mojibake；`sanitizeName` 只做控制字符剥离

## 归档

- Explore 设计：`docs/superpowers/specs/file-source-integration/design.md`
- Lock 契约：`openspec/changes/file-source-integration/`（保留；未来 adapter 实现可复用这份 spec）
- Archive（本 change 收尾后）：把 Explore design 迁 `docs/superpowers/archive/file-source-integration/`——**推到用户做完 H-5 手验之后**，本 ADR 暂不迁。
