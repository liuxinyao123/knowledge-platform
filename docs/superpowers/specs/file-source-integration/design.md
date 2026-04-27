# File Source Integration · Explore 阶段设计

> Status: Explore（不进主分支，Lock 阶段才合并 OpenSpec 契约）
> Workflow: A `openspec-superpowers-workflow`
> 日期: 2026-04-23
> 上游: `integrations.md` §Ingest Pipeline 统一入口（`ingestDocument()`）
> 相关 ADR: `2026-04-21-08-ingest-pipeline-unify.md` / `2026-04-21-10-unified-auth-permissions.md` / `2026-04-22-16-permissions-v2.md`

---

## 1. Context

目前 knowledge-platform 的 ingest 入口两种：
- `POST /api/knowledge/ingest`：手动上传单文件
- `POST /api/ingest/scan-folder`：扫宿主机上的一个本地目录

抽取链（`services/ingestPipeline`）已经覆盖 PDF / DOCX / PPTX / XLSX / MD / HTML / TXT / CSV / 图片，L3 chunk gate + textHygiene 已生效。

缺的是"从外部文件服务器拉文件进来"这一层。用户首发诉求：**SMB/CIFS**（NAS / Windows 文件共享）；后续想扩到 S3 / WebDAV / SFTP。

**用户明确约束**：目前没具体规模需求，**不要过度工程化**。

## 2. Scope

### In Scope（本轮 Execute）

- **一个抽象**：`FileSourceAdapter` 接口，设计时把 (b) S3 / (c) WebDAV / (d) SFTP 后续实现考虑进去，但本轮只实现 (a) **SMB/CIFS**
- **一张配置表**：`metadata_file_source`，保存接入点的连接 + 凭据 + schedule
- **一个调度**：cron 表达式 + 手动触发二合一；不做事件驱动
- **一组 API**：create / list / get / scan-now / delete（软删）
- **一个 UI**：`/ingest` 的「批量任务」Tab 里加一个「文件服务器」子区（不新建顶层 Tab，避免过度）
- **权限**：整个 source 挂一个 `source_id`（即 BookStack shelf 的对应 ACL 主体），不做逐目录 ACL
- **增量**：按 mtime；首次扫默认是全量
- **删除语义**：源头删了 → 对应 asset 标记 `offline=true`，**chunk 不删**（retrieval 默认过滤 offline）；可手动清库

### Out of Scope（留给后续轮）

- (b) S3 / (c) WebDAV / (d) SFTP 的 adapter 实现（设计里留接口位，不写代码）
- 事件驱动（S3 notification / SMB change-notify / webhook）
- 逐目录 ACL 映射（当前只支持整个 source 一级授权）
- 文件服务器凭据的密钥轮换 / vault 对接（先落库加密字段，不做 KMS）
- 离线文件的自动清库策略（先保留 offline 文件 chunk，不触发清理；手动脚本或下一轮做）

## 3. 关键决策（pre-decided 从简）

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | adapter 接口粒度 | `listFiles(cursor)` + `fetchFile(id)` 两个方法，不加 `delete` | delete 在远端做没意义（我们只读），"源文件没了"通过 listFiles 不再返回感知 |
| 2 | 增量策略 | mtime only，持久化 cursor = `{last_scan_at, seen_file_ids}` | SMB 没 ETag；checksum 需要读全文件代价大；mtime 中等可靠，够用 |
| 3 | 调度 | cron 字符串 + 手动触发；同时支持 `cron="@manual"` 纯手动 | 不引入 webhook/事件，降低复杂度 |
| 4 | 配置 schema 最小集 | id / type / name / config_json（含 host/share/path/credential）/ cron / last_cursor / permission_source_id / created_at / updated_at | 9 字段够用 |
| 5 | 权限 | 整个 source 挂一个 `source_id`（复用 permissions V2 source 粒度） | 逐目录 ACL 先不做，等出现真需求再扩 |
| 6 | 删除语义 | 软删：`metadata_asset.offline=true`，retrieval 过滤 | 保留历史、可回滚；不污染 chunk |
| 7 | 凭据存储 | config_json 里密码字段用 symmetric encrypt (`MASTER_ENCRYPT_KEY` env) | 不引入 KMS / vault；落库不是明文 |
| 8 | 并发 | 单 source 串行，多 source 并行（各自独立 scan） | 避免 SMB 单连接并发限制；简单 |
| 9 | 失败重试 | 单文件失败不中断 source scan，计入 `failed_items` 列；下次 scan 重试 | 不做复杂 backoff |
| 10 | 文件大小上限 | 默认 200MB / 文件；超过跳过 + 记警告 | 防内存爆 |

## 4. Adapter 接口（草案，Lock 阶段冻结）

```ts
// apps/qa-service/src/services/fileSource/types.ts
export interface FileSourceDescriptor {
  id: string        // adapter-specific 稳定 id（SMB 用绝对路径；S3 用 key）
  name: string      // 文件名
  path: string      // 相对于 source root 的相对路径，用于 UI 面包屑
  size: number
  mtime: Date
  mime?: string     // 可选，由扩展名推断
}

export interface FetchedFile {
  buffer: Buffer
  descriptor: FileSourceDescriptor
}

export interface ListCursor {
  lastScanAt: string | null   // ISO；首次 null = 全扫
  seenIds: string[]           // 上次 scan 见过的 id，用于检测"源头删"
}

export interface ListResult {
  added:   FileSourceDescriptor[]   // 新增（上次没见过）
  updated: FileSourceDescriptor[]   // mtime 变了
  removed: string[]                 // 上次见过这次没见
  nextCursor: ListCursor
}

export interface FileSourceAdapter {
  readonly type: 'smb' | 's3' | 'webdav' | 'sftp'
  init(config: unknown): Promise<void>
  listFiles(cursor: ListCursor): Promise<ListResult>
  fetchFile(id: string): Promise<FetchedFile>
  close(): Promise<void>
}
```

接口故意小。adapter 内部怎么做分页、建连、pool 都是实现自由，对外只暴露这四件事。

## 5. Schema · `metadata_file_source`

```sql
CREATE TABLE metadata_file_source (
  id                    SERIAL PRIMARY KEY,
  type                  TEXT NOT NULL CHECK (type IN ('smb','s3','webdav','sftp')),
  name                  TEXT NOT NULL,
  config_json           JSONB NOT NULL,   -- 协议相关连接参数 + 加密后的凭据
  cron                  TEXT NOT NULL DEFAULT '@manual',
  last_cursor           JSONB,            -- { lastScanAt, seenIds }
  last_scan_status      TEXT,             -- 'ok' | 'partial' | 'error' | null
  last_scan_error       TEXT,
  last_scan_at          TIMESTAMPTZ,
  permission_source_id  INTEGER,          -- 对应 permissions V2 source_id
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX metadata_file_source_enabled_cron ON metadata_file_source (enabled, cron);
```

SMB 的 `config_json` 形状（示例）：
```json
{
  "host": "nas.corp.local",
  "share": "docs",
  "path": "/engineering/specs",
  "domain": "CORP",
  "username": "svc-rag",
  "password_enc": "<aes-256-gcm:iv:ct:tag>",
  "timeout_ms": 30000,
  "max_file_mb": 200
}
```

## 6. Scan 主循环（伪代码）

```ts
async function runScan(sourceId: number) {
  const row = await loadFileSourceRow(sourceId)           // metadata_file_source
  if (!row.enabled) return
  const adapter = makeAdapter(row.type)                   // 工厂
  await adapter.init(decryptConfig(row.config_json))

  const cursor: ListCursor = row.last_cursor ?? { lastScanAt: null, seenIds: [] }
  const { added, updated, removed, nextCursor } = await adapter.listFiles(cursor)

  for (const d of [...added, ...updated]) {
    try {
      const { buffer } = await adapter.fetchFile(d.id)
      await ingestDocument({
        buffer,
        name: d.name,
        sourceId: row.permission_source_id,
        principal: SYSTEM_PRINCIPAL,   // scan 以系统身份入库
        opts: { externalId: d.id, externalPath: d.path, mtime: d.mtime },
      })
    } catch (err) {
      recordItemFailure(sourceId, d.id, err)
      continue   // 单文件失败不中断
    }
  }

  for (const gone of removed) {
    await markAssetOffline(sourceId, gone)
  }

  await adapter.close()
  await saveCursor(sourceId, nextCursor, 'ok')
}
```

`ingestDocument()` 已有；我们只加 `opts.externalId / externalPath / mtime` 三个字段，`metadata_asset` 存下来即可，方便以后做反查和增量判定。

## 7. SMB 实现要点

- **Node 包**：`@marsaud/smb2`（纯 JS，没 native binding），兼容 SMB2/SMB3
- **凭据**：NTLMv2 对 Windows Server 足够；Kerberos 支持暂不做（SMB3 也能 NTLM）
- **路径**：以 `\\host\share\path\sub\file.pdf` 为稳定 id；斜杠反斜杠两种都归一到正斜杠存库
- **递归**：`adapter.listFiles()` 内部做深度优先遍历；初版不设深度上限，靠 `max_file_mb` 兜底
- **重连**：单次 scan 失败（SMB 断连）→ scan 整体失败但计数部分进度，下次 scan 继续
- **常见坑**：SMB1 已不支持（不向下兼容），老 NAS 需要至少开 SMB2；路径里带中文会有 code page 问题，需要强制 UTF-8

## 8. 调度器

- **起法**：qa-service 启动时 load 所有 enabled + cron ≠ '@manual' 的 source，用 `node-cron` 排进 scheduler
- **并发**：单 source 串行（一把 `source:${id}` 的内存锁）；多 source 并行，按 Node event loop 分
- **手动触发**：`POST /api/file-sources/:id/scan` 同步起一次（返回 scan log id），不等 scan 完成
- **可观测**：每次 scan 完成 emit 结构化日志 `event: 'file_source_scan_done'` + 写 `file_source_scan_log` 表（可选，Lock 阶段决定）

## 9. API 草案

| Method | Path | 作用 | 权限 |
|---|---|---|---|
| POST | `/api/file-sources` | 创建接入点 | ADMIN |
| GET | `/api/file-sources` | 列表 | ADMIN |
| GET | `/api/file-sources/:id` | 详情（不吐密码） | ADMIN |
| PATCH | `/api/file-sources/:id` | 改配置 / cron / enabled | ADMIN |
| DELETE | `/api/file-sources/:id` | 删接入点（不清数据） | ADMIN |
| POST | `/api/file-sources/:id/scan` | 立即扫一次 | ADMIN |
| GET | `/api/file-sources/:id/logs` | 最近 scan 日志 | ADMIN |
| POST | `/api/file-sources/:id/test` | 试连（不入库） | ADMIN |

## 10. UI 入口

不新建顶层 Tab。在 `/ingest` 的批量任务 Tab 下加一个折叠区：

```
[批量任务]
  ├─ ZIP 包导入（已有）
  └─ 文件服务器 ▼
        ├─ [+ 新建接入点]
        ├─ [SMB: nas.corp.local/docs/engineering] 每 6 小时 · 上次扫 1 小时前 · [立即扫][配置][禁用]
        └─ ...
```

Lock 阶段产 mock；Execute 阶段出实现。

## 11. 未来扩展路径（不本轮实现，仅验证接口够用）

| 后续协议 | 实现要点 | 可能踩的坑 |
|---|---|---|
| S3 / OSS / MinIO | `@aws-sdk/client-s3`，用 ListObjectsV2 + LastModified / ETag；`fetchFile` = GetObject | 大 bucket 分页 / region 配置 / 对 ETag 的 multipart-aware 理解 |
| WebDAV（Nextcloud / SharePoint） | `webdav` npm 包；PROPFIND 列 + GET 取 | 认证方式多样（Basic / Bearer / OAuth）；SharePoint 的 WebDAV endpoint 坑不少 |
| SFTP | `ssh2-sftp-client`；递归读目录，stat 拿 mtime | key-based auth / known_hosts 管理 |

关键验证：上面三种协议的 `listFiles` 都能产出 `added / updated / removed`；`fetchFile` 都能产出 Buffer。接口不需要改，只是写新的 class 实现 `FileSourceAdapter`。

## 12. 风险 & 降级

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| SMB 大目录（万级文件）首次扫慢 | 中 | 阻塞首次 scan 几十分钟 | Execute 阶段加进度 emit；UI 提示"首次扫可能较久" |
| NAS 路径含中文 code page 异常 | 中 | 部分文件名乱码 | UTF-8 强制 + `sanitizeFilename` 兜底 |
| 文件被 extractor 卡住（罕见大 PPTX） | 低 | 一个文件拖慢整个 scan | extractor 超时控制（已有）+ 单文件失败隔离 |
| 凭据泄露 | 低高影响 | 生产风险 | 对称加密入库 + 不在日志打印；下一轮接 vault |
| SMB 断连导致 cursor 不一致 | 中 | 可能漏扫或重复扫 | cursor 保守：scan 失败时不更新 cursor，下次从头再来 |

## 13. 验证门槛（Execute 阶段）

1. **单元测试**：SMB adapter 用 `samba` docker 容器起一个 mock server，跑 list + fetch 路径
2. **集成测试**：起一个 source，配置 cron `*/5 * * * *`，放 5 份 PDF 进 NAS 目录，5 分钟内能看到 chunks 进 pgvector
3. **权限测试**：reader 看不到这个 source 的 `/api/file-sources` 列表（403）
4. **浏览器测试**：`/ingest` 的文件服务器子区能建 / 删 / 立即扫 / 看日志

## 14. 工作流 A 阶段规划

| 阶段 | 产物 | 是否进主分支 |
|---|---|---|
| **Explore**（当前） | 本文档 `design.md` | ❌（draft PR 或不提 PR） |
| **Lock** | `openspec/changes/file-source-integration/{proposal.md, design.md, tasks.md, specs/file-source-adapter-spec.md, specs/file-source-api-spec.md}` | ✅（合并即接口生效） |
| **Execute** | `apps/qa-service/src/services/fileSource/*`、adapter 实现、API、调度器；`apps/web/src/knowledge/Ingest/BatchTab.tsx` UI | ✅ 分 PR |
| **Archive** | 本文件迁 `docs/superpowers/archive/file-source-integration/`；ADR `2026-04-XX-NN-file-source-integration.md` 写入决策 | ✅ |

## 15. Lock 阶段待拍板清单（给你）

全在本文档 §3 预设值了，下面是如果你想改的几个"值得重新审视"的点：

1. 要不要把 cron 调度交给 OS 的 systemd-timer / k8s CronJob，而不是 qa-service 进程内？（优点：进程重启不影响；缺点：多套部署方式）
2. 凭据存储是否一步到位接 vault（如 HashiCorp Vault / AWS Secrets Manager）？（增加运维复杂度）
3. 要不要支持 "read-through cache"（scan 不入库，查询时实时拉）？（不建议，拖慢查询，偏离 ingest 模型）
4. 软删的 offline 文件要不要 90 天后自动清 chunk？（可留脚本，不做自动）

这些如果都走本文档默认值，直接进 Lock 就行。

## 16. 我的建议节奏

1. **你现在看一下本 design.md** —— 有问题 / 想改默认就提；没问题我们下一步直接进 Lock
2. **Lock 阶段**我产出 OpenSpec 契约（`openspec/changes/file-source-integration/`）并锁定 `FileSourceAdapter` 接口
3. **Execute 阶段**分两个小 PR：PR1 = adapter + schema + API + 调度（后端闭环）；PR2 = UI + 浏览器回归
4. 验证门槛通过 → Archive + 写 ADR → 下游开始用

---

> 本设计遵守用户 2026-04-23 约束："没有需求，不需要太复杂"。上面所有 §3 决策都选了"从简"分支；留接口扩展位但不写未使用的代码。
