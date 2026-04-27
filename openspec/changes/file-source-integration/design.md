# Design: file-source-integration · Lock 阶段

> 本文是对 `docs/superpowers/specs/file-source-integration/design.md`（Explore 稿）的**冻结版**。Explore 阶段所有未拍板点在此锁死；下面任何一条和代码行为冲突 = spec-vs-code drift，Execute 阶段先修契约再修代码。

## 1. 架构层次

```
/ingest UI "文件服务器" 折叠区
    ↓ HTTP
routes/fileSource.ts
    ↓ 调用
services/fileSource/
    ├─ index.ts              # 对外：runScan(sourceId), testConnection(sourceId)
    ├─ types.ts              # FileSourceAdapter / ListCursor / FileSourceDescriptor
    ├─ factory.ts            # makeAdapter(type) → adapter 实例
    ├─ crypto.ts             # encryptConfig / decryptConfig (AES-256-GCM)
    ├─ scheduler.ts          # bootScheduler(), enqueueManualScan()
    ├─ lock.ts               # 内存锁 "source:${id}"
    └─ adapters/
        ├─ smbAdapter.ts     # ← 本轮唯一实现
        ├─ s3Adapter.ts      # 本轮不存在；S3 change 再加
        ├─ webdavAdapter.ts  # 本轮不存在
        └─ sftpAdapter.ts    # 本轮不存在
        ↓ 调用
services/ingestPipeline/index.ts::ingestDocument
    ↓
metadata_asset / metadata_field / pgvector
```

## 2. 关键冻结点

### 2.1 FileSourceAdapter 接口（不可变契约）

```ts
export type FileSourceType = 'smb' | 's3' | 'webdav' | 'sftp'

export interface FileSourceDescriptor {
  id: string         // adapter-specific 稳定 id。同一文件在两次 listFiles 里 id 必须一致
  name: string       // 文件名（basename）
  path: string       // 相对 source root 的路径（用 '/' 作分隔，UTF-8）
  size: number       // bytes
  mtime: Date        // 最后修改时间（adapter 负责换算到 UTC）
  mime?: string      // 可选；缺失时由 ingestPipeline 按扩展名推断
}

export interface ListCursor {
  lastScanAt: string | null   // ISO 8601 UTC；首次 null = 全扫
  seenIds: string[]           // 上次 scan 见过的 descriptor.id 全集
}

export interface ListResult {
  added:   FileSourceDescriptor[]
  updated: FileSourceDescriptor[]
  removed: string[]           // 只放 id
  nextCursor: ListCursor
}

export interface FetchedFile {
  buffer: Buffer              // 整个文件内容；adapter 自行处理分块下载
  descriptor: FileSourceDescriptor
}

export interface FileSourceAdapter {
  readonly type: FileSourceType
  init(config: unknown): Promise<void>
  listFiles(cursor: ListCursor): Promise<ListResult>
  fetchFile(id: string): Promise<FetchedFile>
  close(): Promise<void>
}
```

**不可变规则**：
- `listFiles` 幂等（同 cursor 输入 → 同输出）；副作用只限"打开连接"
- 同一文件在两次 scan 里的 `id` **必须稳定**（SMB 用 `\\host\share\path` 绝对路径；S3 用 key；WebDAV 用 href；SFTP 用绝对路径）
- `fetchFile(id)` 若文件已不存在 → throw `FileSourceNotFoundError`（不返回 null）
- `fetchFile` 不应 mutate cursor；cursor 只由调度器在 scan 成功后持久化

### 2.2 DB Schema

```sql
CREATE TABLE IF NOT EXISTS metadata_file_source (
  id                    SERIAL PRIMARY KEY,
  type                  TEXT NOT NULL CHECK (type IN ('smb','s3','webdav','sftp')),
  name                  TEXT NOT NULL,
  config_json           JSONB NOT NULL,
  cron                  TEXT NOT NULL DEFAULT '@manual',
  last_cursor           JSONB,
  last_scan_status      TEXT CHECK (last_scan_status IN ('ok','partial','error') OR last_scan_status IS NULL),
  last_scan_error       TEXT,
  last_scan_at          TIMESTAMPTZ,
  permission_source_id  INTEGER,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS metadata_file_source_enabled_cron
  ON metadata_file_source (enabled, cron);

-- file_source_scan_log 仅留最近 100 条 / source；Execute 阶段实现
CREATE TABLE IF NOT EXISTS file_source_scan_log (
  id            SERIAL PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES metadata_file_source(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running','ok','partial','error')),
  added_count   INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  failed_items  JSONB,      -- [{id, error}]
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS file_source_scan_log_source_started
  ON file_source_scan_log (source_id, started_at DESC);
```

**metadata_asset 列追加**（不新建表）：
```sql
ALTER TABLE metadata_asset
  ADD COLUMN IF NOT EXISTS external_id    TEXT,
  ADD COLUMN IF NOT EXISTS external_path  TEXT,
  ADD COLUMN IF NOT EXISTS source_mtime   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offline        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS file_source_id INTEGER REFERENCES metadata_file_source(id);

CREATE INDEX IF NOT EXISTS metadata_asset_file_source_ext
  ON metadata_asset (file_source_id, external_id)
  WHERE file_source_id IS NOT NULL;
```

`(file_source_id, external_id)` 在 file-source 来源的 asset 上相当于唯一键；同一外部文件 mtime 变 → 不新建 asset，重跑抽取，覆盖 chunks。

### 2.3 加密约束

- **算法**：AES-256-GCM
- **Key**：`process.env.MASTER_ENCRYPT_KEY` —— 64 hex chars（= 32 bytes）
- **密文格式**：`"<base64 iv>:<base64 ct>:<base64 tag>"`（冒号分隔 3 段）
- **不 fail-fast**：env 缺失时服务仍启动，但任何涉及 `decryptConfig` 的 scan/test 会抛 `MasterEncryptKeyMissing`，API 返回 503 + 明确提示
- **字段范围**：只加密 `config_json` 里名为 `password` / `password_enc` / `secret` / `access_key_secret` 的字段；其它字段明文存

### 2.4 Scan 主循环语义

伪代码参见 Explore design §6。Lock 阶段追加两条硬约束：

**约束 A · cursor 不推进的 7 个时机**
- adapter.init 失败
- adapter.listFiles 抛异常
- MasterEncryptKeyMissing
- `signal.aborted`（调用方取消）
- scan 进行中 qa-service 被 SIGTERM（scan 标 error，下次从头）
- `permission_source_id IS NULL`（source 没挂 permission，拒绝 scan）
- cron 表达式非法（调度时不入排期）

**约束 B · scan 结束时 status 判定**
- 0 failed_item && removed 全部 mark 成功 → `ok`
- 有 failed_item 但 ≥1 个成功 ingest → `partial`
- 全部失败 / 连接就挂了 → `error`

### 2.5 权限模型

- 所有 `/api/file-sources/*` 路径要求 `permission:iam:manage`（复用 IAM ADMIN 门）—— **不是** source-level ACL，因为管理接入点本身是管理员操作
- scan 入库时 `principal = SYSTEM_PRINCIPAL`（user_id=0, email='system', roles=['system']），同 scan-folder
- ingest 的 `sourceId` = `metadata_file_source.permission_source_id` —— 命中 permissions V2 `source_id` 粒度的 ACL，终端用户读 chunk 时按这条判

### 2.6 调度 & 锁

- `node-cron` 进程内；单 qa-service 实例假设（多副本部署见 Scope Out）
- 内存锁 Map `<sourceId, Promise>`；同 source 重入时返回现有 Promise（不阻塞调用方）
- `bootScheduler()` 在 `services/index.ts` 启动末尾调用（ingest pipeline init 之后）
- **可中断**：qa-service SIGTERM 时 `AbortController.abort()` 广播给所有在跑的 scan

### 2.7 ingest 适配

复用 `ingestDocument({ buffer, name, sourceId, principal, opts })`；本 change 在 opts 加三个可选字段：

```ts
interface IngestDocumentOpts {
  // ... 现有字段不动 ...
  externalId?: string
  externalPath?: string
  mtime?: Date
  fileSourceId?: number
}
```

`ingestPipeline` 内部在 `metadata_asset` INSERT / UPSERT 时带上这 4 个字段。UPSERT 的冲突键：`(file_source_id, external_id) WHERE file_source_id IS NOT NULL`。

## 3. 向后兼容

- 老的 `/api/ingest/scan-folder` 不动，不迁移到 file-source 框架（用户如果在本地开发用它，保持行为）
- 老的 `metadata_asset` 行（手动上传 / BookStack sync）file_source_id 为 NULL，不受新 offline / external_id 逻辑影响
- retrieval 侧加一条 `WHERE offline=false OR offline IS NULL`；老行 offline IS NULL → 不被过滤

## 4. 可观测性

- 结构化日志 `event: 'file_source_scan_done'`，字段：`source_id / type / started_at / finished_at / status / added / updated / removed / failed / duration_ms`
- `file_source_scan_log` 表见 §2.2；保留最近 100 条 / source（trigger 或定时脚本，本轮走脚本）
- failed_items 是 `[{id, error: string}]`，不入 chunk 不入 asset，只记在 scan log 里

## 5. 风险登记

| 风险 | 缓解 |
|---|---|
| SMB 大目录首次扫几十分钟阻塞 | listFiles 内部支持分页，Execute 每 1000 文件 emit 进度 SSE（可选）；默认接受首次慢 |
| NAS 中文文件名 code page 异常 | 强制 UTF-8；adapter 内部 `Buffer → utf8` 转换；失败的文件名记 sanitized 版本 |
| qa-service 重启丢失进行中 scan | scan 进程内记 log 表（status=running），启动时把 running → error 清理 |
| 凭据明文落日志 | `config_json` 序列化前打印必须经过 `redactSecrets()`；单测覆盖 |
| cursor 结构未来演进（加字段） | `ListCursor` 用 `Record<string, unknown>` 扩展位预留（实现可忽略未知字段） |
| 多 qa-service 副本同时调度同 source | 本轮硬约束单副本；多副本部署需要切 distributed lock（Redis / PG advisory lock），列 Scope Out |

## 6. 明示 OUT（再强调一次）

Execute 阶段**禁止**触及以下内容，触及就需要新开 change：

1. S3 / WebDAV / SFTP 任一 adapter 的实际实现代码
2. S3 通知 / SMB change-notify / webhook
3. 多 qa-service 副本的 distributed lock
4. 逐目录 ACL 的权限映射
5. vault 对接
6. 自动清 offline asset 的 chunk
7. `/api/ingest/scan-folder` 的行为变更或弃用
