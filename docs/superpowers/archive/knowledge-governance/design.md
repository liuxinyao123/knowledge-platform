# Design: 知识治理子模块

## DB schema 增量

```sql
-- 审计日志（核心表，PRD §17.5 强制）
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMP NOT NULL DEFAULT NOW(),
  principal_user_id INT,                        -- Principal.user_id
  principal_email   VARCHAR(255),
  action          VARCHAR(64) NOT NULL,         -- ingest_done / acl_rule_create / tag_merge / ...
  target_type     VARCHAR(32),                  -- 'asset' / 'tag' / 'rule' / ...
  target_id       VARCHAR(128),                 -- string 化（asset_id 或 'phone' tag 名）
  detail          JSONB,
  source_ip       VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(principal_user_id);

-- 重复检测忽略表
CREATE TABLE IF NOT EXISTS duplicate_dismissed (
  asset_id_a INT NOT NULL,
  asset_id_b INT NOT NULL,
  dismissed_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (asset_id_a, asset_id_b)
);

-- metadata_asset 加 merged_into 软删除标
ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS merged_into INT;
ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS author VARCHAR(255);
```

## 文件结构

```
apps/qa-service/src/
  ├── services/
  │   ├── audit.ts                   —— writeAudit() 唯一入口
  │   └── governance/
  │       ├── tags.ts                —— 标签查询 / 合并 / 重命名
  │       ├── duplicates.ts          —— 高相似 asset 对发现 + 合并
  │       └── quality.ts             —— 质量问题分组 + 批量修复
  └── routes/
      └── governance/
          ├── tags.ts
          ├── duplicates.ts
          ├── quality.ts
          └── auditLog.ts
```

挂载：复用现有 `/api/governance` 路径前缀，子路径如 `/api/governance/tags`、`/api/governance/duplicates` 等。

## services/audit.ts

```ts
export interface AuditEntry {
  action: string                     // 'ingest_done' / 'acl_rule_create' / ...
  targetType?: string
  targetId?: string | number
  detail?: Record<string, unknown>
  principal?: { user_id: number; email: string }
  sourceIp?: string
}

export async function writeAudit(e: AuditEntry): Promise<void> {
  // 同步写 PG；失败只 WARN 不抛
}
```

挂入：
- `ingestPipeline.runPipeline` 完成时
- `routes/acl.ts` 的 POST/PUT/DELETE 完成时
- `routes/governance/tags.ts` 的 merge/rename 完成时
- `routes/governance/duplicates.ts` 的 merge 完成时

## 标签 service

```ts
// 列表 + 用法计数 + 7 天增长
export async function listTags(): Promise<Array<{
  name: string; count: number; recentGrowth: number   // 近 7 天新增带此 tag 的 asset 数
}>> {
  // SELECT unnest(tags) AS name, COUNT(*) FROM metadata_asset GROUP BY name
  // 加 7-day filter 的子查询
}

export async function mergeTags(srcs: string[], dst: string): Promise<{ affected: number }>
export async function renameTag(from: string, to: string): Promise<{ affected: number }>
```

## 重复检测 service

```ts
/** 找高相似 asset 对（基于每个 asset 的"代表向量" = chunk_level=3 的均值或首向量） */
export async function findDuplicatePairs(opts: {
  threshold: number; limit: number
}): Promise<Array<{
  a: { id: number; name: string }
  b: { id: number; name: string }
  similarity: number
}>>
// 实现：用 metadata_field 第一个 chunk_level=3 + embedding 不为空作为 asset 代表向量；
//      对每个 asset 找最近邻，cosine > threshold 即一对
//      过滤 duplicate_dismissed 记录
//      过滤 merged_into IS NOT NULL 的
//      LIMIT N

export async function mergeAssets(srcId: number, dstId: number): Promise<void>
// metadata_asset SET merged_into = dstId WHERE id = srcId
// metadata_field UPDATE asset_id = dstId WHERE asset_id = srcId
// 写审计

export async function dismissDuplicate(a: number, b: number): Promise<void>
// INSERT duplicate_dismissed
```

## 质量评分 service

```ts
type QualityIssueKind = 'missing_author' | 'stale' | 'empty_content' | 'no_tags'

export async function listQualityIssues(): Promise<Array<{
  kind: QualityIssueKind
  description: string
  count: number
  hint: string                        // PRD 要求的"建议"文案
}>>
// 按 kind 分组聚合 metadata_asset

export async function listIssueAssets(kind: QualityIssueKind, limit: number): Promise<Asset[]>
// 拉某 kind 的具体 asset 列表

export async function fixIssueBatch(kind: QualityIssueKind, assetIds: number[]): Promise<{
  fixed: number
}>
// missing_author: SET author = '系统'（占位）
// no_tags: 重新抽 tags（调 extractTags）
// stale: 不自动修复，仅记一条审计 'reminder_sent'
// empty_content: SET merged_into = -1（自下线）
```

## 审计日志 路由

```ts
GET /api/governance/audit-log?from=&to=&action=&user_id=&limit=&offset=
  → { items: AuditEntry[], total: number }

GET /api/governance/audit-log.csv?<同上>
  → text/csv 流，列 ts/user/action/target/detail
```

## 前端

```
apps/web/src/knowledge/Governance/
  ├── index.tsx              —— 已有，加新 Tab "知识治理" 入口
  └── KnowledgeOps/          —— 新目录
      ├── index.tsx          —— 4 子 Tab 容器
      ├── TagsPanel.tsx      —— 标签列表 + 合并 / 重命名 modal
      ├── DuplicatesPanel.tsx —— 高相似对列表 + 阈值 slider
      ├── QualityPanel.tsx   —— 质量问题分组 + 修复按钮
      └── AuditLogPanel.tsx  —— 审计表 + 过滤 / 导出 CSV
```

每个 Panel 实现三态：默认 / 空态 / 错误态。

## 测试策略

- `audit.test.ts` —— mock pg，验 writeAudit 失败不抛
- `tags.test.ts` —— merge / rename SQL 正确性
- `duplicates.test.ts` —— mock embeddings 验对比逻辑 + threshold + dismissed 过滤
- `quality.test.ts` —— 各 kind 的 SQL 聚合 + fix 行为
- `auditLog.routes.test.ts` —— CSV 输出格式 + 过滤参数

## 风险

- 重复检测对每个 asset 算最近邻 = O(n²)；初期 < 1000 asset 可接受；上千需要批量化
- 审计日志增长可能很快；预留 cron job 归档（不在本 change 做）
- 质量"自动修复"对 stale 不做实际操作（只发提醒），原型期可接受
