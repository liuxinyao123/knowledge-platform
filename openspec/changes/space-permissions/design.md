# Design — space-permissions（Locked）

> 从 `docs/superpowers/specs/space-permissions/design.md` 收敛；Open Questions 全部落定。

## 1. 数据模型（最终）

```sql
CREATE TABLE IF NOT EXISTS space (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(128) NOT NULL UNIQUE,
  name        VARCHAR(256) NOT NULL,
  description TEXT,
  visibility  VARCHAR(16) NOT NULL DEFAULT 'org'
              CHECK (visibility IN ('org','private')),
  owner_email VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_space_owner ON space(owner_email);

CREATE TABLE IF NOT EXISTS space_member (
  space_id     INT NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  subject_type VARCHAR(16) NOT NULL CHECK (subject_type IN ('user','team')),
  subject_id   VARCHAR(255) NOT NULL,
  role         VARCHAR(16) NOT NULL
               CHECK (role IN ('owner','admin','editor','viewer')),
  added_by     VARCHAR(255),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_space_member_subject
  ON space_member(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS space_source (
  space_id  INT NOT NULL REFERENCES space(id) ON DELETE CASCADE,
  source_id INT NOT NULL REFERENCES metadata_source(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (space_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_space_source_source ON space_source(source_id);

ALTER TABLE metadata_acl_rule
  ADD COLUMN IF NOT EXISTS space_id INT NULL REFERENCES space(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_acl_space ON metadata_acl_rule(space_id);
```

### 投影规则（member → acl_rule）

对 `SPACE_ROLE_DEFAULT_RULES[role]` 里的每条 `{effect, permission, permission_required?}`：

```ts
INSERT INTO metadata_acl_rule
  (space_id, source_id, asset_id, role, subject_type, subject_id,
   effect, permission, permission_required)
VALUES
  ($spaceId, NULL, NULL, NULL,
   $member.subject_type, $member.subject_id,
   $effect, $permission, $permission_required)
```

- `metadata_acl_rule.space_id` 有值 + `subject_type/subject_id` 来自成员 → 识别为投影规则
- `RulesTab` 渲染时，`space_id IS NOT NULL && NOT EXISTS manual_tag`
  视为投影规则，改/删按钮置灰
- 成员变更走事务：先删该成员对应的投影规则（`WHERE space_id=? AND subject_type=? AND subject_id=?`），再重新插入

### 评估流程

```ts
enforceAcl(principal, action, resource):
  spaceIds = resolveSpaceOf(resource)       // set<number>，可能空集
  rules = metadata_acl_rule WHERE
    (space_id IS NULL OR space_id = ANY($spaceIds)) AND
    subject matches principal AND
    resource matches
  apply deny-over-allow + TTL + condition (不变)
```

`resolveSpaceOf(resource)`：
- resource.space_id 已带 → `{resource.space_id}`
- resource.source_id 已带 → `SELECT space_id FROM space_source WHERE source_id=?`（可能多行）
- resource.asset_id 已带 → `source_id = (SELECT source_id FROM metadata_asset WHERE id=?)` → 同上
- 以上都拿不到 → 空集，只评 `space_id IS NULL` 规则（等价老行为）

## 2. API 清单（最终）

### 空间

- `GET    /api/spaces` — 当前 principal 可见空间 + myRole + docCount
- `POST   /api/spaces` — body: `{slug, name, description?, visibility?, initialMembers?: Member[]}`；principal 自动成为 owner
- `GET    /api/spaces/:id` — 详情
- `PATCH  /api/spaces/:id` — body: `{name?, description?, visibility?}`（需 admin+）
- `DELETE /api/spaces/:id` — 硬删（需 owner）

### 成员

- `GET    /api/spaces/:id/members` — 成员列表 + 角色 + 派生权限预览
- `POST   /api/spaces/:id/members` — body: `{subject_type, subject_id, role}`（需 admin+，且 role 不可是 owner）
- `PATCH  /api/spaces/:id/members/:key` — body: `{role}`（key = `subject_type:subject_id`，URL encode）
- `DELETE /api/spaces/:id/members/:key` — 移除（不能删 owner）
- `POST   /api/spaces/:id/transfer-owner` — body: `{subject_type:'user', subject_id:'<email>'}`

### 空间内 source

- `GET    /api/spaces/:id/sources?groupBy=tag|none` — 默认 tag 分组
- `POST   /api/spaces/:id/sources` — body: `{source_ids: number[]}`
- `DELETE /api/spaces/:id/sources/:sourceId`

### 角色模板（辅助）

- `GET /api/spaces/role-templates` — 返回 `SPACE_ROLE_DEFAULT_RULES` 给前端渲染成员表右侧权限说明

## 3. 前端路由 / 组件

路由新增：

```
/spaces                 空间列表 + 详情主页（沿用入口）
/spaces/:id             = /spaces?selected=:id 的稳定链接
/spaces/:id/tree        旧 source→asset tree（保留资产预览路径）
```

组件（均在 `apps/web/src/knowledge/SpaceTree/`）：

- `index.tsx` — 重写外壳
- `SpaceListPane.tsx` — 左侧
- `SpaceDetailPane.tsx` — 右侧 stack
- `SpaceInfoCard.tsx`
- `SpaceMembersTable.tsx`
- `SpaceDirectoryList.tsx`
- `SpaceSourceTreePage.tsx` — `/spaces/:id/tree` 路由下，复用旧 TreePane/PreviewPane

API 模块：`apps/web/src/api/spaces.ts`。

## 4. 向后兼容

- `metadata_acl_rule.space_id = NULL` = org 级，评估等价老行为。
- 现有测试环境无 space 数据 → `space_source` 空 → `resolveSpaceOf` 返回空集 → `space_id IS NULL` 规则全部命中 → 所有老测试通过。
- `RulesTab` 不拆，只加一个 scope 列（投影规则只读，手发规则可改），避免 V2 刚落地的 UI 再抖。
- Glossary 条目改写，同时保留 "BookStack Shelf" 作为历史别名。

## 5. 风险与兜底

| 风险 | 兜底 |
|------|------|
| 成员批量变更事务失败 → 投影规则与成员不一致 | 投影走 `BEGIN; DELETE ... WHERE projected; INSERT ...; COMMIT` |
| 误删 space 导致 ACL 级联丢失 | `DELETE /api/spaces/:id` 需 owner；前端二次确认 |
| `resolveSpaceOf` 高频查询压 DB | 给 `space_source(source_id)` 加索引；principal 上的 team_ids 已有 cache |
| Feature flag | `SPACE_PERMS_ENABLED` env 关掉时，`resolveSpaceOf` 始终返回空集 → 等价 V2 老逻辑 |
