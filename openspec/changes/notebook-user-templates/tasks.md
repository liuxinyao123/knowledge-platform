# Tasks · N-008 用户自定义模板

## B-1 Explore (✅)
- [x] `docs/superpowers/specs/notebook-user-templates/design.md`

## B-2 Lock (✅)
- [x] proposal / design / specs / tasks

## 前置依赖

- N-007 必须合并：`notebook_template` 表 + `loadTemplatesFromDb` / `getTemplateByKey` / `seedSystemTemplatesIfMissing`

## B-3 Execute（macOS 上做，前端 + 后端）

### 后端
- [ ] BE-1 加 `isUserTemplatesEnabled()` env 守卫（services/notebookTemplates.ts 或 routes 层）
- [ ] BE-2 service: `validateUserTemplateInput` / `createUserTemplate` / `updateUserTemplate` / `deleteUserTemplate`（services/notebookTemplates.ts 扩展）
- [ ] BE-3 routes: `POST /api/templates` / `PATCH /api/templates/:key` / `DELETE /api/templates/:key`（routes/notebooks.ts 或新文件）
- [ ] BE-4 单测 `notebookTemplates.test.ts` 加 UT-1..UT-14

### 前端
- [ ] FE-1 `apps/web/src/api/notebooks.ts` 加 `createUserTemplate` / `updateUserTemplate` / `deleteUserTemplate` SDK
- [ ] FE-2 `CreateTemplateModal.tsx` 表单组件（含字段约束 inline 校验）
- [ ] FE-3 `MyTemplateActions.tsx` hover 编辑/删除按钮
- [ ] FE-4 改 `apps/web/src/knowledge/Notebooks/index.tsx`：模板选择器加 `+ 创建` 按钮 + user 模板 hover actions + source 角标
- [ ] FE-5 后端 env=false 时前端隐藏入口（用 GET /api/notebooks/templates 返回的 source 字段或加新 GET /api/templates/_meta）

## B-4 Verify

- [ ] V-1 后端 vitest 全过（含 UT-1..UT-14）
- [ ] V-2 前端创建模板 → 模板选择器立即可见
- [ ] V-3 编辑模板 → 字段更新成功
- [ ] V-4 删除模板 → 选择器消失，已用模板的 notebook 仍正常
- [ ] V-5 试图编辑 system 模板（手工 cURL）→ 403
- [ ] V-6 USER_TEMPLATES_ENABLED=false 重启 → 4 个 API 404 + 前端入口消失
- [ ] V-7 tsc exit 0

## B-5 Archive

- [ ] mv specs → archive
- [ ] 更新 SESSION 加 commit ⑨
