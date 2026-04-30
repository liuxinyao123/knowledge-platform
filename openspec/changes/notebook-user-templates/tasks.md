# Tasks · N-008 用户自定义模板

## B-1 Explore (✅)
- [x] `docs/superpowers/specs/notebook-user-templates/design.md`

## B-2 Lock (✅)
- [x] proposal / design / specs / tasks

## 前置依赖

- N-007 必须合并：`notebook_template` 表 + `loadTemplatesFromDb` / `getTemplateByKey` / `seedSystemTemplatesIfMissing`

## B-3 Execute（macOS 上做，前端 + 后端）✅ 2026-04-30

### 后端
- [x] BE-1 加 `isUserTemplatesEnabled()` env 守卫（services/notebookTemplates.ts，识别 false/0/off/no）
- [x] BE-2 service: `validateUserTemplateInput` / `createUserTemplate` / `updateUserTemplate` / `deleteUserTemplate`（services/notebookTemplates.ts 扩展，含 unique 重试 + dangling reference 不级联）
- [x] BE-3 routes: 新文件 `routes/templates.ts` 含 `GET /_meta`（暴露 enabled flag）+ `POST /` + `PATCH /:key` + `DELETE /:key`，env 守卫 middleware；mount 到 `/api/templates`
- [x] BE-4 单测 `notebookTemplates.test.ts` 加 UT-1..UT-14（含 env 守卫、validate 9 case、CRUD 13 case，共 28 case）

### 前端
- [x] FE-1 `apps/web/src/api/notebooks.ts` 加 `getUserTemplatesMeta` / `createUserTemplate` / `updateUserTemplate` / `deleteUserTemplate` SDK + `CreateUserTemplateInput` 类型
- [x] FE-2 `CreateTemplateModal.tsx` 表单组件（同时支持 create / edit；inline 字段校验；ArtifactKind 多选 chip；起手问题动态 1-3 行；服务端 errors 解析展示）
- [x] FE-3 `MyTemplateActions.tsx` hover 时浮现 ✎ / × 按钮，二级 confirm 删除
- [x] FE-4 改 `apps/web/src/knowledge/Notebooks/index.tsx` CreateNotebookModal：加 `+ 创建我的模板` 按钮（仅 enabled 时）+ user 模板 hover MyTemplateActions + source 角标（"我的"/"社区"）
- [x] FE-5 用新 `GET /api/templates/_meta` 探 enabled flag；关闭时前端隐藏 `+ 创建` 入口 + 隐藏 actions（两层防御）

## B-4 Verify ✅ 2026-04-30

- [x] V-1 后端 vitest 124/124（notebookTemplates 58 含 UT-1..UT-14 + accessibility 15 + answerIntent 51）
- [~] V-2 前端创建模板 → 模板选择器立即可见（reloadTemplates after onSaved + setPickedTemplate(spec.id) 自动选中；待 macOS 真机点一遍）
- [~] V-3 编辑模板 → 字段更新成功（同 V-2）
- [~] V-4 删除模板 → 选择器消失（reloadTemplates after delete）+ 已用模板的 notebook 仍正常（dangling reference 由 listTemplates 不返此 key 实现 graceful，TemplateHintCard 读不到 spec 自动 hide）
- [~] V-5 试图编辑 system 模板（手工 cURL）→ 后端 service `system_or_community_immutable` → 403（UT-7 / UT-10 单测覆盖）
- [~] V-6 USER_TEMPLATES_ENABLED=false 重启 → 4 个 mutating API 404 + `/_meta` 仍可访 + 前端入口消失（middleware + 前端 enabled flag 双层）
- [x] V-7 tsc qa-service / web 双向 exit 0

V-2..V-6 后端 / 数据契约层已 unit test 覆盖；UI 真机交互 V-2..V-4 + env=false 跑路验证 V-6 待 macOS 跑。

## B-5 Archive ✅ 2026-04-30

- [x] mv `docs/superpowers/specs/notebook-user-templates` → `docs/superpowers/archive/notebook-user-templates`
- [x] 更新 SESSION 加 commit ⑭ N-008 Execute
