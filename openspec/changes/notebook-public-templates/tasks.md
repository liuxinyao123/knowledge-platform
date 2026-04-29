# Tasks · N-007 公共模板池

## B-1 Explore (✅)
- [x] `docs/superpowers/specs/notebook-public-templates/design.md`

## B-2 Lock (✅)
- [x] proposal / design / specs / tasks

## B-3 Execute（macOS 上做，涉及 DB migration）

- [ ] BE-1 DB migration
  - [ ] 新文件 `apps/qa-service/src/migrations/<NN>-notebook-template-table.sql`（编号 +1）
  - [ ] CREATE TABLE + UNIQUE INDEX + CHECK constraints
  - [ ] 跑 migration 验证
- [ ] BE-2 service 改造 `services/notebookTemplates.ts`
  - [ ] 加 `loadTemplatesFromDb` / `getTemplateByKey` / `seedSystemTemplatesIfMissing`
  - [ ] 旧 `NOTEBOOK_TEMPLATES` 常量保留作 seed 数据源
  - [ ] `NotebookTemplateSpec.id` 类型 widening 到 string；加 `source` 字段
- [ ] BE-3 startup hook：`apps/qa-service/src/index.ts` 启动时调 `seedSystemTemplatesIfMissing()`
- [ ] BE-4 routes/notebooks.ts 改造
  - [ ] `GET /templates` 异步 loadTemplatesFromDb
  - [ ] `POST /notebooks` template_id 校验改 getTemplateByKey
- [ ] BE-5 前端 `apps/web/src/api/notebooks.ts`
  - [ ] `NotebookTemplateSpec` 加 `source`
  - [ ] `NotebookTemplateId` 类型放宽到 string
  - [ ] grep & 修复消费方
- [ ] BE-6 测试改造
  - [ ] `notebookTemplates.test.ts` 加 PT-1..PT-8
  - [ ] mock pgPool 模拟 DB 路径
  - [ ] 全套零回归

## B-4 Verify

- [ ] V-1 跑 migration → DB 有 6 system 模板
- [ ] V-2 重启 qa-service → seedSystemTemplatesIfMissing 不再插入（幂等）
- [ ] V-3 GET /api/notebooks/templates 返回 6 条 + source=system
- [ ] V-4 POST /api/notebooks { template_id: 'research_review' } 创建成功
- [ ] V-5 POST /api/notebooks { template_id: 'foo' } 400
- [ ] V-6 前端创建 notebook → 模板选择器仍显示 6 个 → 应用模板成功
- [ ] V-7 vitest 全套零回归
- [ ] V-8 tsc exit 0

## B-5 Archive

- [ ] mv specs → archive
- [ ] 更新 SESSION 加 commit ⑧
