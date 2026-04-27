# Design: permissions-v2

## 1. V2 行为契约（冻结，不改代码）

### 1.1 数据模型

```sql
-- 已存在，这里只复述契约要求
ALTER TABLE metadata_acl_rule
  ADD COLUMN IF NOT EXISTS subject_type VARCHAR(16),  -- 'role' | 'user' | 'team' | NULL(legacy)
  ADD COLUMN IF NOT EXISTS subject_id   VARCHAR(255), -- role名 / email / team数字字符串 / '*'
  ADD COLUMN IF NOT EXISTS effect       VARCHAR(8)    DEFAULT 'allow', -- 'allow' | 'deny'
  ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS team (id SERIAL PK, name TEXT UNIQUE, created_at ...);
CREATE TABLE IF NOT EXISTS team_member (team_id FK, user_email TEXT, ...);
CREATE INDEX idx_team_member_user ON team_member(user_email);

CREATE TABLE IF NOT EXISTS notebook_member (
  notebook_id INT REFERENCES notebook(id),
  subject_type VARCHAR(16),       -- 'user' | 'team'（非 'user' 一律归为 'team'，不支持 'role'）
  subject_id   VARCHAR(255),      -- user 时必须是 email；team 时是 team.id 的字符串
  role         VARCHAR(16),       -- notebook 内的协作角色 ∈ {'editor', 'reader'}；默认 'reader'
  added_by     VARCHAR(255),      -- 谁加的（principal.email，便于追溯）
  PRIMARY KEY (notebook_id, subject_type, subject_id)
);
CREATE INDEX idx_notebook_member_subject ON notebook_member(subject_type, subject_id);
```

注意：`notebook_member.role` 与 `principal.roles` **语义不同** —— 前者是 notebook 内协作角色，后者是系统角色。UI/文档必须用不同字眼避免混淆（推荐 UI 显示"协作角色"而非"角色"）。

### 1.2 评估顺序（`evaluateAcl.ts`）

```
1. 拉所有候选 rule（按 source_id/asset_id/NULL 匹配 + notExpired 过滤）
2. 遍历，用 subjectMatches(rule, principal) 判主体
   - rule.subject_type='role'  → principal.roles.includes(subject_id)
   - rule.subject_type='user'  → principal.email === subject_id
   - rule.subject_type='team'  → principal.team_ids.includes(subject_id)
   - rule.subject_type=NULL(legacy) → 回退老逻辑（rule.role NULL 视为全员，否则比对 role）
3. 若 effect='deny' 命中 → denyMatched.push；**continue**（不算入 allow）
4. 否则 → allowMatched.push
5. denyMatched 非空 → DENY（reason: "denied by rule(s) <ids>"）
6. allowMatched 非空 → ALLOW
7. 否则 → DENY（deny-by-default）
```

### 1.3 R-1 双轨种子（`ensureDefaultAclRules`）

```
if (SELECT COUNT(*) FROM metadata_acl_rule) === 0 →
   新装 DB 分支：
     INSERT admin/READ, admin/WRITE, admin/ADMIN（只 admin）
   结束。

else →
   升级 DB 分支：
     for s in [READ, WRITE, ADMIN]:
       if NOT EXISTS admin-<s>: INSERT
       （不动旧 subject_id='*' READ 行）
     if EXISTS (subject_id='*' AND permission='READ'):
       console.warn('[acl] 检测到旧全局 READ seed (rule id=...)；建议在 /iam?tab=rules 收紧')
     结束。
```

**回滚开关**：如果 admin 发现严格种子误锁，SQL 临时恢复：
```sql
INSERT INTO metadata_acl_rule (subject_type, subject_id, permission, effect)
VALUES ('role', '*', 'READ', 'allow');
```

## 2. F-3 · ACL 审计

### 2.1 新表

```sql
CREATE TABLE IF NOT EXISTS acl_rule_audit (
  id              SERIAL PRIMARY KEY,
  rule_id         INT,                    -- 被改的规则 id（DELETE 后保留）
  actor_user_id   INT,                    -- principal.user_id
  actor_email     VARCHAR(255),
  op              VARCHAR(8) NOT NULL,    -- 'CREATE' | 'UPDATE' | 'DELETE'
  before_json     JSONB,                  -- UPDATE/DELETE 写老值；CREATE 为 NULL
  after_json      JSONB,                  -- CREATE/UPDATE 写新值；DELETE 为 NULL
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acl_rule_audit_rule ON acl_rule_audit(rule_id);
CREATE INDEX idx_acl_rule_audit_at   ON acl_rule_audit(at DESC);
```

### 2.2 写入点（`routes/acl.ts`）

| 操作 | before | after |
|---|---|---|
| POST /api/acl/rules (CREATE) | NULL | 新行 |
| PUT /api/acl/rules/:id (UPDATE) | 老行 | 新行 |
| DELETE /api/acl/rules/:id (DELETE) | 老行 | NULL |

**与现有 `writeAudit` 的关系**：`routes/acl.ts` 当前已调 `writeAudit({action:'acl_rule_create', ...})` 写入老的 `audit_log` 表（见 `pgDb.ts:134`）。本 change **保留该调用不动**（避免破坏既有业务审计消费者），**另外**新增一条 `acl_rule_audit` INSERT，提供结构化 `before/after` 列便于 IAM 审计视图直接查询。两套并行、职责互补：
- `audit_log`：跨业务的统一操作流（user_created / rule_create / notebook_deleted ...）
- `acl_rule_audit`：ACL 规则专表，便于按 rule_id / 时间窗查 before/after diff

若未来决定统一，走 V2.x 迁移。

### 2.3 端点

```ts
GET /api/iam/acl/audit        // ADMIN 门（enforceAcl requiredPermission='iam:manage'）
  query: {
    rule_id?: number
    actor?: string            // 精确 email
    since?: ISO string
    until?: ISO string
    limit?: number            // 默认 50，上限 500
  }
  response: { items: AuditRow[], total: number }
```

### 2.4 前端

`apps/web/src/knowledge/Iam/AuditTab.tsx` 新建：表格列 `at / actor / op / rule_id / before → after diff`。diff 用简化展示（只列改动字段）。挂进 `Iam/index.tsx` 成为第 5 Tab「审计」。

## 3. F-2 · Spaces / Assets 权限抽屉

### 3.1 入口

- **SpaceTree（源列表）**：每行右侧 kebab 菜单加「权限…」（仅对 `source_id` 有值的行显示）
- **Assets/Detail**：顶栏按钮栏加「权限…」

两个入口统一打开同一个组件 `PermissionsDrawer`，传参 `{ resourceKind: 'source' | 'asset', resourceId: number }`。

### 3.2 PermissionsDrawer（复用 RulesTab 组件）

```
┌─ 权限抽屉 ─────────────────── ✕ ┐
│ 资源：source#7 "BookStack 知识库" │
│                                  │
│ 当前规则：                       │
│ ┌ 主体 │ perm │ effect │ 过期 ─┐│
│ │ role:viewer│ READ │ allow │ - ││
│ │ team:3    │ READ │ allow │ 7d││
│ └───────────────────────────────┘│
│                                  │
│ [+ 新增规则]                     │
│                                  │
│ (点+ 弹) 主体类型 [role|user|team]│
│         主体 [...]                │
│         permission [READ|WRITE|ADMIN]│
│         effect [allow|deny]      │
│         expires_at (可选)        │
│         [保存]                   │
└──────────────────────────────────┘
```

组件实现：
- 列表：`GET /api/acl/rules?source_id=<id>` 或 `?asset_id=<id>`
- 新增：`POST /api/acl/rules` 预填 `source_id` / `asset_id`
- 删除/修改：直接调 RulesTab 已有的删除/编辑逻辑（抽成 hook `useRuleMutations`）

### 3.3 不引入新后端

所有数据来源 / 写入都走既有 `/api/acl/rules`。抽屉只是视图 + 预填。

## 4. API 汇总

| 变更 | 路由 | 权限 | 备注 |
|---|---|---|---|
| 新增 | `GET /api/iam/acl/audit` | `iam:manage` | F-3 |
| 不变 | `POST /api/acl/rules` | `iam:manage` | F-2 抽屉复用，写入时串 audit |
| 不变 | `PUT /api/acl/rules/:id` | `iam:manage` | 同上（沿用现网路由，非 PATCH） |
| 不变 | `DELETE /api/acl/rules/:id` | `iam:manage` | 同上 |
| 不变 | `GET /api/acl/rules` | `iam:manage` | 抽屉直接查 |

## 5. 约束

- **审计写失败不阻塞业务**：audit INSERT 失败（比如表还没建好）只 `console.error`，不让 `/api/acl/rules` 的业务成功返 5xx。
- **抽屉只允许授权域**：抽屉里能操作的规则范围必须限定在 `source_id` / `asset_id` 匹配；禁止通过抽屉改全局规则（全局规则一律去 `/iam?tab=rules`）。
- **R-1 WARN 一次**：升级 DB 的 WARN 只在启动时打印一次，不每次请求都打。
