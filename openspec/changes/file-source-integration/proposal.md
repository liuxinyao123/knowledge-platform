# Proposal: file-source-integration（SMB 起步 · adapter 抽象 · 后续支 S3 / WebDAV / SFTP）

## 背景

当前 ingest 的入口只有两条：`POST /api/knowledge/ingest`（手动上传单文件）和 `POST /api/ingest/scan-folder`（扫宿主机上的一个本地目录）。抽取链（`services/ingestPipeline`）已覆盖 PDF / DOCX / PPTX / XLSX / MD / HTML / TXT / CSV / 图片，L3 chunk gate + textHygiene 生效。缺的是"把文件从外部文件服务器拉进来"这一层。

用户首发诉求：SMB/CIFS（NAS / Windows 文件共享）；后续想扩 S3 / WebDAV / SFTP。明确约束：**目前没具体规模需求，不要过度工程化**。

Explore 阶段产物：`docs/superpowers/specs/file-source-integration/design.md`（10 条"从简"决策都已预设）。

## 范围

### IN（本轮 Execute）

**A. 抽象层**
- `FileSourceAdapter` 接口（`type` / `init()` / `listFiles(cursor)` / `fetchFile(id)` / `close()`）
- adapter 工厂 `makeAdapter(type)`，预留 4 种协议枚举（`smb` / `s3` / `webdav` / `sftp`），本轮只实现 `smb`
- cursor 语义：`{ lastScanAt, seenIds }` —— added / updated / removed 三分类

**B. 存储**
- 新表 `metadata_file_source`（id / type / name / config_json / cron / last_cursor / last_scan_status / last_scan_error / last_scan_at / permission_source_id / enabled / timestamps）
- 凭据字段（如 password）用 AES-256-GCM 对称加密，key 来自 env `MASTER_ENCRYPT_KEY`；启动时 key 缺失不 fail-fast（允许 enabled=false 的 source 存在），但 scan 时解密失败 → scan 标 error

**C. HTTP API（ADMIN only）**
- `POST /api/file-sources` 创建
- `GET /api/file-sources` 列表
- `GET /api/file-sources/:id` 详情（返回体不含密码字段）
- `PATCH /api/file-sources/:id` 改配置
- `DELETE /api/file-sources/:id` 删接入点（不动已入库 assets）
- `POST /api/file-sources/:id/scan` 立即扫一次（异步，立即返回）
- `GET /api/file-sources/:id/logs` 最近扫描日志
- `POST /api/file-sources/:id/test` 试连（不入库，不改 cursor）

**D. 调度**
- qa-service 进程内 `node-cron`，启动时 load 所有 `enabled=true && cron != '@manual'` 的 source 排期
- 单 source 串行（内存锁 `source:${id}`），多 source 并行
- scan 失败时保守：不更新 cursor，下次从头来

**E. SMB adapter 实现**
- Node 包 `@marsaud/smb2`，协议 SMB2/SMB3，NTLMv2 认证
- 递归列文件，mtime 增量
- `config_json` = `{ host, share, path, domain?, username, password_enc, timeout_ms?, max_file_mb? }`
- 默认 `max_file_mb=200`，超过跳过 + 单文件失败日志

**F. ingest 接入**
- scan 主循环内对每个 added/updated 调 `ingestDocument({ buffer, name, sourceId: row.permission_source_id, principal: SYSTEM_PRINCIPAL, opts: { externalId, externalPath, mtime } })`
- `metadata_asset` 存 `external_id` / `external_path` / `source_mtime` 三个新字段，便于反查和去重
- removed 的 asset 标 `offline=true`（chunk 不删，retrieval 默认过滤 offline）

**G. UI**
- `/ingest` 的「批量任务」Tab 下加一个折叠区「文件服务器」，含新建 / 列表 / 立即扫 / 配置 / 禁用 / 删除
- 凭据字段 UI 输入后一次性发到后端加密，不回读；编辑时显示 `******`

### OUT（本轮明确不做，推后续）

- (b) S3 / (c) WebDAV / (d) SFTP 的 adapter 实现（设计保留位，不写代码）
- 事件驱动（S3 notification / SMB change-notify / webhook）
- 逐目录 ACL 映射（当前只支持整个 source 挂一个 `permission_source_id`）
- 凭据 vault 对接（HashiCorp Vault / AWS Secrets Manager）
- 离线文件的**自动**清库策略（保留手动脚本；本轮不做定时清）
- k8s CronJob / systemd-timer 级调度（本轮用进程内 cron；多副本部署再谈迁移）
- 文件级 full-text 反查（external_path → asset_id 的反查 API）

## 决策记录（快速索引 Explore design.md §3）

| # | 决策 | 选 | 理由 |
|---|---|---|---|
| 1 | adapter 接口粒度 | listFiles + fetchFile 两方法 | 只读场景，不给 adapter 写权力 |
| 2 | 增量策略 | mtime only | SMB 无 ETag；checksum 成本太高 |
| 3 | 调度 | 进程内 cron + 手动二合一 | 不引 webhook，降低复杂度 |
| 4 | 权限粒度 | 整个 source 挂一个 source_id | 逐目录 ACL 等真需求再扩 |
| 5 | 删除语义 | 软删（offline=true，chunk 保留） | 可回滚、不污染 retrieval |
| 6 | 凭据存储 | 对称加密入库（MASTER_ENCRYPT_KEY） | 不接 vault，但不是明文 |
| 7 | 并发 | 单 source 串行 / 多 source 并行 | SMB 单连接限制 |
| 8 | 失败策略 | 单文件失败不中断；scan 失败不更新 cursor | 保守、可重试 |
| 9 | 文件大小上限 | 默认 200MB | 防内存爆 |
| 10 | UI 入口 | 批量任务 Tab 下折叠区，不新 Tab | 避免顶层 Tab 膨胀 |

## Dependencies

- 上游：`services/ingestPipeline/index.ts::ingestDocument`（已稳定，ADR 2026-04-21-08）
- 上游：`permissions V2` 的 source_id / enforceAcl（ADR 2026-04-22-16 / 2026-04-23-17）
- 上游：`metadata_asset` 表（本 change 会加列：external_id / external_path / source_mtime / offline）
- 下游：未来的 S3/WebDAV/SFTP adapter，消费本 change 冻结的 `FileSourceAdapter` 接口

## Non-Goals

- 不是 BookStack 的替代；本 change 只是把文件拉进 `metadata_asset` + pgvector，BookStack 只在用户显式走 ZipImporter 时才进
- 不做 RAGFlow / LlamaIndex 等第三方 ingest 库的集成
- 不做文件内容的 diff/版本控制（mtime 变则重跑全抽取，不做块级 diff）
