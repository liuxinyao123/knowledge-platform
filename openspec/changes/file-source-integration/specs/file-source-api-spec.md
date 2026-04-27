# Spec: file-source-api（HTTP 行为契约）

> 所有路径挂在 `/api/file-sources`，所有方法要求 `permission:iam:manage`（未持该权限 → 403）。未登录 → 401。

## POST /api/file-sources · 创建

**Scenario: 合法创建**
- Given body = `{ type:'smb', name:'NAS 工程目录', config_json:{host:'nas', share:'docs', path:'/', username:'svc', password:'...' }, cron:'0 */6 * * *', permission_source_id: 3 }`
- When POST
- Then 201，返回新行（不含 password，password_enc 字段已返回 `"***"`）
- And DB 里 config_json.password 已被加密成 `"iv:ct:tag"` base64 字符串，字段名改为 `password_enc`

**Scenario: type 非法**
- Given body.type = 'ftp'（不在 4 种枚举内）
- Then 400，error_code = 'invalid_file_source_type'

**Scenario: cron 非法**
- Given body.cron = 'not a cron'
- Then 400，error_code = 'invalid_cron'

**Scenario: permission_source_id 不存在**
- Given body.permission_source_id 对应 source 未找到
- Then 400，error_code = 'permission_source_id_not_found'

**Scenario: 未登录**
- Given 无 auth header / token 无效
- Then 401

**Scenario: 登录但无 iam:manage 权限**
- Given principal.roles = ['editor']
- Then 403

---

## GET /api/file-sources · 列表

**Scenario: ADMIN 拉列表**
- Given 3 条 source
- When GET
- Then 200，body = `{ items: [...] }`
- And 每条 config_json 里的加密字段被 mask 为 `"***"`
- And `last_cursor` 字段不在列表返回中（详情才返回，避免大 payload）

**Scenario: 分页**
- Given ≥ 21 条 source · query `?limit=20&offset=0`
- Then items.length = 20，返回头 `X-Total-Count: <N>`

---

## GET /api/file-sources/:id · 详情

**Scenario: 返回含 last_cursor 但不含密文**
- When GET /:id
- Then 200，body 含 `last_cursor` + `last_scan_status` + `last_scan_at` + 其它配置
- And 加密字段 `"***"`

**Scenario: id 不存在**
- Then 404

---

## PATCH /api/file-sources/:id · 更新

**Scenario: 改 cron**
- Given body = `{ cron: '*/30 * * * *' }`
- Then 200 · DB 更新 · scheduler 被通知重排（本 source 被重新插入 cron 排期）

**Scenario: 改 password（新密码）**
- Given body.config_json.password = 'newpass'
- Then DB 里 config_json.password_enc 用新密文覆盖，旧 iv/tag 作废

**Scenario: 不改 password（PATCH 只含 cron）**
- Given body 无 config_json.password
- Then DB config_json.password_enc 保持旧值不变

**Scenario: 改 enabled=false**
- Given body = `{ enabled: false }`
- Then DB 更新 · scheduler 从排期中移除本 source
- And 正在进行的 scan 不被打断（下一轮 scan 不会启动）

**Scenario: 非法字段**
- Given body 含 `{ last_cursor: <任意值> }`
- Then 400，error_code = 'immutable_field'（cursor 只能由 scan 写）

---

## DELETE /api/file-sources/:id · 删接入点

**Scenario: 删 source 不删 assets**
- Given 该 source 已 ingest 过若干 assets
- When DELETE
- Then 204 · `metadata_file_source` 行删除
- And 对应 `metadata_asset` 的 `file_source_id` 置 NULL（ON DELETE SET NULL），`offline` 字段保留不动
- And scheduler 立即从排期移除

**Scenario: 并发 DELETE + scan**
- Given scan 进行中 · 同时 DELETE
- Then scan 完成 scan 写 log 时因为 source 已删，UPSERT 被外键兜住，scan 标 status='error'（"source removed mid-scan"）

---

## POST /api/file-sources/:id/scan · 立即扫

**Scenario: 触发成功**
- Given enabled=true · 无进行中 scan
- When POST
- Then 202 · body = `{ scan_log_id: <N>, status: 'queued' }`
- And 立即返回，不等 scan 完成

**Scenario: 已有 scan 进行中**
- Given 同 source 有 status='running' 的 log
- When POST
- Then 202 · body = `{ scan_log_id: <existing>, status: 'already_running' }`（不启新 scan）

**Scenario: source enabled=false**
- Then 409，error_code = 'source_disabled'

**Scenario: MASTER_ENCRYPT_KEY 缺失**
- Then 503，error_code = 'master_encrypt_key_missing'

---

## GET /api/file-sources/:id/logs · 扫描日志

**Scenario: 默认取最近 20 条**
- When GET
- Then 200，body = `{ items: [最新优先] }`，最多 20 条

**Scenario: 自定义 limit**
- Given query `?limit=50`
- Then 最多 50（上限 100，超过取 100）

**Scenario: failed_items 结构**
- Given log 含 failed_items = [{id:'\\host\...\\a.pdf', error:'timeout'}]
- Then 返回的 failed_items 每项必含 `id` 和 `error`

---

## POST /api/file-sources/:id/test · 试连

**Scenario: 成功试连**
- Given adapter.init / listFiles 首页成功
- Then 200 · body = `{ ok: true, sample: <前 5 条 descriptor> }`
- And 不写 DB · 不更新 cursor · 不入库任何 chunk

**Scenario: 认证失败**
- Then 200 · body = `{ ok: false, error_code: 'auth_failed', message: 'NTLM 认证被拒绝' }`（注意是 200 不是 401；这是"业务试连结果"，不是 HTTP 认证）

**Scenario: 网络不可达**
- Then 200 · body = `{ ok: false, error_code: 'network_unreachable' }`

---

## 通用错误约束

**Scenario: 所有 error 返回都含 error_code**
- Given 任何 4xx / 5xx 响应
- Then body = `{ error: { code: string, message: string } }`

**Scenario: 500 不泄漏 stack**
- Then response body.error.message 是人话，不是 stack trace；真实 stack 打 qa-service 日志

**Scenario: 响应永不含明文 password**
- Given 任意 API 返回的任意路径
- Then 响应 body stringify 后不得含 `"password"` 键名（加密字段必须是 `"password_enc"` 且值被 mask 为 `"***"` 再返回）
