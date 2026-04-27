# Spec: 知识治理子模块

## audit_log 写入

**Scenario: ingest 完成自动写一条**
- Given 任意 ingestDocument 成功完成 assetId=42
- Then audit_log 多一行 `action='ingest_done', target_type='asset', target_id='42', detail={extractorId, chunks, ...}`

**Scenario: ACL 规则增删改写审计**
- Given POST /api/acl/rules 创建规则 id=7
- Then audit_log 多一行 `action='acl_rule_create', target_type='rule', target_id='7', detail.permission='READ'`

**Scenario: 审计写入失败不影响主流程**
- Given audit_log 表临时不可写
- When ingest 完成调 writeAudit
- Then ingest 仍返 200；只在日志 WARN

---

## /api/governance/tags

**Scenario: 列表返计数 + 7 天增长**
- Given metadata_asset 三条 tags=['a','b'], ['a'], ['c']
- And 其中 ['a'] 的 asset 是近 7 天创建的
- Then GET /tags 返 `[{name:'a',count:2,recentGrowth:1},{name:'b',count:1,...},{name:'c',count:1,...}]`

**Scenario: 合并多个标签到一个**
- Given POST /tags/merge body `{srcs:['a-old','a_old'],dst:'a'}`
- Then 所有含 'a-old' 或 'a_old' 的 asset.tags 替换为 'a'
- And 响应 `{affected: number}`
- And 写一条 audit `action='tag_merge'`

---

## /api/governance/duplicates

**Scenario: 默认阈值 0.85**
- Given 5 个 asset；其中 (3,4) cosine=0.92, (1,2) cosine=0.83, 其它低
- When GET /duplicates
- Then 返 `[{a:asset3, b:asset4, similarity:0.92}]`（0.83 不达标）

**Scenario: 自定义阈值**
- Given 同上
- When GET /duplicates?threshold=0.80
- Then 返 (3,4) 和 (1,2) 两对

**Scenario: dismissed 对被过滤**
- Given duplicate_dismissed 含 (3,4)
- Then GET /duplicates 返 []

**Scenario: merged_into 不为 NULL 的 asset 不参与**
- Given asset 4 已被合并 (merged_into=5)
- Then GET /duplicates 中不再出现 asset 4

**Scenario: 合并 asset**
- Given POST /duplicates/merge body `{srcId:3, dstId:4}`
- Then metadata_asset.merged_into 更新；metadata_field 的 asset_id 全转 4
- And 写 audit `action='asset_merge'`

---

## /api/governance/quality-issues

**Scenario: 分组聚合**
- Given 10 asset，3 个 author 为空，2 个 tags 为空数组，1 个 indexed_at < now-180d
- Then GET /quality-issues 返：
  - `{kind:'missing_author', count:3, hint:'补全作者元数据'}`
  - `{kind:'no_tags', count:2, hint:'重新抽取标签'}`
  - `{kind:'stale', count:1, hint:'通知 Owner 复审'}`

**Scenario: 批量修复 missing_author**
- Given POST /quality-issues/fix body `{kind:'missing_author', assetIds:[1,2,3]}`
- Then asset 1/2/3 的 author = '系统'
- And 写 audit `action='quality_fix', detail={kind:'missing_author', count:3}`

**Scenario: stale 修复 = 仅发提醒，不改 asset**
- Given POST /quality-issues/fix body `{kind:'stale', assetIds:[5]}`
- Then asset 5 的字段不变
- And 写 audit `action='quality_fix', detail={kind:'stale', notified:[5]}`

---

## /api/governance/audit-log

**Scenario: 分页 + 时间倒序**
- Given audit_log 100 行
- When GET /audit-log?limit=20&offset=0
- Then 返最新 20 条；total=100

**Scenario: 按 action 过滤**
- Given audit_log 含 ingest_done x10, acl_rule_create x5
- When GET /audit-log?action=ingest_done
- Then 返 10 行

**Scenario: CSV 导出**
- When GET /audit-log.csv
- Then Content-Type: text/csv
- And 第一行表头：`ts,user_email,action,target_type,target_id,detail`
- And 每行字段按 RFC 4180 转义（含逗号 / 引号）

---

## ACL 接入

**Scenario: 写操作要求 WRITE 权限**
- Given principal roles=['viewer']
- When POST /api/governance/tags/merge
- Then 403 (DEV BYPASS 模式下放行)

---

## 前端 4 子 Tab

**Scenario: 默认进入"标签体系"**
- Given 进入 /governance/knowledge
- Then 第一个子 Tab "标签体系" 激活；其它 3 个未激活

**Scenario: 三态 — 标签为空**
- Given GET /tags 返 []
- Then "标签体系" 面板显示空态：`引导从入库自动抽取标签开始` + "去入库"按钮

**Scenario: 三态 — 重复检测无高相似对**
- Given GET /duplicates 返 []
- Then 面板显示空态：`当前没有高相似条目`

**Scenario: 三态 — 错误态**
- Given API 返 500
- Then 面板显示错误 + "重试" 按钮
