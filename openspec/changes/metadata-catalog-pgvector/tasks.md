# Tasks

- [x] T1: Docker Compose 新增 pg_db（pgvector/pgvector:pg16）
- [x] T2: pgDb.ts — PostgreSQL 连接池 + 4 张表迁移
- [x] T3: knowledgeDocs.ts — GET /documents + DELETE /documents/:id
- [x] T4: knowledgeDocs.ts — POST /ingest（文本提取 + 三级切片 + 向量化）
- [x] T5: knowledgeDocs.ts — POST /search（pgvector ANN）
- [x] T6: index.ts 注册路由
- [x] T7: scripts/sync-bookstack.ts — BookStack 页面同步到 metadata_asset
- [ ] T8: 验收测试（ingest → search → score > 0.7）
