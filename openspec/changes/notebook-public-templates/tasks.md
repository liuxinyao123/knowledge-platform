# Tasks · N-007 公共模板池

## B-1 Explore (✅)
- [x] `docs/superpowers/specs/notebook-public-templates/design.md`

## B-2 Lock (✅)
- [x] proposal / design / specs / tasks

## B-3 Execute（macOS 上做，涉及 DB migration）✅ 2026-04-29 commit 36266e4

- [x] BE-1 DB migration
  - [x] 新文件 `apps/qa-service/src/migrations/002-notebook-template-table.sql`
  - [x] CREATE TABLE + UNIQUE INDEX + CHECK constraints
  - [x] 跑 migration 验证（V-1 通过）
- [x] BE-2 service 改造 `services/notebookTemplates.ts`
  - [x] 加 `loadTemplatesFromDb` / `getTemplateByKey` / `seedSystemTemplatesIfMissing`
  - [x] 旧 `NOTEBOOK_TEMPLATES` 常量保留作 seed 数据源 + fallback
  - [x] `NotebookTemplateSpec.id` 类型 widening 到 string；加 `source` 字段
- [x] BE-3 startup hook：`apps/qa-service/src/index.ts` 启动时调 `seedSystemTemplatesIfMissing()`
- [x] BE-4 routes/notebooks.ts 改造
  - [x] `GET /templates` 异步 loadTemplatesFromDb（含 admin 可见性 + Cache-Control 改 private）
  - [x] `POST /notebooks` template_id 校验改 getTemplateByKey
- [x] BE-5 前端 `apps/web/src/api/notebooks.ts`
  - [x] `NotebookTemplateSpec` 加 `source`
  - [x] `NotebookTemplateId` 类型放宽到 string
  - [x] grep & 修复消费方（index.tsx / TemplateHintCard.tsx / Detail.tsx）
- [x] BE-6 测试改造
  - [x] `notebookTemplates.test.ts` 加 PT-1..PT-11（含 fallback 路径 PT-9..11）
  - [x] mock pgPool 模拟 DB 路径
  - [x] 全套零回归

## B-4 Verify ✅ 2026-04-30

- [x] V-1 跑 migration → DB 有 6 system 模板（V-3 间接证明）
- [x] V-2 重启 qa-service → seedSystemTemplatesIfMissing 不再插入（幂等）（V-3 仍返 6 条而非 12 条）
- [x] V-3 GET /api/notebooks/templates 返回 6 条 + source=system + 全 6 个 NotebookTemplateId
- [x] V-4 POST /api/notebooks { template_id: 'research_review' } 创建成功（id=5 生成）
- [x] V-5 POST /api/notebooks { template_id: 'foo_bar' } 400 + "invalid template_id: foo_bar (不存在或对当前用户不可见)"
- [x] V-6 前端创建 notebook → 模板选择器仍显示 7 个（空白 + 6 system）→ 应用模板成功 + TemplateHintCard 渲染
- [x] V-7 vitest 96/96（notebookTemplates 30/30 + accessibility 15/15 + answerIntent 51/51）
- [x] V-8 tsc qa-service / web 双向 exit 0
- [~] PT-7/PT-8 DB CHECK 约束：跳过真实 INSERT 验证（合资）；vitest 文本守卫覆盖 SQL 'system', NULL 写法

## B-5 Archive ✅ 2026-04-30

- [x] mv `docs/superpowers/specs/notebook-public-templates` → `docs/superpowers/archive/notebook-public-templates`
- [x] 更新 SESSION 加 commit ⑩ N-007 Execute（已在 b44cb95）+ commit ⑬ archive sign-off
