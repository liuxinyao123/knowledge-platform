# Proposal · N-008 用户自定义模板

## What

在 N-007 公共模板池基础上加用户自定义模板 CRUD：用户可以创建、编辑、删除自己的 NotebookTemplate（label / icon / description / recommendedSourceHint / starterQuestions / recommendedArtifactKinds），存入 `notebook_template` 表 `source='user'`。仅自己可见（v1 不做 community 共享）。

## Why

让 user 把高频复用的 chat 提问 + artifact 套件凝结成可复用模板；用户驱动的 ground-truth 模板是后续 community 共享（N-009）的种子。

## What changes

1. **新增** API 4 个：
   - `POST   /api/templates`（user 创建）
   - `GET    /api/templates/:key`（含可见性校验，N-007 已暴露 list，仅补 detail）
   - `PATCH  /api/templates/:key`（仅 owner / admin）
   - `DELETE /api/templates/:key`（仅 owner / admin）

2. **新增** service：`createUserTemplate(userId, body)` / `updateUserTemplate(key, userId, isAdmin, body)` / `deleteUserTemplate(key, userId, isAdmin)`

3. **新增** 前端 components：
   - `apps/web/src/knowledge/Notebooks/CreateTemplateModal.tsx`（表单 modal）
   - `apps/web/src/knowledge/Notebooks/MyTemplateActions.tsx`（hover 时的编辑/删除按钮）

4. **修改** 前端 `NotebookSelector` (在 `index.tsx` 内)：
   - 加 `+ 创建我的模板` 按钮
   - user 模板项 hover 显示 [编辑] [删除]
   - source=user 加 `我的` 角标

5. **新增** env `USER_TEMPLATES_ENABLED`（默认 `true`）—— 关闭时 4 个新 API 返 404 + 前端隐藏入口

## Out of scope

- community 共享流程（user 模板 → community 提交 / 审核 / 发布）→ N-009
- 模板版本历史 / 模板克隆
- 跨用户分享单个模板（点对点）

## Acceptance

1. POST 创建模板成功 → list 立即可见
2. PATCH 编辑模板字段成功
3. DELETE 删除自己模板成功 → 已用该模板的 notebook 仍能正常打开（dangling reference）
4. 试图编辑 system 模板 → 403
5. 试图编辑别人的 user 模板 → 普通用户 403 / 管理员 200
6. 字段约束（label ≤ 10 / desc ≤ 60 / starterQuestions 1-3 条 ≤ 50 字 / artifactKinds 0-3 个 ∈ ARTIFACT_REGISTRY）服务端拒绝违规
7. env=false 重启 → 4 个 API 返 404 + 前端 UI 入口消失
8. vitest 全过 + tsc exit 0
