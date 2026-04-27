# 权限体系 V2 · Spec · 2026-04-22

> 范围：用户 / 团队 / 角色 / 内容 ACL（source / asset / notebook 三级）+ IAM 全套 UI
>
> 锁定方案：C（加 团队/组）+ G（source / asset / notebook ACL 全要）+ 今天只写 spec
>
> V1（本次目标，~3-4 天）→ V1.5（细化）→ V2（高级）三段，下面会标清

---

## 一、目标 & 非目标

### V1 目标

1. **新增"团队"概念**：admin 可以建团队、加成员、给团队赋权
2. **三级 ACL**：source / asset / notebook 都可以独立配置"谁能读、谁能写"
3. **Subject 多元化**：role、user（按邮箱）、team（按团队 id）三种 subject 都能授权
4. **完整 IAM UI**：用户 CRUD / 团队 CRUD / 各级权限的可视化配置面板
5. **向后兼容**：现有 admin / editor / viewer 角色仍生效；现有 ACL 规则不动；老 API 路径不变

### V1 非目标（推到 V1.5+）

- ❌ 自定义角色（自由勾选 permission 组成新角色）
- ❌ 临时授权（grant 自动过期）
- ❌ 字段级 ACL（"这个 chunk 的某些列脱敏"）
- ❌ 审批流（"申请 → 经理批 → 生效"）
- ❌ 跨租户隔离（这是 Roadmap-3 多租户的事，不在 V2 范围）

---

## 二、概念模型

```
                ┌─────────────────────────────┐
                │    Subject（主体，谁）       │
                └───┬──────────┬──────────┬───┘
                    │          │          │
                  Role       User       Team
                  (admin/      (邮箱)    (新增)
                   editor/                  ↑
                   viewer)             User 加入
                                       Team

                ┌─────────────────────────────┐
                │    Action（行为，做什么）    │
                └───┬──────────┬──────────┬───┘
                    │          │          │
                  READ        WRITE      ADMIN

                ┌─────────────────────────────┐
                │    Resource（客体，对什么） │
                └───┬──────────┬──────────┬───┘
                    │          │          │
                Source       Asset      Notebook
              (metadata_  (metadata_   (notebook
                source)     asset)         表)
```

**核心规则**：「Subject 对 Resource 有 Action」 → 一条 ACL 规则。

**继承关系（重要）**：
- Source 上的权限**自动覆盖该 source 下所有 asset**（就像目录权限管文件）
- Asset 上的权限可以**精确覆盖**同名继承（让 asset 比 source 更宽或更严）
- Notebook 完全独立，不继承 source/asset；按 notebook_member 单独算

**优先级**：deny > 显式 allow > 继承 allow > 默认 deny

---

## 三、Schema 变更

### 3.1 新建：team / team_member

```sql
CREATE TABLE team (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  created_by  VARCHAR(255),                      -- 创建者 email
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_team_name ON team(name);

CREATE TABLE team_member (
  team_id     INT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_email  VARCHAR(255) NOT NULL,
  role        VARCHAR(16)  NOT NULL DEFAULT 'member',  -- 'owner' / 'member'
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by    VARCHAR(255),
  PRIMARY KEY (team_id, user_email)
);
CREATE INDEX idx_team_member_user ON team_member(user_email);
```

### 3.2 改造：metadata_acl_rule 加 subject_type/subject_id

现有列：`source_id / asset_id / role / permission / condition`

新增：
```sql
ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS subject_type VARCHAR(16);
ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS subject_id   VARCHAR(255);
ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS effect       VARCHAR(8) DEFAULT 'allow';  -- 'allow' / 'deny'
ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;                 -- V2 用，V1 默认 NULL = 永久

-- 旧数据兼容：role 列非空时，自动当作 subject_type='role', subject_id=role
UPDATE metadata_acl_rule
SET subject_type = 'role', subject_id = role
WHERE subject_type IS NULL AND role IS NOT NULL;

-- 数据校验约束（subject 三元组完整性）
ALTER TABLE metadata_acl_rule ADD CONSTRAINT chk_subject_complete
  CHECK (
    (subject_type IS NULL AND subject_id IS NULL)        -- 旧数据兼容期
    OR (subject_type IN ('role', 'user', 'team') AND subject_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_acl_subject ON metadata_acl_rule(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_acl_source ON metadata_acl_rule(source_id);
CREATE INDEX IF NOT EXISTS idx_acl_asset ON metadata_acl_rule(asset_id);
```

### 3.3 新建：notebook_member（笔记本共享）

```sql
CREATE TABLE notebook_member (
  notebook_id   INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
  subject_type  VARCHAR(16)  NOT NULL,            -- 'user' / 'team'
  subject_id    VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'reader',  -- 'reader' / 'editor'
  added_by      VARCHAR(255),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notebook_id, subject_type, subject_id)
);
CREATE INDEX idx_notebook_member_subject ON notebook_member(subject_type, subject_id);
```

### 3.4 用户表沿用现状

`users` 表不动：`email / password_hash / roles`。Team 关联通过 `team_member.user_email`。

---

## 四、Authorization 引擎

### 4.1 Principal 扩展

`requireAuth()` 解 token 后，构造 principal 时**额外查 team 列表**：

```ts
interface Principal {
  user_id: number
  email: string
  roles: string[]
  permissions: string[]
  team_ids: number[]      // 新增：从 team_member 查
  team_names: string[]    // 新增：便于审计日志
}
```

性能：team 列表 cache 进 token claims，登录时算一次；token 刷新时重算。或者每请求查一次 team_member（小数据量下毫秒级，简单）。

V1 用每请求查的方案，V1.5 看性能再缓存。

### 4.2 ACL 评估算法

`evaluateAcl(principal, action, resource)` 改造：

```pseudo
1. 收集所有匹配规则：
   match = rules WHERE
     resource_match(rule, resource)              # source_id / asset_id 命中
     AND subject_match(rule, principal)          # subject 命中
     AND action_match(rule.permission, action)   # READ / WRITE / ADMIN
     AND (expires_at IS NULL OR expires_at > NOW())

2. 如果存在 deny 规则 → deny（最高优先）

3. 如果存在 allow 规则 → allow

4. 如果资源是 asset 且没匹配规则 → 递归往上看 source 的规则（继承）

5. 都没有 → deny by default

subject_match 三种情况:
  - rule.subject_type='role'  AND rule.subject_id IN principal.roles
  - rule.subject_type='user'  AND rule.subject_id == principal.email
  - rule.subject_type='team'  AND rule.subject_id IN principal.team_ids（数字转字符串比较）
```

### 4.3 Notebook 鉴权（独立）

不走 evaluateAcl。`loadOwnedNotebook()` 改名为 `loadAccessibleNotebook(req, id, requireWrite=false)`：

```pseudo
load notebook
if principal.email == notebook.owner_email → allow（owner 全权）
elif notebook_member 命中 (user / team) →
  reader → 允许 GET（读 + chat）
  editor → 允许 GET + 加 source / 触发 artifact / 删 chat
  （但删除 notebook 本身只允许 owner）
else → 403
```

---

## 五、API 端点

### 5.1 Teams（新）

| Method | Path | 守门 | 说明 |
|---|---|---|---|
| GET    | /api/iam/teams                      | requireAuth | 列我能看到的 team（admin 看全部；其它人看自己加入的） |
| POST   | /api/iam/teams                      | permission:manage | 创建 |
| GET    | /api/iam/teams/:id                  | member or admin | 详情 + members 列表 |
| PATCH  | /api/iam/teams/:id                  | permission:manage or team owner | 改名/描述 |
| DELETE | /api/iam/teams/:id                  | permission:manage | 解散 |
| POST   | /api/iam/teams/:id/members          | permission:manage or team owner | 加成员 `{user_email, role}` |
| DELETE | /api/iam/teams/:id/members/:email   | permission:manage or team owner | 踢人 |

### 5.2 Source / Asset ACL（扩现有 /api/acl）

| Method | Path | 说明 |
|---|---|---|
| GET    | /api/acl/rules?source_id=N\|asset_id=M  | 查某资源的所有规则 |
| POST   | /api/acl/rules                          | 新建规则（带 subject_type 字段） |
| PUT    | /api/acl/rules/:id                      | 改 |
| DELETE | /api/acl/rules/:id                      | 删 |
| POST   | /api/acl/rules/test                     | "用 X 用户/角色/团队 试试访问 Y 资源" → 返 allow/deny + 引用了哪些规则 |

全部要 `permission:manage`。

### 5.3 Notebook 共享（扩现有 /api/notebooks）

| Method | Path | 守门 | 说明 |
|---|---|---|---|
| GET    | /api/notebooks/:id/members              | accessible | 列共享列表 |
| POST   | /api/notebooks/:id/members              | owner | 加共享 `{subject_type, subject_id, role}` |
| PATCH  | /api/notebooks/:id/members/:type/:id    | owner | 改 reader/editor |
| DELETE | /api/notebooks/:id/members/:type/:id    | owner | 取消 |

GET /api/notebooks 的列表也要拆分：「我的」+「共享给我的」。

---

## 六、UI 设计（wireframe）

### 6.1 /iam 主页升级（4 Tab）

```
┌─ /iam ──────────────────────────────────────────────────┐
│ 用户 Tab │ 团队 Tab │ 权限规则 Tab │ 角色矩阵 Tab        │
├──────────────────────────────────────────────────────────┤
│ （当前 Tab 内容）                                        │
└──────────────────────────────────────────────────────────┘
```

### 6.2 用户 Tab（升级现有）

```
┌──────────────────────────────────────────────────────┐
│  用户列表                              [+ 新建用户]   │
├──────────────────────────────────────────────────────┤
│ 邮箱            │ 角色      │ 团队          │ 操作    │
│ admin@dscaw...  │ admin     │ 管理团队      │ 改 删   │
│ alice@...       │ editor    │ 营销组,研发组 │ 改 删   │
│ bob@...         │ viewer    │ -             │ 改 删   │
└──────────────────────────────────────────────────────┘

「+ 新建用户」弹窗:
  邮箱 *
  初始密码 * (≥ 8 chars)
  角色: ☑ admin ☑ editor ☑ viewer
  立即加入团队（多选 dropdown）
  [取消] [创建]

「改」行内编辑：
  改邮箱 / 改角色（多选）/ 改团队 / 重置密码（弹子窗）/ 删除
```

### 6.3 团队 Tab（新）

```
┌──────────────────────────────────────────────────────┐
│  团队列表                              [+ 新建团队]   │
├──────────────────────────────────────────────────────┤
│ 名称       │ 描述         │ 成员数 │ 操作            │
│ 营销组     │ Marketing... │ 12     │ 详情 删除       │
│ 研发组     │ R&D...       │ 8      │ 详情 删除       │
└──────────────────────────────────────────────────────┘

「详情」（右抽屉或新页）:
  团队名: 营销组
  描述: ...
  成员（12）：
    + 添加成员 ▾
    │ alice@... (member)        [改 owner] [移除]
    │ bob@...   (owner)         [改 member] [移除]
    └ ...
  授予的权限（只读，连接到「权限规则」Tab 用 team_id 过滤）：
    READ on source「研发文库」
    WRITE on asset「设计 spec.pdf」
    READER on notebook「Q4 复盘」
```

### 6.4 权限规则 Tab（升级 RulesTab）

```
┌────────────────────────────────────────────────────────┐
│ 权限规则                       [+ 新建规则]            │
│ 筛选：[资源类型 ▾][主体类型 ▾][搜索资源名...]         │
├────────────────────────────────────────────────────────┤
│ 主体             │ 资源              │ 权限   │ 效力 │ │
│ team:营销组      │ source:研发文库   │ READ   │ allow│ │
│ user:bob@...     │ asset:spec.pdf    │ WRITE  │ allow│ │
│ role:viewer      │ source:* (全局)   │ READ   │ allow│ │
│ user:trial@...   │ source:机密源     │ READ   │ deny │ │
└────────────────────────────────────────────────────────┘

「+ 新建规则」弹窗:
  授权给:    ○ 角色 ○ 用户 ○ 团队        [选择... ▾]
  允许动作:  ☑ READ ☑ WRITE ☐ ADMIN
  作用资源:  ○ 全局 ○ 数据源 ○ 单个文档    [选择... ▾]
  效力:      ○ 允许 ○ 拒绝
  [取消] [创建]
```

### 6.5 /spaces 加 「权限」入口

进入某个 source 的列表页（已有），右上加按钮「🛡 权限」→ 弹抽屉显示该 source 的所有规则 + 「+ 新建」直接预填 source_id。

### 6.6 /assets/:id 加「权限」Tab

资产详情页加 Tab：基本信息 / chunks 预览 / **权限**（新）。权限 Tab 同上，预填 asset_id。

### 6.7 /notebooks/:id 加「共享」按钮

notebook 详情页右上加 [🔗 共享]，弹窗：

```
┌──────────────────────────────────────┐
│ 共享 notebook「Q4 复盘」              │
├──────────────────────────────────────┤
│ 添加用户/团队:                        │
│ [搜索用户邮箱 / 团队名 ▾]  [Reader▾] [+]│
├──────────────────────────────────────┤
│ 已共享：                              │
│ 👤 alice@...    Reader   [改][移除]  │
│ 👥 营销组       Editor   [改][移除]  │
└──────────────────────────────────────┘
```

---

## 七、迁移计划

### 7.1 Schema migration

`pgDb.ts ensureSchema()` 加：
- 建 team / team_member 表（IF NOT EXISTS）
- ALTER metadata_acl_rule 加 subject_type / subject_id / effect / expires_at
- 一次性 UPDATE：旧数据 backfill subject_type='role', subject_id=role
- 建 notebook_member 表

### 7.2 现有 ACL 规则兼容

启动时跑一次 backfill SQL（idempotent）。之后老规则查询路径继续工作（subject_type='role' 自动匹配 principal.roles）。

### 7.3 Auth middleware 兼容

`requireAuth()` 加 team_ids 字段：旧 token 没有 team claims → 当场查 team_member → 注入 principal。后续 token 重发会带上 team claims。

---

## 八、分期实施

### V1（本周，~3-4 天）

#### Day 1：Schema + 引擎
- pgDb migrations
- evaluateAcl 改造（subject_match + 继承）
- requireAuth 拉 team_ids
- 测试: `verify-permissions.mjs` 加 team 用例

#### Day 2：Teams API + UI
- routes/teams.ts CRUD + members
- /iam 加 团队 Tab + 弹窗

#### Day 3：源/资产 ACL UI
- /spaces 加权限抽屉
- /assets 加权限 Tab
- /iam 权限规则 Tab 升级（subject_type 选择器）

#### Day 4：Notebook 共享
- routes/notebooks.ts 加 members 端点
- /notebooks 列表分「我的」+「共享给我的」
- /notebooks/:id 加共享按钮

### V1.5（下周，~2 天）

- 用户 CRUD UI 完整化（新建/改/删/重置密码）
- 角色矩阵 Tab 升级（自定义角色 stub）
- 权限"试一下"端点 + UI（rules/test）
- 团队作为 notebook member 时的列表显示

### V2（按需）

- 自定义角色（custom_role 表）
- 临时授权（expires_at + 倒计时 UI）
- 字段级 ACL
- 审批流

---

## 九、3 个示例场景验证设计

### 场景 1：番外包只读个别资产

> "找 trial 用户能看 spec-A.pdf，看不见其它东西"

1. /iam 创建 user `trial@...`，角色 `viewer`
2. 默认 viewer 全局有 READ → 看得到所有 source / asset
3. 加一条规则：subject=`role:viewer` resource=`source:*` effect=`deny` —— 但这会拒绝所有 viewer，太广
4. 改方案：viewer 角色不给任何全局 READ；trial 用户单独加规则 subject=`user:trial@...` resource=`asset:spec-A.pdf` action=READ allow

→ **设计要求**：默认规则要拆细。可能需要再加一条全局规则 `subject=role:editor effect=allow READ on source:*` + viewer 默认无全局 READ。这意味着**初始 seed 规则要重新设计**。

### 场景 2：部门只读整个空间

> "营销组的人都能读「营销文库」source，但不能读「研发文库」"

1. /iam 创建 team `营销组`，加成员
2. 创建 source `营销文库`
3. /iam 加规则：subject=`team:营销组` resource=`source:营销文库` action=READ allow
4. ✅ 营销组成员 RAG 检索/查看时只命中该 source 内容

### 场景 3：个人分享 notebook

> "我建了个调研 notebook，给同事 bob 一起编辑"

1. /notebooks/:id 点「共享」
2. 添加 `user:bob@...` role=`editor`
3. ✅ bob 在 /notebooks 列表的「共享给我的」里看到，能加 source / chat / 触发 artifact，不能删除 notebook 本身

---

## 十、未解 / 需要 product 决策

### Q1：viewer 默认能看到全局吗？

现在 ensureDefaultAclRules seed 了 `role=NULL` 的全局 READ 规则，意味着所有登录用户都能 READ 所有 source。这跟"按 source 限定"的诉求矛盾。

**建议**：V1 上线时改 seed —— 默认 admin 全权限；editor / viewer **不再有全局 READ**；必须显式授权。但这是**破坏性变更**，所有原本能读的人会突然 403。

**方案 A（保守）**：保留全局 READ seed，新加的 source 默认所有人能读。要"私密"得显式加 deny 规则。
**方案 B（严格）**：去掉全局 READ seed，每个 source 必须显式授权。新建空间时 UI 强制问"谁能读"。

**我推荐 B**（更安全 + 跟 NotebookLM/Notion 等主流体验对齐），但要规划迁移：升级时给所有 source 自动加一条 `role=editor allow READ` 兼容旧行为，admin 再决定是否收紧。

### Q2：团队能嵌套吗？

V1 不嵌套（一层），简单。V2 看需求再说。

### Q3：API 调用是否走 user JWT？

V1 所有 API 都走 user JWT（包括外部脚本调用 RAG）。V2 加 service account / API Token 概念。

### Q4：审计颗粒度

现有 audit_log 已经记 login / ingest / acl_rule_create 等。V1 新增：
- team.created / team.member.added / team.member.removed
- notebook.shared / notebook.unshared
- 失败的鉴权（403）也要记，便于审计追踪谁尝试越权

---

## 十一、需要你拍板的 3 件事

1. **Q1** —— Seed 是 A（保守）还是 B（严格）？
2. **优先级** —— V1 4 个 Day 哪个最急？我推荐顺序 Day1 → 4，但如果你最痛的是「notebook 共享」，可以 Day1 → Day4 优先做
3. **角色规划** —— 现在的 admin/editor/viewer 够用吗？还是 V1 就要 2 个新角色（譬如「普通员工」「外包」）？

回完这 3 个我可以马上开 OpenSpec change `permissions-v2`，进入 4 阶段流水线（Explore → Plan → Implement → Verify）。

---

## 十二、参考文件位置

完成后会涉及：

```
apps/qa-service/src/
├─ services/pgDb.ts              schema migrations
├─ auth/evaluateAcl.ts           评估算法重写
├─ auth/requireAuth.ts           team_ids 注入
├─ routes/teams.ts               新
├─ routes/acl.ts                 改：support subject_type
├─ routes/notebooks.ts           加 members endpoints

apps/web/src/
├─ knowledge/Iam/                改 + 加 TeamsTab
├─ knowledge/Spaces/PermsDrawer  新
├─ knowledge/Assets/PermsTab     新
├─ knowledge/Notebooks/ShareModal 新
└─ api/iam.ts, acl.ts, notebooks.ts  扩端点
```
