# Design · N-008 用户自定义模板

## API contract

### POST /api/templates

Body:
```ts
{
  label: string            // 1..10 chars
  icon: string             // 1..2 chars (emoji)
  description: string      // 1..60 chars
  recommendedSourceHint: string  // 1..40 chars
  recommendedArtifactKinds: ArtifactKind[]  // 0..3, each ∈ ARTIFACT_REGISTRY
  starterQuestions: string[]  // 1..3, each 1..50 chars
}
```

后端处理：
1. validate body 字段 → 400 with errors
2. require auth → 401
3. `template_key = "user_" + req.user.id + "_" + nanoid(8)`
4. INSERT INTO notebook_template (source='user', owner_user_id=req.user.id, ...)
5. Return 201 + full NotebookTemplateSpec

### PATCH /api/templates/:key

Body: 同 POST 但所有字段都可选（部分更新）。

后端：
1. lookup template by key → 404
2. require owner OR admin → 403
3. forbid 改 source / template_key / owner_user_id
4. validate provided fields
5. UPDATE → 200 + updated spec

### DELETE /api/templates/:key

后端：
1. lookup template by key → 404
2. require owner OR admin → 403
3. forbid 删 source='system' / 'community' → 403
4. DELETE FROM notebook_template WHERE template_key=$1 → 200

### env 守卫

`USER_TEMPLATES_ENABLED` 默认 true。false 时：
- 4 个新 endpoint 返 404 (express middleware)
- 前端 `+ 创建我的模板` 按钮隐藏 + user 模板的 hover actions 不显示

## Service 接口

```ts
// services/notebookTemplates.ts (扩展)

export interface CreateUserTemplateInput {
  label: string; icon: string; description: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}

export async function createUserTemplate(
  userId: number, input: CreateUserTemplateInput,
): Promise<NotebookTemplateSpec>

export async function updateUserTemplate(opts: {
  key: string; userId: number; isAdmin: boolean
  patch: Partial<CreateUserTemplateInput>
}): Promise<NotebookTemplateSpec | null>

export async function deleteUserTemplate(opts: {
  key: string; userId: number; isAdmin: boolean
}): Promise<{ deleted: boolean; reason?: string }>

// validation helper（前后端共用 schema）
export function validateUserTemplateInput(input: unknown):
  | { ok: true; data: CreateUserTemplateInput }
  | { ok: false; errors: Record<string, string> }
```

## 前端

### CreateTemplateModal.tsx

Tailwind + Radix `Dialog`. 表单字段同 API body. 提交：

```ts
await createUserTemplate(input)
toast.success('模板已创建')
onCreated(spec)   // 调用方 setSelectedTemplate(spec.id)
```

### NotebookSelector 改造

```tsx
{/* 模板列表 */}
{templates.map(t => (
  <TemplateCard
    key={t.id}
    template={t}
    sourceLabel={t.source === 'user' ? '我的' : t.source === 'community' ? '社区' : null}
    actions={t.source === 'user' && t.owner_user_id === currentUser.id ? (
      <MyTemplateActions template={t} onUpdate={...} onDelete={...} />
    ) : null}
  />
))}

{userTemplatesEnabled && (
  <button onClick={openCreateTemplateModal}>+ 创建我的模板</button>
)}
```

## Tests Acceptance

| ID | 场景 | 期望 |
|---|---|---|
| UT-1 | POST /api/templates 合法 body | 201 + spec |
| UT-2 | POST 字段超长/缺失 | 400 + errors |
| UT-3 | POST 未登录 | 401 |
| UT-4 | POST 未启用 env | 404 |
| UT-5 | PATCH 自己的 user 模板 | 200 + updated |
| UT-6 | PATCH 别人的 user 模板（普通用户）| 403 |
| UT-7 | PATCH system 模板 | 403 |
| UT-8 | PATCH 改 source / owner_user_id | 400/403 |
| UT-9 | DELETE 自己的 user 模板 | 200 |
| UT-10 | DELETE system 模板 | 403 |
| UT-11 | DELETE 别人模板（管理员）| 200 |
| UT-12 | template_key 自动生成 user_<userId>_<nanoid> | 长度合理且唯一 |
| UT-13 | recommendedArtifactKinds 含未注册 kind | 400 |
| UT-14 | starterQuestions 0 条 / 4 条 | 400 |
