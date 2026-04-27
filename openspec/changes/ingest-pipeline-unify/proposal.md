# Proposal: Ingest Pipeline 统一

## Problem

当前 4 条 ingest 入口行为不一致：

```
POST /api/knowledge/ingest      ← PDF 走 ODL+VLM+tags+images；非 PDF 走 chunkDocument 三级切片
POST /api/ingest/scan-folder    ← 只调 extractDocument（officeparser），无 ODL、无 VLM、无 image
POST /api/ingest/extract-text   ← 只返 text，不入 DB
BookStack sync                  ← 旧 chunk 流，无图
```

同一个 PDF 从不同入口进来，入 pgvector 的数据质量不同 → RAG 检索随机命中。另外：

- `metadata_field` 没 `kind / bbox / heading_path / image_id` 列，无法区分 heading vs 正文、无法做区块定位
- 所有 ingest 端点**没接 unified-auth**：生产裸奔，任何人都能写 metadata_asset

## Scope（本 Change）

1. 抽出 `services/ingestPipeline/` 作为单一入口 `ingestDocument({...})`
2. 按扩展名路由到 extractor（`pdf / docx / pptx / xlsx / markdown / plaintext / image`）；
   每个 extractor 返统一的 `ExtractResult`
3. `pipeline.ts` 做统一后处理：写 metadata_asset → 写 metadata_field（带 kind/page/bbox/heading_path）
   → embed → tags → images → VLM captions
4. **迁移 S1**：`POST /api/knowledge/ingest` 改用 ingestDocument
5. **迁移 S2**：`POST /api/ingest/scan-folder` 改用 ingestDocument
6. **迁移 S3**：BookStack sync（`indexBookstackPage.ts`）改用 ingestDocument
7. 所有 ingest 入口挂 `requireAuth + enforceAcl({action:'WRITE', source_id})`
8. `metadata_field` schema 扩展：`kind VARCHAR(32), bbox JSONB, heading_path TEXT, image_id INT`

## Out of Scope

- async 任务队列 / 202 + 状态查询（Phase 2）
- 非 PDF 的 VLM（仅 PDF 走 VLM，见 Q3=b）
- docx 图片抽取、xlsx per-sheet 精细化切片、markdown heading-aware 切片
  （本轮保留旧行为：extractor 骨架就位，精细化留下一轮）
- MCP `search_assets` tool（独立 change）
- MetadataOpsAgent 写操作（独立 change）

## 决策记录

- D-001 单一 pipeline：`services/ingestPipeline/index.ts#ingestDocument`
- D-002 ExtractResult 为统一中间产物；所有 extractor 满足该契约
- D-003 PDF 独占 ODL+VLM；其它类型 Phase 1 沿用 officeparser/mammoth，通过 extractor 壳包装
- D-004 所有 ingest 端点走 `enforceAcl('WRITE')`；DEV BYPASS 覆盖本地
- D-005 `metadata_field` 扩列一次性全加（kind/bbox/heading_path/image_id），老数据 NULL
- D-006 本轮不做 async 队列；长任务仍同步执行（未来 Phase 2 再加）
