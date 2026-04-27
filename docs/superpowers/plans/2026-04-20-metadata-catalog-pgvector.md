# 数据资产目录 + pgvector 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 PostgreSQL + pgvector 替换 MySQL 资产/向量表，提供三级切片文档入库、ANN 向量检索、BookStack 同步脚本。

**Architecture:** 双数据库（MySQL 留 BookStack + 治理表，PostgreSQL 承接 metadata_* 表）。qa-service 新增 pgDb.ts 连接池，knowledgeDocs.ts 路由，scripts/sync-bookstack.ts 同步脚本。

**Tech Stack:** PostgreSQL 16 + pgvector、pg（node-postgres）、pdf-parse、mammoth、SiliconFlow Qwen/Qwen3-Embedding-8B（1024 维，复用现有 embedTexts()）

---

### Task 1: 安装依赖 + Docker Compose 新增 pg_db

**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `apps/qa-service/package.json`

- [ ] **Step 1: 安装 PostgreSQL 客户端和文档解析库**

```bash
cd apps/qa-service
pnpm add pg pdf-parse mammoth
pnpm add -D @types/pg @types/pdf-parse
```

- [ ] **Step 2: 在 docker-compose.yml 新增 pg_db 服务**

在 `infra/docker-compose.yml` 的 services 末尾追加：

```yaml
  pg_db:
    image: pgvector/pgvector:pg16
    container_name: pg_db
    environment:
      - POSTGRES_DB=knowledge
      - POSTGRES_USER=knowledge
      - POSTGRES_PASSWORD=knowledge_secret
    volumes:
      - ./pg_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U knowledge -d knowledge"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 15s
    restart: unless-stopped
```

在 `qa_service` 的 `depends_on` 中加入：
```yaml
      pg_db:
        condition: service_healthy
```

在 `qa_service` 的 `environment` 中加入：
```yaml
      PG_HOST: pg_db
      PG_PORT: "5432"
      PG_DB: knowledge
      PG_USER: knowledge
      PG_PASS: knowledge_secret
```

- [ ] **Step 3: 在 apps/qa-service/.env 追加本地开发 PG 配置**

```
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DB=knowledge
PG_USER=knowledge
PG_PASS=knowledge_secret
```

- [ ] **Step 4: 启动 pg_db 容器（本地开发用）**

```bash
cd infra
docker compose up pg_db -d
docker compose ps
```

期望：pg_db 状态为 healthy

- [ ] **Step 5: 提交**

```bash
git add infra/docker-compose.yml apps/qa-service/package.json pnpm-lock.yaml apps/qa-service/.env
git commit -m "feat: add pg_db (pgvector:pg16) to docker-compose, install pg/pdf-parse/mammoth"
```

---

### Task 2: pgDb.ts — PostgreSQL 连接池 + 迁移

**Files:**
- Create: `apps/qa-service/src/services/pgDb.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/qa-service/src/__tests__/pgDb.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { default: { Pool: vi.fn().mockImplementation(() => ({ connect, query })) } }
})

describe('getPgPool', () => {
  beforeEach(() => vi.resetModules())

  it('returns a pool instance', async () => {
    const { getPgPool } = await import('../services/pgDb.ts')
    const pool = getPgPool()
    expect(pool).toBeDefined()
  })

  it('reuses the same pool on repeated calls', async () => {
    const { getPgPool } = await import('../services/pgDb.ts')
    expect(getPgPool()).toBe(getPgPool())
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/__tests__/pgDb.test.ts
```

期望: FAIL（pgDb.ts 不存在）

- [ ] **Step 3: 实现 pgDb.ts**

Create `apps/qa-service/src/services/pgDb.ts`:

```ts
import pg from 'pg'

let _pool: pg.Pool | null = null

export function getPgPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      host:     process.env.PG_HOST     ?? '127.0.0.1',
      port:     Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DB       ?? 'knowledge',
      user:     process.env.PG_USER     ?? 'knowledge',
      password: process.env.PG_PASS     ?? 'knowledge_secret',
      max: 5,
    })
  }
  return _pool
}

export async function runPgMigrations(): Promise<void> {
  const pool = getPgPool()
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_source (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(256) NOT NULL,
      type       VARCHAR(64)  NOT NULL,
      connector  VARCHAR(128),
      config     JSONB,
      status     VARCHAR(32)  DEFAULT 'active',
      created_by VARCHAR(128),
      created_at TIMESTAMP    DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_asset (
      id          SERIAL PRIMARY KEY,
      source_id   INT REFERENCES metadata_source(id),
      external_id VARCHAR(512),
      name        VARCHAR(512) NOT NULL,
      type        VARCHAR(64),
      path        TEXT,
      content     TEXT,
      summary     TEXT,
      tags        TEXT[],
      metadata    JSONB,
      indexed_at  TIMESTAMP,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_source ON metadata_asset(source_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_ext ON metadata_asset(external_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_field (
      id          SERIAL PRIMARY KEY,
      asset_id    INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      chunk_level INT DEFAULT 3,
      content     TEXT NOT NULL,
      embedding   vector(1024),
      token_count INT,
      metadata    JSONB
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_field_embedding
      ON metadata_field USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_acl_rule (
      id         SERIAL PRIMARY KEY,
      asset_id   INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
      source_id  INT REFERENCES metadata_source(id),
      role       VARCHAR(64),
      permission VARCHAR(64) NOT NULL,
      condition  JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await ensureDefaultSource(pool)
}

async function ensureDefaultSource(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id FROM metadata_source WHERE connector = 'bookstack' LIMIT 1`
  )
  if (rows.length > 0) return
  await pool.query(
    `INSERT INTO metadata_source (name, type, connector, status)
     VALUES ($1, $2, $3, $4)`,
    ['BookStack 知识库', 'document', 'bookstack', 'active']
  )
}
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/__tests__/pgDb.test.ts
```

期望: PASS

- [ ] **Step 5: 实际连接验证**

```bash
node --experimental-strip-types -e "
import('./src/services/pgDb.ts').then(async ({ runPgMigrations }) => {
  await runPgMigrations()
  console.log('migrations ok')
  process.exit(0)
}).catch(e => { console.error(e.message); process.exit(1) })
"
```

期望: `migrations ok`

- [ ] **Step 6: 提交**

```bash
git add apps/qa-service/src/services/pgDb.ts apps/qa-service/src/__tests__/pgDb.test.ts
git commit -m "feat: add pgDb.ts with PostgreSQL pool + 4 metadata table migrations"
```

---

### Task 3: knowledgeDocs.ts — GET /documents + DELETE /documents/:id

**Files:**
- Create: `apps/qa-service/src/routes/knowledgeDocs.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/qa-service/src/__tests__/knowledgeDocs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({ query: mockQuery }),
}))
vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn().mockResolvedValue([[...Array(1024)].map(() => 0.1)]),
  isEmbeddingConfigured: vi.fn().mockReturnValue(true),
}))

async function buildApp() {
  const { knowledgeDocsRouter } = await import('../routes/knowledgeDocs.ts')
  const app = express()
  app.use(express.json())
  app.use('/api/knowledge', knowledgeDocsRouter)
  return app
}

describe('GET /api/knowledge/documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns document list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] })
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 1, name: 'Doc A', type: 'document', path: null, indexed_at: null, tags: [] },
      { id: 2, name: 'Doc B', type: 'document', path: null, indexed_at: null, tags: [] },
    ]})
    const app = await buildApp()
    const res = await request(app).get('/api/knowledge/documents')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.items).toHaveLength(2)
  })
})

describe('DELETE /api/knowledge/documents/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok on delete', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const app = await buildApp()
    const res = await request(app).delete('/api/knowledge/documents/1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns 404 when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })
    const app = await buildApp()
    const res = await request(app).delete('/api/knowledge/documents/99')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/__tests__/knowledgeDocs.test.ts
```

期望: FAIL（路由未实现）

- [ ] **Step 3: 实现路由（仅 GET + DELETE，不含 ingest/search）**

Create `apps/qa-service/src/routes/knowledgeDocs.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { getPgPool } from '../services/pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from '../services/embeddings.ts'

export const knowledgeDocsRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// GET /api/knowledge/documents
knowledgeDocsRouter.get('/documents', async (req: Request, res: Response) => {
  const pool = getPgPool()
  const sourceId = req.query.source_id ? Number(req.query.source_id) : null
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))
  const offset = Math.max(0, Number(req.query.offset ?? 0))

  const where = sourceId ? 'WHERE source_id = $1' : ''
  const params = sourceId ? [sourceId] : []

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM metadata_asset ${where}`, params
  )
  const { rows } = await pool.query(
    `SELECT id, name, type, path, indexed_at, tags
     FROM metadata_asset ${where}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  )

  res.json({ total: Number(countRows[0].count), items: rows })
})

// DELETE /api/knowledge/documents/:id
knowledgeDocsRouter.delete('/documents/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return }
  const pool = getPgPool()
  const { rowCount } = await pool.query('DELETE FROM metadata_asset WHERE id = $1', [id])
  if (!rowCount) { res.status(404).json({ error: 'not found' }); return }
  res.json({ ok: true })
})
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/__tests__/knowledgeDocs.test.ts
```

期望: PASS（GET + DELETE 测试）

- [ ] **Step 5: 提交**

```bash
git add apps/qa-service/src/routes/knowledgeDocs.ts apps/qa-service/src/__tests__/knowledgeDocs.test.ts
git commit -m "feat: GET /documents + DELETE /documents/:id routes"
```

---

### Task 4: POST /api/knowledge/ingest（文本提取 + 三级切片 + 向量化）

**Files:**
- Modify: `apps/qa-service/src/routes/knowledgeDocs.ts`
- Create: `apps/qa-service/src/services/chunkDocument.ts`

- [ ] **Step 1: 写切片服务失败测试**

Create `apps/qa-service/src/__tests__/chunkDocument.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { chunkDocument } from '../services/chunkDocument.ts'

describe('chunkDocument', () => {
  it('produces L1, L2, L3 chunks', () => {
    const text = Array(20).fill('这是一句完整的测试句子。').join('\n')
    const { l1, l2, l3 } = chunkDocument(text)
    expect(l1.length).toBeGreaterThanOrEqual(1)
    expect(l2.length).toBeGreaterThanOrEqual(l1.length)
    expect(l3.length).toBeGreaterThanOrEqual(l2.length)
  })

  it('L3 chunks are shorter than L2', () => {
    const text = Array(50).fill('测试文本内容。').join('\n')
    const { l2, l3 } = chunkDocument(text)
    const avgL2 = l2.reduce((s, c) => s + c.length, 0) / (l2.length || 1)
    const avgL3 = l3.reduce((s, c) => s + c.length, 0) / (l3.length || 1)
    expect(avgL3).toBeLessThan(avgL2)
  })

  it('returns empty arrays for empty text', () => {
    const { l1, l2, l3 } = chunkDocument('')
    expect(l1).toHaveLength(0)
    expect(l2).toHaveLength(0)
    expect(l3).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/__tests__/chunkDocument.test.ts
```

- [ ] **Step 3: 实现 chunkDocument.ts**

Create `apps/qa-service/src/services/chunkDocument.ts`:

```ts
// 简单按字符数切片（中文约 1 字 ≈ 1.5 token）
const L1_CHARS = 3000   // ~2000 token
const L2_CHARS = 1200   // ~800 token
const L3_CHARS = 450    // ~300 token

function splitBySize(text: string, maxChars: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    // Try to break at sentence boundary
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const boundary = text.lastIndexOf('。', end)
      if (boundary > start + maxChars * 0.5) end = boundary + 1
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    start = end
  }
  return chunks
}

export function chunkDocument(text: string): { l1: string[]; l2: string[]; l3: string[] } {
  if (!text.trim()) return { l1: [], l2: [], l3: [] }
  return {
    l1: splitBySize(text, L1_CHARS),
    l2: splitBySize(text, L2_CHARS),
    l3: splitBySize(text, L3_CHARS),
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/__tests__/chunkDocument.test.ts
```

- [ ] **Step 5: 在 knowledgeDocs.ts 添加 POST /ingest**

在 `knowledgeDocs.ts` 顶部补充 import：
```ts
import { chunkDocument } from '../services/chunkDocument.ts'
```

在路由文件末尾追加：

```ts
// POST /api/knowledge/ingest
knowledgeDocsRouter.post('/ingest', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'file required' }); return }
  if (!isEmbeddingConfigured()) { res.status(503).json({ error: 'embedding not configured' }); return }

  const sourceId = Number(req.body.source_id ?? 1)
  const ext = req.file.originalname.split('.').pop()?.toLowerCase() ?? ''
  const pool = getPgPool()

  // 1. 提取文本
  let text = ''
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(req.file.buffer)
    text = result.text
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: req.file.buffer })
    text = result.value
  } else {
    text = req.file.buffer.toString('utf-8')
  }

  // 2. 写 metadata_asset
  const { rows: [asset] } = await pool.query(
    `INSERT INTO metadata_asset (source_id, name, type, content, updated_at)
     VALUES ($1, $2, 'document', $3, NOW())
     RETURNING id`,
    [sourceId, req.file.originalname, text]
  )
  const assetId: number = asset.id

  // 3. 三级切片
  const { l1, l2, l3 } = chunkDocument(text)

  // 4. 向量化 L3
  const embeddings = l3.length > 0 ? await embedTexts(l3) : []

  // 5. 批量写 metadata_field
  const allChunks: Array<{ level: number; content: string; embedding: number[] | null }> = [
    ...l1.map((c) => ({ level: 1, content: c, embedding: null })),
    ...l2.map((c) => ({ level: 2, content: c, embedding: null })),
    ...l3.map((c, i) => ({ level: 3, content: c, embedding: embeddings[i] ?? null })),
  ]

  for (let i = 0; i < allChunks.length; i++) {
    const { level, content, embedding } = allChunks[i]
    await pool.query(
      `INSERT INTO metadata_field (asset_id, chunk_index, chunk_level, content, embedding, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assetId, i, level, content, embedding ? `[${embedding.join(',')}]` : null, Math.ceil(content.length / 1.5)]
    )
  }

  // 6. 更新 indexed_at
  await pool.query('UPDATE metadata_asset SET indexed_at = NOW() WHERE id = $1', [assetId])

  res.json({ assetId, chunks: { l1: l1.length, l2: l2.length, l3: l3.length } })
})
```

- [ ] **Step 6: 跑全部测试**

```bash
npx vitest run
```

期望: 全部通过

- [ ] **Step 7: 提交**

```bash
git add apps/qa-service/src/services/chunkDocument.ts apps/qa-service/src/__tests__/chunkDocument.test.ts apps/qa-service/src/routes/knowledgeDocs.ts
git commit -m "feat: POST /ingest — text extract + 3-level chunking + pgvector embedding"
```

---

### Task 5: POST /api/knowledge/search（pgvector ANN）

**Files:**
- Modify: `apps/qa-service/src/routes/knowledgeDocs.ts`

- [ ] **Step 1: 在 knowledgeDocs.test.ts 追加 search 测试**

```ts
describe('POST /api/knowledge/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns search results', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { asset_id: 1, asset_name: 'Doc A', chunk_content: '测试内容', score: 0.92, metadata: null },
    ]})
    const app = await buildApp()
    const res = await request(app)
      .post('/api/knowledge/search')
      .send({ query: '测试查询', top_k: 5 })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].score).toBeGreaterThan(0.8)
  })

  it('returns 400 if query missing', async () => {
    const app = await buildApp()
    const res = await request(app).post('/api/knowledge/search').send({})
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试，确认 search 测试失败**

```bash
npx vitest run src/__tests__/knowledgeDocs.test.ts
```

- [ ] **Step 3: 实现 POST /search**

在 `knowledgeDocs.ts` 末尾追加：

```ts
// POST /api/knowledge/search
knowledgeDocsRouter.post('/search', async (req: Request, res: Response) => {
  const { query, source_ids, top_k = 10 } = req.body as {
    query?: string; source_ids?: number[]; top_k?: number
  }
  if (!query?.trim()) { res.status(400).json({ error: 'query required' }); return }
  if (!isEmbeddingConfigured()) { res.status(503).json({ error: 'embedding not configured' }); return }

  const k = Math.min(50, Math.max(1, Number(top_k)))
  const pool = getPgPool()

  const [qVec] = await embedTexts([query])
  const vecStr = `[${qVec.join(',')}]`

  let sourceFilter = ''
  const params: unknown[] = [vecStr, k]
  if (source_ids?.length) {
    sourceFilter = `AND ma.source_id = ANY($3::int[])`
    params.push(source_ids)
  }

  const { rows } = await pool.query(
    `SELECT
       mf.asset_id,
       ma.name        AS asset_name,
       mf.content     AS chunk_content,
       1 - (mf.embedding <=> $1::vector) AS score,
       mf.metadata
     FROM metadata_field mf
     JOIN metadata_asset ma ON ma.id = mf.asset_id
     WHERE mf.embedding IS NOT NULL
       AND mf.chunk_level = 3
       ${sourceFilter}
     ORDER BY mf.embedding <=> $1::vector
     LIMIT $2`,
    params
  )

  res.json({ results: rows })
})
```

- [ ] **Step 4: 跑全部测试，确认通过**

```bash
npx vitest run
```

- [ ] **Step 5: 提交**

```bash
git add apps/qa-service/src/routes/knowledgeDocs.ts
git commit -m "feat: POST /search — pgvector ANN cosine similarity"
```

---

### Task 6: index.ts 注册路由

**Files:**
- Modify: `apps/qa-service/src/index.ts`

- [ ] **Step 1: 修改 index.ts**

```ts
// 在现有 import 区域追加
import { knowledgeDocsRouter } from './routes/knowledgeDocs.ts'
import { runPgMigrations } from './services/pgDb.ts'
```

```ts
// 在 app.use 区域追加（放在 knowledgeRouter 之后）
app.use('/api/knowledge', knowledgeDocsRouter)
```

```ts
// 在 (async () => { ... })() 中，runMigrations() 之后追加
await runPgMigrations()
```

- [ ] **Step 2: 跑全部测试**

```bash
npx vitest run
```

- [ ] **Step 3: 重启服务，验证接口可达**

```bash
kill $(lsof -ti :3001); sleep 1
unset http_proxy https_proxy all_proxy
node --experimental-strip-types src/index.ts &
sleep 3 && curl --noproxy '*' -s http://localhost:3001/api/knowledge/documents
```

期望：`{ "total": 0, "items": [] }`

- [ ] **Step 4: 提交**

```bash
git add apps/qa-service/src/index.ts
git commit -m "feat: register knowledgeDocsRouter + runPgMigrations on startup"
```

---

### Task 7: scripts/sync-bookstack.ts

**Files:**
- Create: `apps/qa-service/scripts/sync-bookstack.ts`

- [ ] **Step 1: 实现同步脚本**

Create `apps/qa-service/scripts/sync-bookstack.ts`:

```ts
import dotenv from 'dotenv'
import { existsSync } from 'node:fs'

// 加载 .env
const envPath = new URL('../.env', import.meta.url).pathname
if (existsSync(envPath)) dotenv.config({ path: envPath, override: true })

import { getPgPool, runPgMigrations } from '../src/services/pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from '../src/services/embeddings.ts'
import { chunkDocument } from '../src/services/chunkDocument.ts'

const BS_URL = process.env.BOOKSTACK_URL ?? 'http://localhost:6875'
const TOKEN_ID = process.env.BOOKSTACK_TOKEN_ID ?? ''
const TOKEN_SECRET = process.env.BOOKSTACK_TOKEN_SECRET ?? ''

async function bsFetch(path: string) {
  const res = await fetch(`${BS_URL}/api${path}`, {
    headers: { Authorization: `Token ${TOKEN_ID}:${TOKEN_SECRET}` },
  })
  if (!res.ok) throw new Error(`BookStack API ${res.status}: ${path}`)
  return res.json()
}

async function syncPage(pool: ReturnType<typeof getPgPool>, sourceId: number, pageId: number) {
  const page = await bsFetch(`/pages/${pageId}`) as {
    id: number; name: string; book_id: number; slug: string
    html?: string; raw_html?: string; updated_at?: string
  }
  const text = (page.html ?? page.raw_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const url = `${BS_URL}/books/${page.book_id}/page/${page.slug}`

  // Upsert metadata_asset
  const { rows: [asset] } = await pool.query(
    `INSERT INTO metadata_asset (source_id, external_id, name, type, path, content, metadata, updated_at)
     VALUES ($1, $2, $3, 'document', $4, $5, $6, NOW())
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET name = EXCLUDED.name, content = EXCLUDED.content,
           metadata = EXCLUDED.metadata, updated_at = NOW()
     RETURNING id`,
    [sourceId, String(pageId), page.name, url, text, JSON.stringify({ url, updated_at: page.updated_at })]
  )

  // Add UNIQUE constraint if not present (safe to run multiple times)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_source_ext
    ON metadata_asset(source_id, external_id)
  `).catch(() => {})

  const assetId: number = asset.id

  // Delete old fields and re-insert
  await pool.query('DELETE FROM metadata_field WHERE asset_id = $1', [assetId])

  if (!text) return

  const { l1, l2, l3 } = chunkDocument(text)
  const embeddings = isEmbeddingConfigured() && l3.length > 0 ? await embedTexts(l3) : []

  const allChunks = [
    ...l1.map((c) => ({ level: 1, content: c, embedding: null as number[] | null })),
    ...l2.map((c) => ({ level: 2, content: c, embedding: null as number[] | null })),
    ...l3.map((c, i) => ({ level: 3, content: c, embedding: embeddings[i] ?? null })),
  ]

  for (let i = 0; i < allChunks.length; i++) {
    const { level, content, embedding } = allChunks[i]
    await pool.query(
      `INSERT INTO metadata_field (asset_id, chunk_index, chunk_level, content, embedding, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assetId, i, level, content, embedding ? `[${embedding.join(',')}]` : null, Math.ceil(content.length / 1.5)]
    )
  }

  await pool.query('UPDATE metadata_asset SET indexed_at = NOW() WHERE id = $1', [assetId])
  console.log(`  ✓ page ${pageId} "${page.name}" → ${allChunks.length} chunks`)
}

async function main() {
  await runPgMigrations()
  const pool = getPgPool()

  const { rows: [src] } = await pool.query(
    `SELECT id FROM metadata_source WHERE connector = 'bookstack' LIMIT 1`
  )
  const sourceId: number = src.id
  console.log(`Using metadata_source id=${sourceId}`)

  // Walk: shelves → books → pages
  const shelves = await bsFetch('/shelves?count=100') as { data: { id: number }[] }
  for (const shelf of shelves.data) {
    const shelfDetail = await bsFetch(`/shelves/${shelf.id}`) as { books: { id: number }[] }
    for (const book of shelfDetail.books) {
      const bookDetail = await bsFetch(`/books/${book.id}`) as {
        contents: { type: string; id: number; pages?: { id: number }[] }[]
      }
      for (const item of bookDetail.contents) {
        if (item.type === 'page') {
          await syncPage(pool, sourceId, item.id)
        } else if (item.type === 'chapter') {
          const chapter = await bsFetch(`/chapters/${item.id}`) as { pages: { id: number }[] }
          for (const p of chapter.pages) await syncPage(pool, sourceId, p.id)
        }
      }
    }
  }

  console.log('\n✅ Sync complete')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 运行同步**

```bash
cd apps/qa-service
node --experimental-strip-types scripts/sync-bookstack.ts
```

期望：输出每个页面的同步状态

- [ ] **Step 3: 验证数据**

```bash
psql -h 127.0.0.1 -U knowledge -d knowledge -c "
  SELECT COUNT(*) AS assets FROM metadata_asset;
  SELECT COUNT(*) AS fields FROM metadata_field;
  SELECT COUNT(*) AS with_embedding FROM metadata_field WHERE embedding IS NOT NULL;
"
```

期望：assets > 0，with_embedding > 0

- [ ] **Step 4: 提交**

```bash
git add apps/qa-service/scripts/sync-bookstack.ts
git commit -m "feat: sync-bookstack.ts — walk BookStack pages into metadata_asset + pgvector"
```

---

### Task 8: 验收测试

- [ ] **Step 1: 端到端搜索验证**

```bash
curl --noproxy '*' -s -X POST http://localhost:3001/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"知识库文档管理","top_k":5}' | \
  python3 -c "import sys,json; r=json.load(sys.stdin)['results']; [print(f'score={x[\"score\"]:.3f} | {x[\"asset_name\"]}') for x in r]"
```

期望：top 结果 score > 0.7，且内容语义相关

- [ ] **Step 2: 跑全部测试**

```bash
cd apps/qa-service && npx vitest run
```

期望：全部通过

- [ ] **Step 3: 全套验收清单**

- [ ] metadata_field 表有数据（embedding 列非空）
- [ ] POST /api/knowledge/search 返回结果
- [ ] 最高 score > 0.7
- [ ] GET /api/knowledge/documents 列出已同步文档
- [ ] DELETE /api/knowledge/documents/:id 删除后再查询消失

- [ ] **Step 4: 提交**

```bash
git commit --allow-empty -m "chore: acceptance verified — pgvector search operational"
```
