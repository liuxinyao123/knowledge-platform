# Tasks: ingest-ui-rich

## 后端
- [x] BE-1: `routes/ingest.ts` 加 `GET /recent?limit=` —— 读 audit_log + 挖 detail

## 前端 API
- [x] FE-1: `api/ingest.ts` 补 `getRecent()` + `RecentImport` 类型

## 前端组件
- [x] FE-2: `knowledge/Ingest/index.tsx` 重写为两 Tab 外壳（向导/ZIP）
- [x] FE-3: `knowledge/Ingest/Wizard.tsx` —— 容器 + 4 步状态机 + 串行 parse/commit
- [x] FE-4: `knowledge/Ingest/FileQueue.tsx` —— 左栏队列（phase pill + 重试）
- [x] FE-5: `knowledge/Ingest/PreviewPane.tsx` —— 中栏预览（text 截断 4000 / attachment hint）
- [x] FE-6: `knowledge/Ingest/MetaForm.tsx` —— 右栏 tags / category / 覆盖摘要
- [x] FE-7: `knowledge/Ingest/RecentImports.tsx` —— 10s 轮询 + 跳转 /assets/:id
- [x] FE-8: `knowledge/Ingest/ZipImporter.tsx` —— 旧 ZIP 流程瘦身版

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-13-ingest-ui-rich.md`

## 验证
- [x] VR-1: `tsc --noEmit` 双 0（apps/web + apps/qa-service）
- [ ] VR-2: 手动多文件 → 解析 → 编辑 tags → 提交 → 全 done
- [ ] VR-3: Recent Imports 新条 + 点详情跳 /assets/:id
- [ ] VR-4: 旧 ZIP Tab 依旧可用
- [x] VR-5: 归档 —— docs/superpowers/archive/ingest-ui-rich/

## Followups
- [x] FU-1: `Ingest/index.test.tsx` 重写为 Wizard + ZIP Tab 覆盖（补 data-testid 到 Wizard/ZipImporter；沙箱无法跑 vitest 因 rolldown linux 原生绑定被 npm policy 挡，本机 Mac 应该直接跑通）
- [ ] FU-2: 串行提交改成并发 worker pool（2~3 并发）
- [ ] FU-3: category 可配置化（从后端读 / 管理员可编辑）
