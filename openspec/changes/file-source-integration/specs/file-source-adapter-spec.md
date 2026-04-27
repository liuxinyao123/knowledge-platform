# Spec: file-source-adapter（接口 × 游标 × scan 语义）

## FileSourceAdapter.init

**Scenario: 合法 config 初始化成功**
- Given adapter.type = 'smb' · config 含 host/share/username/password
- When init(config)
- Then resolve，不抛错

**Scenario: config 缺必填字段**
- Given config 缺 host
- When init(config)
- Then reject with `InvalidFileSourceConfig`，message 含缺失字段名

**Scenario: 连接/认证失败**
- Given 远端拒绝认证
- When init(config)
- Then reject with `FileSourceAuthError`，原始 error 挂 cause

---

## FileSourceAdapter.listFiles

**Scenario: 首次 scan · cursor.lastScanAt = null**
- Given cursor = { lastScanAt: null, seenIds: [] }
- When listFiles(cursor)
- Then 所有当前可见文件进 `added`
- And `updated = []`, `removed = []`
- And `nextCursor.lastScanAt` ≈ now
- And `nextCursor.seenIds` 包含所有返回文件的 id

**Scenario: 增量 scan · 新增文件**
- Given 上次见过 ids = ['A','B']
- And 当前远端有 ['A','B','C']；C.mtime > cursor.lastScanAt
- When listFiles(cursor)
- Then `added = [C]`, `updated = []`, `removed = []`

**Scenario: 增量 scan · 文件被修改**
- Given 上次见过 ids = ['A','B']
- And A.mtime > cursor.lastScanAt · B.mtime < cursor.lastScanAt
- When listFiles(cursor)
- Then `added = []`, `updated = [A]`, `removed = []`

**Scenario: 增量 scan · 文件被删除**
- Given 上次见过 ids = ['A','B','C']
- And 当前远端只有 ['A','B']
- When listFiles(cursor)
- Then `added = []`, `updated = []`, `removed = ['C']`

**Scenario: cursor.seenIds 在 nextCursor 里去重且只含本轮见到的**
- Given 上次 seen = ['A','B','X','Y']（X/Y 是已经不存在的历史残留）
- And 当前远端 = ['A','B','C']
- When listFiles(cursor)
- Then `nextCursor.seenIds` = ['A','B','C']（X/Y 不保留）

**Scenario: 同一 id 稳定**
- Given 同一文件两次 scan
- Then 两次的 `descriptor.id` 严格相等

**Scenario: listFiles 幂等**
- Given 同一 cursor 连续调两次 listFiles（中间无远端变化）
- Then 两次返回 `added` / `updated` / `removed` 集合相等（顺序不保证）

---

## FileSourceAdapter.fetchFile

**Scenario: 成功读**
- Given 文件存在
- When fetchFile(id)
- Then 返回 `{ buffer, descriptor }`
- And `buffer.length === descriptor.size`（允许 adapter 为 size=0 的空文件返回 0 长度 buffer）

**Scenario: 文件不存在（源头已删）**
- Given 文件已从远端消失
- When fetchFile(id)
- Then reject with `FileSourceNotFoundError`

**Scenario: 文件超过 max_file_mb**
- Given config.max_file_mb = 200 · 远端文件 250MB
- When fetchFile(id)
- Then reject with `FileSourceFileTooLarge`（含 size 信息），不真的拉下载

**Scenario: fetch 不动 cursor**
- Given 任意成功/失败的 fetchFile 调用
- Then adapter 内部 cursor 状态不变（cursor 只由调度器在 scan 成功后 save）

---

## FileSourceAdapter.close

**Scenario: close 后再调用任何方法**
- Given adapter.close() 已 resolve
- When 调 listFiles 或 fetchFile
- Then reject with `FileSourceClosed`

**Scenario: 重复 close 幂等**
- Given close 已调用
- When 再次 close
- Then resolve，不抛错

---

## ListCursor 语义

**Scenario: 未知字段向前兼容**
- Given cursor 含 `{ lastScanAt, seenIds, futureFieldX: 'hello' }`
- When adapter 实现不认识 futureFieldX
- Then adapter 忽略该字段，不抛错；nextCursor 不强制保留 futureFieldX

**Scenario: seenIds 巨大时不被序列化阻塞**
- Given seenIds 超过 100_000 条
- Then adapter 仍能正常返回 nextCursor（不强制截断，但文档建议 Execute 阶段出 soft cap）

---

## scan 主循环（调度器调用 adapter 的编排）

**Scenario: added + updated 全部走 ingestDocument**
- Given listFiles 返回 added=[A], updated=[B]
- Then 对 A 和 B 都调 `fetchFile(id)` 再调 `ingestDocument({ buffer, name, sourceId, principal:SYSTEM, opts:{ externalId, externalPath, mtime, fileSourceId } })`

**Scenario: removed 标 offline 不删 chunk**
- Given listFiles 返回 removed=['X']
- Then `UPDATE metadata_asset SET offline=true WHERE file_source_id=$1 AND external_id=$2`
- And 对应的 `metadata_field` / pgvector chunk 不 DELETE

**Scenario: 单文件 fetch 失败 scan 继续**
- Given fetchFile(A) 抛错 · fetchFile(B) 成功
- Then B 正常 ingest
- And A 记入 `failed_items = [{id:'A', error:'...'}]`
- And scan log 最终 status = 'partial'

**Scenario: listFiles 整体失败 cursor 不推进**
- Given listFiles 抛错
- Then cursor 保留旧值
- And scan log status = 'error'
- And `metadata_file_source.last_scan_status = 'error'`，`last_scan_error` 记 message

**Scenario: permission_source_id IS NULL 拒 scan**
- Given row.permission_source_id = NULL
- Then scan 不启动 · 返回 422 / 写 log status='error' error_message='permission_source_id_missing'

**Scenario: MASTER_ENCRYPT_KEY 缺失拒 scan**
- Given env 无 MASTER_ENCRYPT_KEY · config 有加密字段
- Then decryptConfig 抛 `MasterEncryptKeyMissing`
- And scan status='error'，api 返回 503

**Scenario: SIGTERM 中断**
- Given scan 进行中 qa-service 收到 SIGTERM
- When AbortController.abort()
- Then adapter.close() 被调
- And 未完成的 added/updated 不 ingest
- And cursor **不** 更新（保守）
- And scan log status='error' error_message='aborted'

---

## metadata_asset UPSERT 语义

**Scenario: 同一外部文件 mtime 变化 → 更新不新建**
- Given 已存在 asset · `file_source_id=1, external_id='\\host\share\a.pdf', source_mtime=t1`
- When 新 scan 看到同一 id · mtime=t2 > t1
- Then `UPDATE metadata_asset SET source_mtime=t2, offline=false ... WHERE id=<existing>`
- And 重跑抽取：chunk / embed 覆盖

**Scenario: offline 的 asset 被源头重新 "看见" → 回归 online**
- Given asset offline=true
- When listFiles 的 added 或 updated 包含其 external_id
- Then `UPDATE ... SET offline=false, source_mtime=<new>`

**Scenario: 不同 source 下相同 external_id 是两条 asset**
- Given source_id=1 和 source_id=2 都有文件 id='/foo/a.pdf'
- Then 产生两条 metadata_asset 行，互不冲突（UPSERT 键是 `(file_source_id, external_id)`）

---

## SYSTEM_PRINCIPAL

**Scenario: scan 入库用 system 身份**
- Given scan 进行中
- Then `ingestDocument` 收到的 principal = `{ user_id: 0, email: 'system', roles: ['system'], team_ids: [] }`

**Scenario: audit_log 里操作者标 system**
- Given scan 完成后的 audit_log 行
- Then `actor_email = 'system'`，`actor_user_id = 0`
