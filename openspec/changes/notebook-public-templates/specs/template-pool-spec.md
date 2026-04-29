# Spec · notebook_template 表 + service API

## ADDED Requirements

### DB 表 notebook_template

参见 design.md SQL。约束：

- `template_key` UNIQUE
- `source` CHECK ∈ ('system', 'community', 'user')
- 复合 CHECK：user 模板必须有 owner_user_id；system / community 不能有

### loadTemplatesFromDb

```ts
export async function loadTemplatesFromDb(opts: {
  userId: number
  isAdmin?: boolean
}): Promise<NotebookTemplateSpec[]>
```

返回当前用户可见的所有模板：
- `source = 'system'` 或 `'community'`：所有用户可见
- `source = 'user'`：仅 owner_user_id = userId 可见
- `isAdmin = true`：可见所有

按 `created_at DESC, id DESC` 排序。

### getTemplateByKey

```ts
export async function getTemplateByKey(opts: {
  key: string
  userId: number
  isAdmin?: boolean
}): Promise<NotebookTemplateSpec | null>
```

按 `template_key` 查，应用相同可见性规则。不存在 / 不可见 → `null`。

### seedSystemTemplatesIfMissing

```ts
export async function seedSystemTemplatesIfMissing(): Promise<{ seeded: number }>
```

扫描 DB `source='system'` 模板的 template_key 集合，对比 `NOTEBOOK_TEMPLATES` 常量，把缺的写入 DB。

幂等：调多次只插入缺的。startup 时调用。

## MODIFIED Requirements

### NotebookTemplateSpec（schema）

```ts
export interface NotebookTemplateSpec {
  id: string
  source: 'system' | 'community' | 'user'   // ADDED
  label: string
  icon: string
  desc: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}
```

`id` 字段类型从 `NotebookTemplateId` (字面量 union) widening 到 `string`.

### routes/notebooks.ts

- `GET /api/notebooks/templates` 改异步：`loadTemplatesFromDb({ userId: req.user.id, isAdmin: req.user.is_admin })`
- `POST /api/notebooks` template_id 校验：`getTemplateByKey({ key, userId, isAdmin })`. null → 400 with `invalid template_id`

## Acceptance Tests

8 个测试 ID 见 design.md PT-1..PT-8.
