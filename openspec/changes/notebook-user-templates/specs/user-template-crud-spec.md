# Spec · 用户自定义模板 CRUD

## ADDED Requirements

### isUserTemplatesEnabled

```ts
export function isUserTemplatesEnabled(): boolean
```

读 `USER_TEMPLATES_ENABLED` env，默认 `true`，识别 `false / 0 / off / no`。

### createUserTemplate

签名见 design.md。行为：

- 校验 input（同 design 字段约束）
- 生成 `template_key = "user_${userId}_${nanoid(8)}"`
- INSERT 到 notebook_template (source='user', owner_user_id=userId)
- 返回完整 NotebookTemplateSpec

错误：
- input 不合规 → 抛 `ValidationError`（含 errors map）
- DB unique 冲突（极小概率 nanoid 撞）→ 重试 1 次

### updateUserTemplate

签名见 design.md。行为：

- 按 key 查模板，404 → null
- 仅 source='user' 且 (owner_user_id === userId 或 isAdmin)
- 不允许改 source / owner_user_id / template_key
- 改 updated_at = now()
- 返回 updated NotebookTemplateSpec

错误：
- 不可见 / 不可改 → 抛 `ForbiddenError`

### deleteUserTemplate

签名见 design.md。行为：

- 按 key 查，不存在 → `{deleted: false}`
- 不允许删 source='system' 或 'community'
- 仅 owner 或 admin
- DELETE → `{deleted: true}`

NOT 级联清空 notebook.template_id（dangling reference 由前端 graceful handle）

### POST /api/templates

启用时：
- 已认证（401 if not）
- env on（404 if off）
- body validate
- 调 createUserTemplate
- 201 + spec

### PATCH /api/templates/:key

- 已认证
- env on
- body validate (partial)
- 调 updateUserTemplate
- 200 + updated spec / 404 / 403

### DELETE /api/templates/:key

- 已认证
- env on
- 调 deleteUserTemplate
- 200 / 404 / 403

## Acceptance Tests

14 项 UT-1..UT-14 见 design.md tests acceptance 段。
