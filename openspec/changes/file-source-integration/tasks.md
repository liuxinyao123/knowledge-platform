# Tasks: file-source-integration

> 顺序：A schema → B adapter 抽象 → C SMB adapter → D scheduler → E HTTP API → F ingest 接入 → G UI → H 验证闸门。
> 工作流 A；Execute 阶段可拆两个 PR：PR1 = A+B+C+D+E+F（后端闭环）；PR2 = G+H（UI + 回归）。

## A · 数据层

- [ ] A-DB-1: `services/pgDb.ts` —— `CREATE TABLE IF NOT EXISTS metadata_file_source` + 索引 + check constraint（见 design §2.2）
- [ ] A-DB-2: `services/pgDb.ts` —— `CREATE TABLE IF NOT EXISTS file_source_scan_log` + 索引
- [ ] A-DB-3: `services/pgDb.ts` —— `ALTER TABLE metadata_asset` 加 5 列 + 复合索引 `(file_source_id, external_id)`
- [ ] A-DB-4: 迁移幂等性测试（两次启动都不抛；已存在列不重复加）

## B · adapter 抽象

- [ ] B-CORE-1: `services/fileSource/types.ts` —— 全部类型（`FileSourceType` / `FileSourceDescriptor` / `ListCursor` / `ListResult` / `FetchedFile` / `FileSourceAdapter` + 所有自定义 Error 类）
- [ ] B-CORE-2: `services/fileSource/factory.ts` —— `makeAdapter(type)` 工厂；type != 'smb' 抛 `FileSourceTypeNotImplemented`
- [ ] B-CORE-3: `services/fileSource/crypto.ts` —— AES-256-GCM 加解密；key 缺失抛 `MasterEncryptKeyMissing`；密文格式 `iv:ct:tag` (base64)
- [ ] B-CORE-4: `services/fileSource/lock.ts` —— 内存锁 Map；`withSourceLock(id, fn)` 同 source 重入复用 Promise
- [ ] B-CORE-5: `services/fileSource/index.ts` —— 对外 `runScan(sourceId, signal?)` + `testConnection(sourceId)` + `SYSTEM_PRINCIPAL` 常量
- [ ] B-TE-1: `fileSource/types.test.ts` —— Error 类型 instanceof 检查
- [ ] B-TE-2: `fileSource/crypto.test.ts` —— 加密/解密 roundtrip · key 缺失 · 密文格式校验
- [ ] B-TE-3: `fileSource/lock.test.ts` —— 同 id 并发调用返回同 Promise · 不同 id 独立

## C · SMB adapter

- [ ] C-PKG-1: `apps/qa-service/package.json` —— 加依赖 `@marsaud/smb2`
- [ ] C-ADPT-1: `services/fileSource/adapters/smbAdapter.ts` —— 实现全部 `FileSourceAdapter` 方法
- [ ] C-ADPT-2: SMB 稳定 id 规范：`\\${host}\${share}${path}` 反斜杠归一
- [ ] C-ADPT-3: mtime UTC 归一（远端本地时区 → UTC）
- [ ] C-ADPT-4: 非 UTF-8 文件名兜底 + WARN
- [ ] C-ADPT-5: 超 max_file_mb 不拉实际内容（stat 阶段兜住）
- [ ] C-ADPT-6: listFiles 递归 + 跳过 dotfile / `$RECYCLE.BIN` / `Thumbs.db` / `.snapshot` / `.AppleDouble` / `*.lnk`
- [ ] C-ADPT-7: 访问拒绝的子目录跳过 + WARN，不中断
- [ ] C-ADPT-8: close 幂等 + 被动断连 emit `disconnected`
- [ ] C-TE-1: `smbAdapter.test.ts` —— 用 samba docker 镜像起 mock SMB server，覆盖 smb-spec 所有 Scenario（init / listFiles 首次 + 增量 + added/updated/removed / fetchFile 正常 + 超大 + 超时 / close 幂等 / 特殊文件名）

## D · 调度

- [ ] D-SCH-1: `services/fileSource/scheduler.ts` —— `bootScheduler()` 启动时 load + 排期；`enqueueManualScan(id)` 立即触发
- [ ] D-SCH-2: `node-cron` 依赖；cron 非法 → log WARN 跳过该 source（不崩）
- [ ] D-SCH-3: `PATCH /api/file-sources/:id` 改 cron/enabled 后主动通知 scheduler `rescheduleOne(id)`
- [ ] D-SCH-4: `DELETE /api/file-sources/:id` 后 `unschedule(id)`
- [ ] D-SCH-5: SIGTERM 时 `abortAllScans()` + 等待 grace period 2s
- [ ] D-SCH-6: `index.ts` main 文件末尾调 `bootScheduler()`
- [ ] D-TE-1: `scheduler.test.ts` —— cron 排期 · 动态 reschedule · 非法 cron · abort

## E · HTTP API

- [ ] E-RT-1: `routes/fileSource.ts` —— 8 个端点（create / list / get / patch / delete / scan / logs / test）
- [ ] E-RT-2: 全部路径挂 `enforceAcl({ requiredPermission: 'iam:manage' })` 中间件
- [ ] E-RT-3: 请求体验证（zod 或手写），非法返 `400 { error:{code, message} }`
- [ ] E-RT-4: 返回时统一 redact：任何含 `password` / `secret` / `access_key_secret` 的键名被 mask 为 `"***"` 且 key 改名为 `<name>_enc`
- [ ] E-RT-5: `index.ts` 挂载路由到 `/api/file-sources`
- [ ] E-RT-6: vite.config.ts 加 `/api/file-sources` 代理
- [ ] E-TE-1: `fileSource.route.test.ts` —— 覆盖 file-source-api-spec 全部 Scenario（每端点至少 1 条成功 + 1 条失败）

## F · ingest 接入

- [ ] F-ING-1: `services/ingestPipeline/index.ts::ingestDocument` —— 在 `opts` 接口加 `externalId?` / `externalPath?` / `mtime?` / `fileSourceId?` 四字段（非破坏性）
- [ ] F-ING-2: `metadata_asset` UPSERT 语义实现：冲突键 `(file_source_id, external_id) WHERE file_source_id IS NOT NULL`；mtime 变 → 重跑抽取
- [ ] F-ING-3: retrieval 路径（`retrieveInitial`）加过滤 `offline = false OR offline IS NULL`
- [ ] F-ING-4: `event: 'ingest_done'` 结构化日志带上 fileSourceId（如有）
- [ ] F-TE-1: `ingestDocument.test.ts` —— 回归：file_source_id=NULL 路径不变；有 file_source_id 时 UPSERT 走新冲突键
- [ ] F-TE-2: retrieval offline 过滤测试

## G · UI

- [ ] G-API-1: `apps/web/src/api/fileSource.ts` —— 8 个接口封装 + 类型
- [ ] G-UI-1: `apps/web/src/knowledge/Ingest/BatchTab.tsx` —— 加「文件服务器」折叠区（默认收起）
- [ ] G-UI-2: `apps/web/src/knowledge/Ingest/FileSourceList.tsx` —— 列表 + 状态徽标（enabled/running/error）+ 每行行动按钮（立即扫 / 配置 / 禁用 / 删除）
- [ ] G-UI-3: `apps/web/src/knowledge/Ingest/FileSourceForm.tsx` —— 新建/编辑表单 · SMB 字段 · cron 可视化（下拉常用表达式 + 自由输入）
- [ ] G-UI-4: `apps/web/src/knowledge/Ingest/FileSourceLogDrawer.tsx` —— 抽屉展示最近扫描日志 · failed_items 表格
- [ ] G-UI-5: 「试连」按钮 —— POST test 端点，结果弹 toast 不入列表
- [ ] G-UI-6: 所有破坏性按钮（禁用/删除/改凭据）走二次确认 modal
- [ ] G-TE-1: `FileSourceForm.test.tsx` —— 字段校验 · cron 非法态
- [ ] G-TE-2: `FileSourceList.test.tsx` —— 行渲染 · running 态 spinner · disabled 态样式

## H · 验证闸门

- [ ] H-1: `apps/qa-service` `tsc --noEmit` EXIT=0
- [ ] H-2: `apps/web` `tsc --noEmit` 本 change 新代码 0 错（web-react19-typefix 5 条 pre-existing 不计）
- [ ] H-3: `pnpm --filter qa-service test` 全绿 · 新增 B/C/D/E/F 测试全部覆盖
- [ ] H-4: 本机跑 migration 双轨：
  1. 新装 DB (`docker compose down -v && pnpm dev:up`) → 启动日志显示 4 个 CREATE TABLE + ALTER 成功，0 WARN
  2. 升级 DB（在已有 metadata_asset 的库上启动）→ ALTER ADD COLUMN IF NOT EXISTS 幂等
- [ ] H-5: 浏览器手验 6 步：
  1. `/ingest` 展开「文件服务器」→ 新建接入点（SMB host=本机 samba docker）
  2. 填完表单点「试连」→ 看到前 5 个样本
  3. 保存 → 列表出现新行 · 点「立即扫」
  4. 20s 内看到日志行 status='ok' · added_count > 0
  5. `/search` 里搜 scan 进来的文件内容 → 看到 chunk 带 external_path 面包屑
  6. 远端删除一个文件 → 再扫 → 日志 removed_count = 1 · 对应 asset 在 `/assets` 显示 offline pill
- [ ] H-6: 浏览器回归（复用 `docs/verification/browser-test-prompts.md` §0 + §12）确认本 change 未波及其它模块
- [ ] H-7: ADR 归档 `2026-04-NN-NN-file-source-integration.md` 写入决策 + followup
- [ ] H-8: `.superpowers-memory/MEMORY.md` + `integrations.md` 追加 "File Source Integration · SMB 首轮" 段
- [ ] H-9: 本 change 产物（Explore 设计 + OpenSpec + plan + ADR）最终状态梳理到 `docs/superpowers/archive/file-source-integration/`
