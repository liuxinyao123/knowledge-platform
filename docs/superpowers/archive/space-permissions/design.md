# Design — Space Permissions（空间 + 成员权限）

> 工作流 A · 阶段 2 Explore · 禁止写生产代码，只产设计草稿。
> 所有命名 / 列 / 路由在 Lock 阶段可能微调；Execute 阶段以 openspec/changes 为准。

## 1. 数据模型候选

### 候选 S-A（推荐）—— 新三表 + `metadata_acl_rule` 可空 `space_id`

```
space
  id          bigserial PK
  slug        text UNIQUE            -- 'knowledge-zhongtai'
  name        text NOT NULL          -- '知识中台'
  description text
  visibility  text NOT NULL          -- 'org' | 'private' （'public' 暂不开）
  owner_uid   bigint NOT NULL        -- 冗余 owner，避免每次联表扫 member
  created_at  timestamptz DEFAULT now()
  updated_at  timestamptz DEFAULT now()

space_member
  space_id    bigint REFERENCES space(id) ON DELETE CASCADE
  subject_type text NOT NULL         -- 'user' | 'team'  （role 在 space 内无意义，不开）
  subject_id  text NOT NULL          -- 'user@x.com' 或 team.id::text
  role        text NOT NULL          -- 'owner' | 'admin' | 'editor' | 'viewer'
  added_by    text
  added_at    timestamptz DEFAULT now()
  PRIMARY KEY (space_id, subject_type, subject_id)

space_source
  space_id    bigint REFERENCES space(id) ON DELETE CASCADE
  source_id   bigint REFERENCES metadata_source(id) ON DELETE CASCADE
  added_at    timestamptz DEFAULT now()
  PRIMARY KEY (space_id, source_id)
```

`metadata_acl_rule` 增加列：

```
ALTER TABLE metadata_acl_rule
  ADD COLUMN IF NOT EXISTS space_id bigint NULL REFERENCES space(id);
```

- `space_id IS NULL` ⇒ 老规则 / org 级规则（保持现状语义）
- `space_id = X` ⇒ 仅对空间 X 生效；与 source_id / asset_id 正交

**评估点亮：** 只改 ACL 表一列，permissions-v2 评估逻辑新增一行 `WHERE (space_id IS NULL OR space_id = $spaceOfResource)`，deny-over-allow 原则不变。

### 候选 S-B —— 把 role 展开成 space_member_role 多表

否决。`space_member.role` 是语义稳态（owner/admin/editor/viewer 四档），一行一角色；要再多角色就让 ACL 直接发 rule，没必要。

### 候选 S-C —— 复用 notebook_member 结构做 space_member

否决。Notebook 是"个人工作台"语义（session-scoped），space 是"组织内公共容器"语义；表同名会让 RAG/检索侧怀疑是否自动共享，反而更贵。

**决定：S-A 向下走。** 三个细点留 Lock 阶段：

- `space_member.subject_type` 是否再开 `role` 全局角色（如"所有 viewer"）？倾向 **否**，全局角色靠 `metadata_acl_rule` 发 space-scoped rule 实现。
- `space_source` 是否要支持一个 source 属于多空间？倾向 **是**（复合主键已允许），但首版 UI 只暴露单空间。
- `metadata_asset` 是否也要冗余 `space_id`？倾向 **否**，asset 通过 source 继承。

## 2. API 契约（草案）

> 路由挂在 `apps/qa-service/src/routes/spaces.ts`（新文件），受 `requireAuth` + `enforceAcl('space:read' / 'space:admin')` 保护。

| 方法 | 路径 | 用途 | 关键返回 |
|------|------|------|----------|
| GET    | `/api/spaces` | 列当前用户可见的空间 | `[{id, slug, name, visibility, owner, docCount, myRole}]` |
| POST   | `/api/spaces` | 新建空间（仅 org admin） | `{id, ...}` |
| GET    | `/api/spaces/:id` | 空间详情（含 owner、可见范围、docCount、myRole） | `Space` |
| PATCH  | `/api/spaces/:id` | 改名 / 可见范围 / 描述 | `Space` |
| DELETE | `/api/spaces/:id` | 删空间（仅 Owner；软删或硬删 Lock 决） | `{ok:true}` |
| GET    | `/api/spaces/:id/members` | 列成员 + 角色 + 权限摘要 | `[{subjectType, subjectId, role, perms[]}]` |
| POST   | `/api/spaces/:id/members` | 加成员（需 admin） | `Member` |
| PATCH  | `/api/spaces/:id/members/:key` | 改角色 | `Member` |
| DELETE | `/api/spaces/:id/members/:key` | 移除（Owner 不可被移除，需先转让） | `{ok:true}` |
| POST   | `/api/spaces/:id/transfer-owner` | 转让 Owner | `Space` |
| GET    | `/api/spaces/:id/sources` | 空间下 source 列表，query `?groupBy=tag\|none` | `{groups:[{name, sources:[]}]}` |
| POST   | `/api/spaces/:id/sources` | 把现有 source 纳入空间 | `{added:n}` |
| DELETE | `/api/spaces/:id/sources/:sid` | 从空间移除 source | `{ok:true}` |

### 角色 → 默认权限映射（seed）

放 `apps/qa-service/src/services/governance/spaceRoleSeed.ts`（新建），格式与 `ROLE_TO_PERMS` 一致：

```ts
export const SPACE_ROLE_DEFAULT_RULES = {
  owner:  [{ effect: 'allow', permission: 'ADMIN' }],
  admin:  [{ effect: 'allow', permission: 'ADMIN', permission_required: 'space.admin' }],
  editor: [{ effect: 'allow', permission: 'WRITE' }, { effect: 'allow', permission: 'READ' }],
  viewer: [{ effect: 'allow', permission: 'READ' }],
}
```

每次 `space_member` 变更 → 自动生成对应 `metadata_acl_rule` 行，`subject_type/subject_id` 来自 member，`space_id` 来自 space；删除成员时对应规则级联删。
**关键点：rule 是 member 的投影，不允许直接手改** —— 这样 UI 的"成员表"永远是真相源，`RulesTab` 只展示不让改 space-scoped 规则（显示只读 pill "由成员表生成"）。
自定义 policy 想写 space-scoped 的特殊条件（比如按字段脱敏），仍然走 `RulesTab` 发一条不关联 `space_member` 的 rule（`space_id` 有值，subject 手填）。

## 3. 前端方案

### 路由

- 保持 `/spaces`；旧"源→资产树"挪到 `/spaces/:id/tree`（点击空间卡片进入）。
- 列表页新 Layout：
  - 左：空间列表（含分组、角色标签、分组头）
  - 右主区：空间详情（信息卡 / 成员表 / 目录结构）
  - 右上固定按钮：邀请成员 / 导入知识

### 组件拆分

```
SpaceTree/index.tsx          外壳 + tabs
  ├── SpaceListPane.tsx      空间列表（左）
  ├── SpaceDetailPane.tsx    右侧主区 stack
  │    ├── SpaceInfoCard.tsx
  │    ├── SpaceMembersTable.tsx
  │    └── SpaceDirectoryList.tsx   ← 按 tag 分组展示 source
  └── SpaceSourceTreeDrawer.tsx    ← 旧 TreePane/PreviewPane 组合，弹窗访问
```

### API 模块

`apps/web/src/api/spaces.ts`（新建），导出：`listSpaces / getSpace / createSpace / updateSpace / listMembers / addMember / updateMember / removeMember / transferOwner / listSources / attachSource / detachSource`。

### 与 `Iam/RulesTab` 的交互

- `RulesTab` 在 V2 pill 上新增 `scope` 列："全局 / 空间：知识中台"；
- 允许按 `space_id` 过滤；
- 由 `space_member` 投影出来的规则，编辑/删除按钮置灰并 tooltip："由空间『知识中台』成员表管理，请前往 /spaces"。

## 4. 权限评估流程（pseudocode）

```
decision = enforceAcl(principal, action, resource):
  space_id_of_resource = resolveSpaceOf(resource)      // 新增：通过 source→space_source 解析
  candidates = metadata_acl_rule WHERE
    (space_id IS NULL OR space_id = space_id_of_resource) AND
    matches_subject(rule, principal) AND
    matches_resource(rule, resource)
  apply deny-over-allow, TTL, condition(mask/where) 同 permissions-v2
```

`resolveSpaceOf(resource)`：
- resource.space_id 已带 → 直接用
- resource.source_id → `SELECT space_id FROM space_source WHERE source_id = ?`（多空间取集合，任一空间的 allow 命中即允许）
- 若 source 不在任何空间 → 行为同 org 级，只评估 `space_id IS NULL` 的规则

## 5. 测试计划

- pgDb 迁移：新增表 / 新增列的 `IF NOT EXISTS` 用例，重复跑脚本不报错。
- policy 单测（`__tests__/acl.space.spec.ts` 新增）：
  1. space-scoped allow 对空间内 source 生效，对其他 source 不生效
  2. space-scoped deny 压过 org 级 allow
  3. source 同时属于两个空间：任一空间有 allow 即可（平权合并，但 deny 永远 wins）
  4. space_member 变更触发 rule CRUD 投影
  5. `acl_rule_audit` 记录 `actor / before / after / source='space_member'` 字段
- 前端 smoke：`/spaces` 页四块可见、成员表角色 pill 渲染、transfer owner 流程。

## 6. 风险与回退

| 风险 | 概率 | 回退 |
|------|------|------|
| `metadata_acl_rule` 加列后老 enforceAcl 路径没过滤 `space_id` → 越权 | 中 | 评估函数默认 `space_id = ANY` 维持老行为，Lock 阶段加 feature flag `PERMS_SPACE_SCOPE=off` 先发前端 |
| `space_source` 多空间归属让 UI 展示混乱 | 中 | 首版 UI 硬定 1-to-1，若 UX 确认再放开（只是后端允许） |
| 旧 `/spaces` 用户书签断链 | 低 | 新页兼容老 URL，`?legacy=1` 回退 TreePane |
| `RulesTab` 老规则看不见 space 维度 | 低 | 新增列 fallback '全局' |

## 7. 待 Lock 阶段的 Open Questions

- Q-S1：`space.visibility` 是否需要 `public`（登录即可见）？倾向 **否**，只保留 org / private。
- Q-S2：成员能否是 `subject_type=role`（"全组织 editor 都进来"）？倾向 **否**，想做整组织放行就发 org 级 rule。
- Q-S3：Owner 转让是不是本期做？倾向 **本期做**，否则删空间会被 Owner 占死。
- Q-S4：删除空间是软删还是硬删？软删的话 ACL 要不要冻结？倾向 **硬删 + 级联 ACL**（合规需求出现前不上墓碑表）。
- Q-S5：`space_audit` 要不要独立表 vs 复用 `acl_rule_audit` + `entity_type='space'`？倾向 **复用**。

## 8. 交付给 Lock 阶段的 Checklist

- [ ] Glossary 术语条目重写（`Space` = 新定义）
- [ ] 明确 `space_member` 到 `metadata_acl_rule` 的投影事务边界
- [ ] 权衡前端组件是否全部进 SpaceTree 子目录还是放 `SpacePermissions/`
- [ ] 确认 `/api/spaces/:id/sources` 分组规则（tag 来源 = source.tag or asset.tag 聚合？）
- [ ] ADR 编号：2026-04-23-25-space-permissions-design（Lock 阶段正式落）
