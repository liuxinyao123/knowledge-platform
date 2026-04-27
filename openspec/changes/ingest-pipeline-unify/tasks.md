# Tasks: Ingest Pipeline 统一

## Schema
- [x] BE-1: `pgDb.ts` —— `metadata_field` 加 kind/bbox/heading_path/image_id（含 FK 安全添加）

## 骨架
- [x] BE-2: `services/ingestPipeline/types.ts`
- [x] BE-3: `services/ingestPipeline/router.ts`
- [x] BE-4: `services/ingestPipeline/pipeline.ts`
- [x] BE-5: `services/ingestPipeline/index.ts`

## Extractor
- [x] BE-6: `extractors/pdf.ts` —— 包装 pdfPipeline v2 + Odl 失败降级
- [x] BE-7: `extractors/docx.ts`
- [x] BE-8 + BE-9: `extractors/officeFamily.ts` (pptx + xlsx)
- [x] BE-10: `extractors/markdown.ts` —— heading-aware + headingPath 累计
- [x] BE-11: `extractors/plaintext.ts`
- [x] BE-12: `extractors/image.ts`

## 集成 S1
- [x] BE-13: `/ingest` 改用 ingestDocument + requireAuth + enforceAcl(WRITE)
- [x] BE-14: 响应字段向后兼容

## 集成 S2
- [x] BE-15: `/scan-folder` 每文件用 ingestDocument；SSE 加 extractorId

## 集成 S3
- [ ] BE-16: `indexBookstackPage.ts` —— 留下一轮（独立 change）

## 可观测
- [x] BE-17: `ingest_done` 结构化日志

## 测试
- [x] TE-1/2/3: router / pipeline / extractors 三组
- [ ] TE-4: 集成测试 supertest（留本机）

## 契约
- [x] CT-1: ADR 08
- [x] CT-2: integrations.md

## 验证
- [ ] VR-1: pnpm -r test 全绿（本机）
- [x] VR-2: tsc --noEmit 零错（沙箱已验）
- [ ] VR-3/4/5: 端到端（本机）
- [ ] VR-6: 归档
