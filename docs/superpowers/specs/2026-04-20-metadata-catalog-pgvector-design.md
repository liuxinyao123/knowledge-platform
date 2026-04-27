# 数据资产目录 + pgvector 向量检索 — 设计文档

**日期**: 2026-04-20  
**状态**: 已确认

---

## 目标

用 PostgreSQL + pgvector 替换当前 MySQL 的资产/向量表，实现：

1. 结构化元数据管理（4 张 metadata_* 表）
2. ANN 向量检索（IVFFlat 索引，毫秒级响应）
3. 三级切片入库（L1/L2/L3，仅 L3 向量化）
4. 文档入库 API（PDF/DOCX/MD）
5. BookStack 页面同步脚本

---

## 架构决策

### 双数据库（方案 A）

```
MySQL (bookstack_db)          PostgreSQL (pg_db)
────────────────────          ──────────────────
BookStack 应用表              metadata_source
knowledge_user_roles          metadata_asset
knowledge_shelf_visibility    metadata_field  ← pgvector
knowledge_sync_meta           metadata_acl_rule
                              ↑ 替换废弃:
                              ✗ asset_source
                              ✗ asset_item
                              ✗ asset_knowledge_link
                              ✗ knowledge_chunks
```

qa-service 维护两个连接池：
- `db.ts` → MySQL pool（现有，不变）
- `pgDb.ts` → PostgreSQL pool（新增）

---

## 数据库 Schema

### PostgreSQL 表结构

```sql
-- 启用 pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 数据来源
CREATE TABLE metadata_source (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(256) NOT NULL,
  type        VARCHAR(64)  NOT NULL,       -- document / database / api / file
  connector   VARCHAR(128),               -- bookstack / mysql / feishu
  config      JSONB,
  status      VARCHAR(32)  DEFAULT 'active',
  created_by  VARCHAR(128),
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- 2. 数据资产
CREATE TABLE metadata_asset (
  id          SERIAL PRIMARY KEY,
  source_id   INT REFERENCES metadata_source(id),
  external_id VARCHAR(512),
  name        VARCHAR(512) NOT NULL,
  type        VARCHAR(64),               -- document / table / api_endpoint
  path        TEXT,
  content     TEXT,
  summary     TEXT,
  tags        TEXT[],
  metadata    JSONB,
  indexed_at  TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX ON metadata_asset(source_id);
CREATE INDEX ON metadata_asset(external_id);

-- 3. 切片 + 向量
CREATE TABLE metadata_field (
  id          SERIAL PRIMARY KEY,
  asset_id    INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_level INT DEFAULT 3,             -- 1=粗 2=中 3=细
  content     TEXT NOT NULL,
  embedding   vector(1024),             -- Qwen/Qwen3-Embedding-8B
  token_count INT,
  metadata    JSONB
);
CREATE INDEX ON metadata_field USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. 访问控制
CREATE TABLE metadata_acl_rule (
  id         SERIAL PRIMARY KEY,
  asset_id   INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
  source_id  INT REFERENCES metadata_source(id),
  role       VARCHAR(64),
  permission VARCHAR(64) NOT NULL,       -- read / write / admin
  condition  JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Docker Compose 变更

1. `bookstack_db` 镜像保持 `mysql:8.0`（BookStack 不支持 PG）
2. 新增 `pg_db` 服务：`pgvector/pgvector:pg16`
3. qa_service 新增环境变量：`PG_HOST / PG_PORT / PG_DB / PG_USER / PG_PASS`

---

## API 接口

### 文档入库

```
POST /api/knowledge/ingest
Body: multipart/form-data { source_id, file }
流程：
  1. 提取纯文本（pdf-parse / mammoth / 直读）
  2. 写 metadata_asset
  3. 三级切片（L1≤2000token / L2≤800 / L3≤300）
  4. L3 向量化（SiliconFlow Qwen/Qwen3-Embedding-8B）
  5. 批量写 metadata_field
  6. 更新 indexed_at

GET /api/knowledge/documents
返回 metadata_asset 列表

DELETE /api/knowledge/documents/:id
CASCADE 删除 metadata_field
```

### 知识检索

```
POST /api/knowledge/search
Body: { query, source_ids?, top_k? }
流程：
  1. query 向量化
  2. pgvector ANN 检索（IVFFlat，chunk_level=3）
  3. ACL 过滤
  4. 返回 [{ asset_id, asset_name, chunk_content, score, metadata }]
```

### 页面代理（已有，迁入此模块）

```
GET /api/knowledge/pages/:id  → 代理 BookStack，返回 { name, html, updated_at, url }
```

---

## 迁移策略

1. PostgreSQL 启动后，运行迁移脚本 `scripts/sync-bookstack.ts`
2. 将 BookStack 所有页面写入 `metadata_asset` + `metadata_field`（含向量）
3. 旧 MySQL 表（asset_source / asset_item / asset_knowledge_link / knowledge_chunks）的 `runMigrations()` 中保留 CREATE TABLE 不删，但所有路由切换到 PostgreSQL
4. 旧表在下一个版本 DROP

---

## 废弃路由映射

| 旧路由 | 新路由 |
|---|---|
| `/api/asset-directory/*` | 保留（引用 metadata_* 表） |
| `/api/sync/ingest` | `/api/knowledge/ingest` |
| 向量检索（内存计算） | pgvector ANN |

---

## 嵌入模型

- 模型：`Qwen/Qwen3-Embedding-8B`（SiliconFlow，已配置）
- 维度：1024，与 `vector(1024)` 完全匹配
- 复用现有 `embeddings.ts` 的 `embedTexts()` 函数

---

## 验收条件

1. `metadata_field` 有数据，`embedding` 列非空
2. `POST /api/knowledge/search` 返回结果，score > 0.7 的结果语义相关
3. `GET /api/knowledge/documents` 列出已同步的 BookStack 页面
4. 旧向量检索路径（MySQL全表扫）不再被调用
