# Tasks: 知识治理子模块

## Schema
- [x] BE-1: `pgDb.ts` —— 加 `audit_log` 表 + 3 索引；`duplicate_dismissed` 表；`metadata_asset` 加 `merged_into / author` 列

## 后端 service
- [x] BE-2: `services/audit.ts` —— writeAudit() + 失败仅 WARN
- [x] BE-3: ingestPipeline `runPipeline` 末尾调 writeAudit('ingest_done')
- [x] BE-4: `routes/acl.ts` 增删改完成后调 writeAudit('acl_rule_*')
- [x] BE-5: `services/governance/tags.ts` —— listTags / mergeTags / renameTag
- [x] BE-6: `services/governance/duplicates.ts` —— findDuplicatePairs / mergeAssets / dismissDuplicate
- [x] BE-7: `services/governance/quality.ts` —— listQualityIssues / fixIssueBatch

## 后端路由
- [x] BE-8: `routes/governance/tags.ts` —— GET/POST merge/rename
- [x] BE-9: `routes/governance/duplicates.ts` —— GET / POST merge / POST dismiss
- [x] BE-10: `routes/governance/quality.ts` —— GET / POST fix
- [x] BE-11: `routes/governance/auditLog.ts` —— GET 分页过滤 + GET .csv 导出
- [x] BE-12: `index.ts` 挂载新路由（沿用 `/api/governance` 前缀）

## 前端
- [x] FE-1: `web/src/knowledge/Governance/KnowledgeOps/index.tsx` —— 4 Tab 容器
- [x] FE-2: `TagsPanel.tsx`
- [x] FE-3: `DuplicatesPanel.tsx`（含阈值 slider）
- [x] FE-4: `QualityPanel.tsx`
- [x] FE-5: `AuditLogPanel.tsx`（含过滤 + CSV 导出按钮）
- [x] FE-6: 在现有 Governance 页加 "知识治理" 入口 / Tab；保留旧 Members/Spaces

## 鉴权
- [x] BE-13: 所有 GET 走 enforceAcl(READ)；写操作走 enforceAcl(WRITE)

## 测试
- [x] TE-1: `audit.test.ts`
- [x] TE-2: `governance.tags.test.ts`
- [x] TE-3: `governance.duplicates.test.ts`
- [x] TE-4: `governance.quality.test.ts`
- [x] TE-5: `governance.auditLog.test.ts` (CSV)

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-09-knowledge-governance.md`
- [x] CT-2: `.superpowers-memory/integrations.md` 追加 "审计 / 治理"

## 验证
- [x] VR-1: `pnpm -r test` 全绿（本机）
- [x] VR-2: `tsc --noEmit` 零错（沙箱已验）
- [x] VR-3: 端到端 —— 上传 1 份 PDF → audit_log 多 1 条 ingest_done；GET /audit-log 看到
- [x] VR-4: GET /tags 返非空（用之前 ingest 留下的 tags）；前端面板渲染
- [x] VR-5: GET /duplicates 返当前 PG 里实际相似对（threshold=0.6 故意调低看效果）
- [x] VR-6: 归档
