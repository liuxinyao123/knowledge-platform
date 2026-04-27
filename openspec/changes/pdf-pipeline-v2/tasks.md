# Tasks: PDF Pipeline v2

## 依赖与基础
- [x] BE-1: `apps/qa-service/package.json` 加 optionalDependencies `@opendataloader/pdf`
- [x] BE-2: `apps/qa-service/.env.example` 追加 `INGEST_VLM_ENABLED / INGEST_VLM_MODEL / ASSET_IMAGE_ROOT`
- [x] BE-3: 更新 `apps/qa-service/Dockerfile`（已有，加 openjdk-17-jre-headless）
- [x] BE-4: `services/pdfPipeline/javaCheck.ts` + 在 `index.ts` 启动时调用，WARN 不退出

## 类型与骨架
- [x] BE-5: `services/pdfPipeline/types.ts` — PdfChunk / PdfImage / PdfPipelineResult / PdfPipelineOpts / OdlNotAvailableError

## DB schema
- [x] BE-6: `services/pgDb.ts` 添加 `CREATE TABLE IF NOT EXISTS metadata_asset_image` + index

## ODL 解析
- [x] BE-7: `services/pdfPipeline/odlExtract.ts` —— 软依赖动态 import；写临时文件、调 convert、读 outputDir、清理 temp
- [x] BE-8: `services/pdfPipeline/odlParse.ts` —— JSON → PdfChunk[] / PdfImage[]；过滤页眉页脚；表格转 markdown

## 图片落档
- [x] BE-9: `services/pdfPipeline/imageStore.ts` —— 写盘 + INSERT metadata_asset_image (ON CONFLICT)

## VLM caption
- [x] BE-10: `services/llm.ts` 扩展 `ChatMessage.content` 支持 `string | null | ContentBlock[]`
- [x] BE-11: `services/pdfPipeline/vlmCaption.ts` —— image-heavy 阈值判断 + chatComplete vision；env 开关
- [x] BE-12: `services/pdfPipeline/index.ts` —— extractPdfStructured 入口；总线降级处理

## 集成
- [x] BE-13: `routes/knowledgeDocs.ts` POST /ingest —— PDF 分支切到 extractPdfStructured；失败降级到原 PDFParse v2
- [ ] BE-14: `services/ingestExtract.ts` —— `.pdf` 路径切到新 pipeline（暂未改；当前 /ingest 走 knowledgeDocs，officeparser 路径仍服务 .pptx）

## 测试（TDD 先行）
- [x] TE-1: `__tests__/pdfPipeline.odlParse.test.ts` —— heading / paragraph / table / image / 页眉过滤
- [x] TE-2: `__tests__/pdfPipeline.imageStore.test.ts` —— 路径 / DB upsert
- [x] TE-3: `__tests__/pdfPipeline.vlmCaption.test.ts` —— 阈值 / 关闭 / 失败兜底 / opts override
- [x] TE-4 (变体): `__tests__/pdfPipeline.javaCheck.test.ts` —— 启动检查
- [ ] TE-5: 集成测试（mock ODL + mock VLM 端到端）—— 留下一轮，依赖真实安装后样本

## 契约资产
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-07-pdf-pipeline-v2-odl-and-vlm.md` 落 ADR
- [x] CT-2: `.superpowers-memory/integrations.md` 追加 "PDF Pipeline v2"

## 验证
- [ ] VR-1: `pnpm -r test` 全绿（本机验，新增 4 份测试）
- [x] VR-2: `tsc --noEmit` 零新增报错（沙箱已验）
- [ ] VR-3: 本机端到端 —— `brew install openjdk` 后 `pnpm install` 拉 @opendataloader/pdf；上传 LFTGATE-3 PDF；看：
        - `infra/asset_images/{assetId}/` 出现图片
        - `metadata_asset_image` 表行数 > 0
        - 响应 body 含 `images.total / images.withCaption / structuredChunks`
- [ ] VR-4: 关 `INGEST_VLM_ENABLED` 重跑，caption 全 null，其它正常
- [ ] VR-5: 临时改 PATH 模拟 java 缺失，验证降级路径
- [ ] VR-6: 归档 `docs/superpowers/specs/pdf-pipeline-v2/` → `archive/`
