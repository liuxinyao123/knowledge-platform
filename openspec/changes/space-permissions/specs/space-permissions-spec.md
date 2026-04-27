# Behavior Spec — space-permissions

> 冻结契约。下游消费者以本文件为准；代码修改必须同步 spec 改动。

## Entities

### Space
| 字段 | 类型 | 约束 |
|------|------|------|
| id | int | PK |
| slug | string(128) | UNIQUE, `^[a-z0-9][a-z0-9-]*$` |
| name | string(256) | NOT NULL |
| description | string | 可空 |
| visibility | enum | `org` \| `private` |
| owner_email | string(255) | NOT NULL；与 `space_member.role='owner'` 同步 |
| created_at | timestamptz | server now |
| updated_at | timestamptz | server now |

### SpaceMember
| 字段 | 类型 | 约束 |
|------|------|------|
| space_id | int | FK space.id ON DELETE CASCADE |
| subject_type | enum | `user` \| `team` |
| subject_id | string(255) | user = email；team = team.id::text |
| role | enum | `owner` \| `admin` \| `editor` \| `viewer` |
| added_by | string(255) | |
| added_at | timestamptz | |

- PK = (space_id, subject_type, subject_id)
- 不变量：每个 space 恰好一行 `role='owner'`，且 subject_type='user'
- 不变量：owner_email = 那一行 owner 的 subject_id

### SpaceSource
(space_id, source_id) 多对多，PK = 复合键。

### metadata_acl_rule（扩展）
- 新列 `space_id int NULL` + FK
- `space_id IS NULL` 语义：org 级，等价 V2 老行为
- `space_id = X` 语义：仅 `resolveSpaceOf(resource) ⊇ {X}` 时参与评估

## API Contract

### 通用

- 所有 `/api/spaces/**` 端点：`requireAuth` 必经；未登录 → 401
- 权限规则：
  - 任意成员 可 `GET /:id*`（除 role-templates）
  - `admin` + `owner` 可 `POST/PATCH/DELETE`（除转让 owner）
  - `owner` 独占 `POST /:id/transfer-owner`、`DELETE /:id`

### GET /api/spaces

Response:
```json
{
  "items": [
    {
      "id": 1,
      "slug": "knowledge-zhongtai",
      "name": "知识中台",
      "visibility": "org",
      "owner_email": "alice@x.com",
      "description": "...",
      "doc_count": 1248,
      "source_count": 5,
      "member_count": 12,
      "my_role": "editor",
      "updated_at": "2026-04-23T..."
    }
  ]
}
```
- 过滤规则：principal 是 owner / 是 member / visibility='org' 三选一即命中
- 排序：updated_at DESC, id DESC

### POST /api/spaces

Body:
```json
{
  "slug": "finance",
  "name": "财务",
  "description": "",
  "visibility": "org",
  "initialMembers": [
    {"subject_type":"team","subject_id":"3","role":"editor"}
  ]
}
```
- principal 自动 `role='owner'` 插 `space_member`
- 需要 org 级 permission `space.create`（走 enforceAcl）；默认映射到 `admin` 角色

### GET /api/spaces/:id

Response: 单个 Space + `my_role` + `members` 预览（前 5）+ `role_templates`。

### PATCH /api/spaces/:id

Body: 任意 `name / description / visibility` 子集。`slug` 不可改。

### DELETE /api/spaces/:id

硬删；CASCADE 触发 `space_member` / `space_source` / `metadata_acl_rule(space_id)` 同删。
必须 owner 且 body `{confirm: true}`，否则 412。

### GET /api/spaces/:id/members

Response:
```json
{
  "items": [
    {
      "subject_type": "user",
      "subject_id": "alice@x.com",
      "role": "owner",
      "display_name": "alice@x.com",
      "added_at": "...",
      "derived_permissions": ["READ","WRITE","DELETE","ADMIN"]
    }
  ]
}
```
- `display_name`：user → email；team → `team.name`
- `derived_permissions`：从 `SPACE_ROLE_DEFAULT_RULES[role]` 展开

### POST /api/spaces/:id/members

Body: `{subject_type, subject_id, role}`；role ∈ {admin, editor, viewer}（不允许直接建 owner）
- team 时 subject_id 必须是存在的 team.id
- user 时 subject_id 必须像 email
- 重复主体 → 409

### PATCH /api/spaces/:id/members/:key

`key = subject_type + ':' + subject_id`（URL-safe 单字段）
- role ∈ {admin, editor, viewer}；要改到 owner 请用 transfer-owner
- owner 行不可 PATCH

### DELETE /api/spaces/:id/members/:key

- owner 不可被删；transfer 后再删
- 级联删投影规则

### POST /api/spaces/:id/transfer-owner

Body: `{subject_type:"user", subject_id:"<email>"}`
- 目标必须是现存 member 或 新 member（为空则自动先 insert role='admin' 再升 owner）
- 事务内：原 owner 降级 admin，新 owner 升 role='owner'，`space.owner_email` 更新，投影规则重生成

### GET /api/spaces/:id/sources?groupBy=tag|none

Response:
```json
{
  "groups": [
    {
      "name": "治理规范",
      "sources": [
        {"id": 11, "name": "...", "tag": "治理规范", "asset_count": 12, "updated_at_ms": 17..., "updated_label":"昨天"}
      ]
    }
  ]
}
```
- `groupBy=tag`：按 `metadata_source.config->>'group_tag'` 或 source name 前缀分组；未打 tag → 分组 "未归类"
- `groupBy=none`：单分组 `name="全部"`

### POST /api/spaces/:id/sources
Body: `{source_ids:[int]}`
- 已存在的对 ignore；返回 `{added:n}`

### DELETE /api/spaces/:id/sources/:sourceId
幂等；返回 `{ok:true}`

### GET /api/spaces/role-templates

Response:
```json
{
  "templates": {
    "owner":  [{"effect":"allow","permission":"ADMIN"}],
    "admin":  [{"effect":"allow","permission":"ADMIN","permission_required":"space.admin"}],
    "editor": [{"effect":"allow","permission":"WRITE"},{"effect":"allow","permission":"READ"}],
    "viewer": [{"effect":"allow","permission":"READ"}]
  }
}
```

## Invariants

1. `space.owner_email` ≡ `space_member.subject_id WHERE role='owner'`（事务内保证）
2. 投影规则：`metadata_acl_rule.space_id = X` AND `subject_type/subject_id` 存在于 `space_member` 内 → 视为投影，RulesTab 只读
3. 删除 space → CASCADE → 所有 scoped rule 同时消失；org 级 rule 不受影响
4. Feature flag：`SPACE_PERMS_ENABLED = false` → `resolveSpaceOf()` 始终返回空集；API 端点仍可用但 `space_id` 不影响评估

## 审计

所有写接口（POST/PATCH/DELETE）写 `acl_rule_audit`：
- `op`：create / update / delete / transfer
- `before_json` / `after_json`：包括空间 meta 和成员 snapshot
- `actor_email`：principal.email

不单独建 `space_audit` 表。
