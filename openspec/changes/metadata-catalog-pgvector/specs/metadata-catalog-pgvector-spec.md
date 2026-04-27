# Spec: 数据资产目录 + pgvector

## 新增文件

| 文件 | 作用 |
|------|------|
| `infra/docker-compose.yml` | 新增 pg_db 服务（pgvector/pgvector:pg16） |
| `apps/qa-service/src/services/pgDb.ts` | PostgreSQL 连接池 + migrate |
| `apps/qa-service/src/routes/knowledgeDocs.ts` | ingest / documents / search 路由 |
| `scripts/sync-bookstack.ts` | BookStack → metadata_asset 同步脚本 |

## 修改文件

| 文件 | 变更 |
|------|------|
| `apps/qa-service/src/index.ts` | 注册 knowledgeDocs 路由，启动时 runPgMigrations() |
| `apps/qa-service/src/routes/knowledge.ts` | pages/:id 路由保留（已有） |
| `apps/web/vite.config.ts` | 已有 /api/knowledge 代理（不变） |
| `infra/docker-compose.yml` | qa_service 新增 PG_* 环境变量 |

## 接口契约

### POST /api/knowledge/ingest
- Content-Type: multipart/form-data
- 字段: `source_id` (number), `file` (File, ≤50MB)
- 支持扩展名: .pdf .docx .md .txt
- 响应: `{ assetId, chunks: { l1, l2, l3 } }`

### GET /api/knowledge/documents
- 查询参数: `source_id?`, `limit?`(默认50), `offset?`(默认0)
- 响应: `{ total, items: [{ id, name, type, path, indexed_at, tags }] }`

### DELETE /api/knowledge/documents/:id
- 响应: `{ ok: true }`
- 级联删除 metadata_field

### POST /api/knowledge/search
- Body: `{ query, source_ids?, top_k? }` (top_k 默认10，最大50)
- 响应: `{ results: [{ asset_id, asset_name, chunk_content, score, metadata }] }`
- 仅检索 chunk_level=3、embedding 非空的切片

## 不变范围

- BookStack 代理路由 `/api/bookstack/*`
- MySQL 治理表（knowledge_user_roles 等）
- 现有 RAG pipeline（ragPipeline.ts）继续使用 knowledge_chunks（MySQL）直到显式迁移
