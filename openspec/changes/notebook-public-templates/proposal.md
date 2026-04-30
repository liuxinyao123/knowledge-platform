# Proposal · N-007 公共模板池

## What

把 N-006 硬编码的 6 个内置模板从 `notebookTemplates.ts` 常量迁到 DB 表 `notebook_template`，加 `source` 字段（`system / community / user`），为 N-008 用户自定义模板和未来 community 模板提供存储基座。

## Why

N-006 模板内容硬编码——每改字段要发 release，无法支持用户自定义或社区共享。N-008 需要 user CRUD，必须先有 schema 基座。

## What changes

1. **新增** DB migration `notebook_template` 表 + index
2. **新增 seed**：6 个 system 模板写入 DB（startup auto re-seed if missing）
3. **修改** `services/notebookTemplates.ts`：
   - 保留 `NOTEBOOK_TEMPLATES` 常量作 fallback / seed 数据源
   - 新增 `loadTemplatesFromDb(opts)` / `getTemplateByKey(key)` async API
   - 旧 `getNotebookTemplate(id)` deprecate（仍用作 type narrowing）
4. **修改** `routes/notebooks.ts`：
   - `GET /templates` 改异步从 DB 读 + 返回 `source` 字段
   - `POST /notebooks` 校验 `template_id` 改用 DB 存在性 + 用户可见性
5. **修改** 前端 `apps/web/src/api/notebooks.ts`：
   - `NotebookTemplateSpec` 加 `source: 'system' | 'community' | 'user'`
   - `NotebookTemplateId` 从 enum 字面量类型 widening 到 `string`（审查依赖代码）
6. **修改** `apps/web/src/knowledge/Notebooks/index.tsx` 模板选择器——可选展示 source 徽章（v1 仅 system，可省略 UI）

## Out of scope

- community 提交/审核/发布流程（推迟到 N-007.5+）
- 用户自定义模板 CRUD（N-008 范围）
- 模板版本历史
- 模板标签 / 评分

## Acceptance

1. DB migration apply 后 `notebook_template` 表存在 + 6 system 模板
2. `GET /api/notebooks/templates` 返回 6 个模板 + `source: 'system'`
3. `POST /api/notebooks { template_id: 'research_review' }` 创建成功
4. 一个不存在的 `template_id` (e.g. 'foo_bar') → 400 with clear error
5. vitest `notebookTemplates.test.ts` 全过（含 DB mock 测）
6. 前端模板选择器无可见变化 + 类型 widening 不破坏现有代码
7. tsc exit 0
