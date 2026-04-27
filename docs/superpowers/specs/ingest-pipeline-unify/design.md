# Explore Draft — Ingest Pipeline 统一

> 草稿。正式契约见 `openspec/changes/ingest-pipeline-unify/`。

## 读的代码

- 4 条 ingest 入口：`/api/knowledge/ingest`、`/api/ingest/scan-folder`、`/api/ingest/extract-text`、BookStack sync
- 每条入口处理文件的方式**都不同**——PDF 只在 `/api/knowledge/ingest` 走 ODL+VLM
- 所有 ingest 端点**没接 unified-auth**，生产裸奔
- `metadata_field` 缺 `kind/bbox/heading_path/image_id` 列

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|---|---|---|---|
| A 让每条入口手抄同样逻辑 | 0 | 不一致会持续加重 | ✗ |
| B 抽一个 `ingestDocument()` 单一函数（本 change 采用） | 中 | 重构面广 | ✓ |
| C 全换成 Queue + Worker | 高 | 依赖新组件 | ⚠️ Phase 2 |

**选 B**：抽 `services/ingestPipeline/` 为单一入口；按扩展名路由 extractor；所有后处理集中在 `pipeline.ts`；挂 `enforceAcl('WRITE')`。async 队列留给 Phase 2。

## 风险

- BookStack sync 链路复杂；本 change 采用"双写"稳态过渡（MySQL 老 + pgvector 新），
  未来单独 change 下线老路径
- `metadata_field` 新列需线上 ALTER；项目 PG 体量小，可忽略
- 短文本频繁调 LLM 会浪费成本；用 `skipTags` 阈值治理
