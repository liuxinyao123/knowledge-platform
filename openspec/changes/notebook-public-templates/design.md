# Design · N-007 公共模板池

> 工作流 B-2 Lock。Explore: `docs/superpowers/specs/notebook-public-templates/design.md`

## Schema

```sql
CREATE TABLE notebook_template (
  id              SERIAL PRIMARY KEY,
  template_key    TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('system', 'community', 'user')),
  owner_user_id   INT REFERENCES "user"(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  icon            TEXT NOT NULL,
  description     TEXT NOT NULL,
  recommended_source_hint TEXT NOT NULL,
  recommended_artifact_kinds JSONB NOT NULL DEFAULT '[]',
  starter_questions JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notebook_template_source_owner ON notebook_template (source, owner_user_id);

-- Constraint check: user 模板必须有 owner，system / community 不能有 owner
ALTER TABLE notebook_template ADD CONSTRAINT chk_notebook_template_owner
  CHECK ((source = 'user' AND owner_user_id IS NOT NULL)
       OR (source IN ('system','community') AND owner_user_id IS NULL));
```

## Migration

新文件 `apps/qa-service/src/migrations/<NN>-notebook-template-table.sql`（编号取当前最大值 +1）。

## Service 接口

```ts
// services/notebookTemplates.ts (扩展, 不破坏现有 export)

// 从 DB 读所有用户可见的模板
export async function loadTemplatesFromDb(opts: {
  userId: number       // 当前请求用户
  isAdmin?: boolean    // 管理员可见所有
}): Promise<NotebookTemplateSpec[]>

// 按 key 查单个模板（含可见性校验）
export async function getTemplateByKey(opts: {
  key: string
  userId: number
  isAdmin?: boolean
}): Promise<NotebookTemplateSpec | null>

// startup auto re-seed: 缺 system 模板就插入
export async function seedSystemTemplatesIfMissing(): Promise<{ seeded: number }>

// 旧 API（保留作 type narrowing + fallback）
export const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateSpec>
export function getNotebookTemplate(id: NotebookTemplateId): NotebookTemplateSpec  // 从常量读, 不查 DB
```

## NotebookTemplateSpec 扩展

```ts
export interface NotebookTemplateSpec {
  id: string                                       // template_key（不再窄类型）
  source: 'system' | 'community' | 'user'         // ◄ 新增
  label: string
  icon: string
  desc: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}
```

`NotebookTemplateId` enum 字面量保留作 6 系统内置模板的便捷类型，但 `NotebookTemplateSpec.id` 类型放宽到 `string`。

## 可见性规则

| 场景 | SQL 条件 |
|---|---|
| 普通用户 listTemplates | `source = 'system' OR source = 'community' OR (source = 'user' AND owner_user_id = $userId)` |
| 管理员 listTemplates | 无 filter（含其他 user 的） |
| 普通用户 getByKey | 同 listTemplates 条件 |
| 创建 notebook 时校验 template_id | 同 listTemplates 条件 |

## Tests Acceptance

| ID | 场景 | 期望 |
|---|---|---|
| PT-1 | seedSystemTemplatesIfMissing: 表空 | 6 条 source=system 写入 |
| PT-2 | seedSystemTemplatesIfMissing: 已有 system | 0 写入 |
| PT-3 | loadTemplatesFromDb 普通用户 | 仅 system + 自己的 user |
| PT-4 | loadTemplatesFromDb 管理员 | 全部 |
| PT-5 | getTemplateByKey 不存在 | null |
| PT-6 | getTemplateByKey 别人的 user 模板 | null（普通用户）|
| PT-7 | DB constraint: user 模板缺 owner_user_id | INSERT 失败 |
| PT-8 | DB constraint: system 模板带 owner_user_id | INSERT 失败 |
