# ADR 2026-04-21-08 · Ingest Pipeline 统一入口

## Context

4 条 ingest 入口行为不一致：
- `/api/knowledge/ingest`（能力最全）
- `/api/ingest/scan-folder`（基础）
- `/api/ingest/extract-text`（只抽文本）
- BookStack sync（旧链路）

同一文件从不同入口入库，pgvector 质量不同；ingest 端点没接 unified-auth。

## Decision

1. 建 `services/ingestPipeline/` 为唯一入口 `ingestDocument(input)`
2. 按扩展名路由到 extractor（pdf/docx/pptx/xlsx/markdown/plaintext/image）；每个 extractor 返统一 `ExtractResult`
3. `pipeline.ts` 统一后处理：INSERT metadata_asset、写 metadata_field、embed、tags、images、VLM
4. 迁移 S1（/api/knowledge/ingest）、S2（/api/ingest/scan-folder）、S3（BookStack sync 尽量带上）
5. 所有 ingest 端点挂 `requireAuth + enforceAcl({action:'WRITE', source_id})`
6. `metadata_field` 扩列：kind / bbox / heading_path / image_id（一次 migration）
7. 本轮不做 async 队列（Phase 2）；VLM 仅 PDF（Phase 1）

## Consequences

**正面**
- PDF 从任意入口进来结果一致（ODL+VLM+tags+images）
- extractor 可独立升级（docx 抽图、xlsx per-sheet 不影响其它类型）
- 生产 ACL WRITE 落地，防止误写
- bbox / heading_path 为未来"原文区块跳转"留口

**负面 / 取舍**
- 重构面广，需逐条迁移并保持响应兼容
- BookStack sync 链路最复杂，若本轮超预期留 TODO
- 同步 VLM 对大 PDF 仍慢（Phase 2 加 async 队列解决）

## Links

- openspec/changes/ingest-pipeline-unify/
- 相关依赖：pdf-pipeline-v2（2026-04-21-07 ADR）、unified-auth
