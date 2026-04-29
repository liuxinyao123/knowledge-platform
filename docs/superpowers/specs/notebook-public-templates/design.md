# Explore · N-007 公共模板池

> 工作流：B `superpowers-openspec-execution-workflow` · 阶段 Explore
> 上游：N-006 已落地（6 个内置 NotebookTemplate 硬编码在 `notebookTemplates.ts`）
> 下游：N-008 用户自定义模板（schema 复用本特性）

---

## 现状（N-006 落地后）

```
apps/qa-service/src/services/notebookTemplates.ts
└── const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateSpec>
    └── 6 个硬编码模板（research_review / meeting_prep / ...）

apps/qa-service/src/routes/notebooks.ts
└── GET /templates → 返回硬编码常量
└── POST /notebooks 接受 template_id（验是否 ∈ ALL_NOTEBOOK_TEMPLATE_IDS）

apps/web/src/api/notebooks.ts
└── 前端独立维护一份 ALL_NOTEBOOK_TEMPLATE_IDS（与后端同步）

DB: notebook 表的 template_id 是 string 字段（约束在 service 层）
```

**问题**：
1. 模板内容**与代码强耦合**——每改一个模板都要发 release
2. **没有 source 概念**——无法区分"系统内置"vs"用户自定义"vs"社区共享"
3. **无法跨空间共享**——模板不属于空间，但也没有"公开池"机制

---

## 目标（N-007）

1. 模板从代码常量 → DB 表（仍可保留代码 seed）
2. 加 `source: 'system' | 'community' | 'user'` 区分来源
3. 跨空间可见性：所有 space 用户都能看见 system + community 模板
4. **不在范围**（推迟到 N-007.5+）：community 提交/审核/发布流程；管理员审核 UI

---

## DB 表设计

```sql
CREATE TABLE notebook_template (
  id              SERIAL PRIMARY KEY,
  -- 业务标识（系统内置用 'research_review' 等保留 ID；用户自定义用自动生成 UUID 子串）
  template_key    TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('system', 'community', 'user')),
  -- user 模板必须有 owner_user_id；system / community 是 NULL
  owner_user_id   INT REFERENCES "user"(id) ON DELETE CASCADE,
  -- 模板字段（与现有 NotebookTemplateSpec 对齐）
  label           TEXT NOT NULL,                              -- ≤ 10 字
  icon            TEXT NOT NULL,                              -- emoji
  description     TEXT NOT NULL,                              -- ≤ 60 字
  recommended_source_hint TEXT NOT NULL,                      -- ≤ 40 字
  recommended_artifact_kinds JSONB NOT NULL DEFAULT '[]',     -- ArtifactKind[]
  starter_questions JSONB NOT NULL DEFAULT '[]',              -- string[]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notebook_template_source_owner ON notebook_template (source, owner_user_id);
```

**关键决策**：

- `template_key` 替代旧 `NotebookTemplateId` enum——支持任意字符串（user 模板需要）；系统内置仍用 `research_review` 等保留字符串作 key
- `notebook.template_id` 字段类型不变（仍是 string）；但语义改成"指向 notebook_template.template_key"
- 不加外键约束（`notebook.template_id → notebook_template.template_key`）—— 模板可能被删但 notebook 可能继续存在；service 层校验

## 可见性规则（v1，N-007 范围）

| 用户视角 | 可见模板 |
|---|---|
| 任何登录用户 | source='system'（始终可见）+ source='community'（v1 暂无）|
| 用户自己 | + source='user' AND owner_user_id = me（N-008 范围）|
| 管理员 | 全部（包括其他 user 的）|

**v1 简化**：community 暂时无内容（DB 允许，但没 UI 提交流程）。N-007 主要做 schema + 把 system 模板从代码迁到 DB。

---

## 迁移策略

### Phase 1（本特性范围）：Schema + 数据迁移 + service 改造

1. DB migration：创建 `notebook_template` 表 + 索引
2. seed 6 个内置模板 source='system'
3. `services/notebookTemplates.ts` 改造：
   - 保留 `NotebookTemplateSpec` 类型 + `NOTEBOOK_TEMPLATES` 常量（作 fallback / startup seed）
   - 新加 `loadTemplates()` 从 DB 读
   - 新加 `getTemplateByKey(key)`（DB 查询）
   - 旧 `getNotebookTemplate(id)` deprecated, 内部转用新接口
4. `routes/notebooks.ts` `GET /templates` 改用 `loadTemplates()` 返回 `{templates, source}` 包含 source 字段
5. `routes/notebooks.ts` `POST /notebooks` 校验 template_id 改用 `getTemplateByKey()` 而不是 `isNotebookTemplateId()`
6. 前端 `NotebookTemplateSpec` 加 `source` 字段；模板选择器可选展示来源徽章（v1 仅 system，所以可不展示）

### Phase 2（N-007.5 / 后续）：community 提交/审核流程

- 管理员审核 UI
- user → community 模板 promote 流程
- 不在 N-007 范围

---

## 决策记录

### D-1 · 保留代码 `NOTEBOOK_TEMPLATES` 常量作 startup seed

理由：

- 部署到新环境时不需手工跑 SQL 插入 6 个模板
- DB 启动 sanity check：如果 `notebook_template` 表里没有 system 模板，自动从代码 seed 一份
- 代码常量不再是"运行时数据源"，仅作 backup 和 init seed

### D-2 · `template_key` 字符串而非数字 ID 作业务标识

理由：

- 系统内置模板用人类可读 key（research_review）便于代码引用 + log 阅读
- user 模板生成 nanoid/uuid 短 key
- 数字 ID 仅作 PK，业务用 key

### D-3 · 不加 `notebook.template_id → notebook_template.template_key` 外键

理由：

- 模板可能被删（user 删自己的），但 notebook 应继续存在（template_id 字段保留为 dangling reference）
- service 层 LIMITED 校验：创建 notebook 时校验 key 存在 + 用户能看到；之后 notebook.template_id 变成 historical reference

### D-4 · 前端 `NotebookTemplateSpec` 加可选 `source` 字段

```ts
export interface NotebookTemplateSpec {
  id: string                               // template_key (从 NotebookTemplateId enum → string)
  source: 'system' | 'community' | 'user'  // N-007 新增
  label: string
  ...其它不变
}
```

`id: NotebookTemplateId` 类型 widening 到 `string`——前端代码可能依赖 enum 收窄，需要审查。审查后可能需要把 enum 类型 deprecate.

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| DB migration 失败影响生产 | migration 是 additive (CREATE TABLE)，旧 notebookTemplates.ts 保留可回滚 |
| seed 6 模板被错误删除 | startup sanity check：缺则自动 re-seed (D-1) |
| 前端 enum widening 影响其它代码 | typescript 编译捕获；执行时仔细 grep "NotebookTemplateId" |
| 跨用户模板信息泄露 | service 层强制按 user_id filter；管理员是显式 role check |
| community 模板 v1 没内容用户失望 | UI 展示"这里将显示社区共享模板"占位文案 |

**回滚**：drop `notebook_template` 表 + revert service 改造 → 退回硬编码常量。

---

## 不在范围

- community 提交流程（user → community promote）
- 模板审核 / 评分 / 标签
- 模板版本历史
- 用户自定义模板 CRUD（N-008 范围）

---

## Acceptance

1. DB 有 `notebook_template` 表 + 6 system 模板
2. `GET /api/notebooks/templates` 返回与原行为一致 + 加 source 字段
3. `POST /api/notebooks` 接受任意 template_key（不再仅限 6 个 enum）
4. 创建 notebook 后 template_id 保留指向 template_key
5. vitest `notebookTemplates.test.ts` 全过 + 新增 DB 路径测试
6. 前端模板选择器照旧工作（无可见变化）

---

## 工作量估算

| 阶段 | 时间 |
|---|---|
| Lock OpenSpec | 15 min |
| DB migration + seed | 15 min |
| service 改造 | 30 min |
| 单测改造 | 20 min |
| 前端类型 widening | 10 min |
| Verify | 15 min |
| **合计** | **~1.7 小时** |
