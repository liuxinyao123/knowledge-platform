# Explore Draft — 元数据资产目录 + pgvector 向量检索

> 草稿。正式契约见 `openspec/changes/metadata-catalog-pgvector/`。

## 读的代码

- 早期 RAG 走 BookStack 全文搜索（粗、不带向量）
- 已有 `infra/docker-compose.yml` 但无 PG 容器
- 架构图要求"数据资产目录"含 4 张元数据表 + 向量检索

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|---|---|---|---|
| A 复用 MySQL + JSON 存向量 | 低 | 检索性能差，无 ANN | ✗ |
| B 引 Elasticsearch | 高 | 大型依赖；运维重 | ⚠️ |
| C **PostgreSQL + pgvector**（本 change 采用） | 中 | Docker 多一容器 | ✓ |
| D 用 Pinecone / Weaviate 云服务 | 中 | 出网依赖 / 数据合规 | ✗ |

**选 C**：成熟、本地部署、SQL 友好；与 metadata_* 关系表共库。

## 表设计要点

```
metadata_source       数据源（type, connector）
metadata_asset        资产（source_id FK, name, path, content, tags, indexed_at）
metadata_field        切片 + 向量（asset_id FK, chunk_level, embedding vector）
metadata_acl_rule     ACL 规则（asset_id?, source_id?, role, permission, condition）
```

## 风险

- pgvector 索引（ivfflat）需要数据量上来后做 REINDEX；初期可不建
- 与 BookStack MySQL 双库存在；source-of-truth 见 Q-002 决策
