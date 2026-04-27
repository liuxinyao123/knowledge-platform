import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import path from 'node:path'
import fsSync from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPool } from '../services/db.ts'
import { getPgPool } from '../services/pgDb.ts'
import {
  enrichSummariesForSource,
  getDefaultBookstackSourceId,
  parseBookstackPageId,
  refreshKnowledgeLinksForSource,
  syncBookstackAssetsForSource,
} from '../services/assetCatalog.ts'
import { registerUploadedBookstackPage } from '../services/registerUploadedPage.ts'

export const assetDirectoryRouter = Router()

function requireAssetWriter(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers['x-asset-role']
  const role = typeof raw === 'string' ? raw.toLowerCase().trim() : 'admin'
  if (role === 'viewer') {
    res.status(403).json({ error: 'viewer cannot modify assets' })
    return
  }
  next()
}

assetDirectoryRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    module: 'asset-directory',
    registerBookstackPagePath: 'POST /api/asset-directory/register-bookstack-page',
  })
})

assetDirectoryRouter.get('/sources', async (_req, res, next) => {
  try {
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT id, name, source_type AS sourceType, system_name AS systemName, status, asset_count AS assetCount,
              UNIX_TIMESTAMP(updated_at) * 1000 AS updatedAtMs
       FROM asset_source ORDER BY id`,
    )
    res.json({ sources: rows })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.get('/sources/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT id, name, source_type AS sourceType, system_name AS systemName, status, asset_count AS assetCount,
              UNIX_TIMESTAMP(updated_at) * 1000 AS updatedAtMs
       FROM asset_source WHERE id = ?`,
      [id],
    )
    const list = rows as Record<string, unknown>[]
    if (!list.length) {
      res.status(404).json({ error: 'source not found' })
      return
    }
    res.json({ source: list[0] })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.get('/sources/:id/items', async (req, res, next) => {
  try {
    const sourceId = Number(req.params.id)
    if (!Number.isFinite(sourceId)) {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50))) | 0
    const offset = Math.max(0, Number(req.query.offset ?? 0)) | 0
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT id, source_id AS sourceId, external_ref AS externalRef, name, asset_type AS assetType,
              summary_status AS summaryStatus, ingest_status AS ingestStatus,
              UNIX_TIMESTAMP(updated_at) * 1000 AS updatedAtMs
       FROM asset_item WHERE source_id = ? ORDER BY id LIMIT ${limit} OFFSET ${offset}`,
      [sourceId],
    )
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM asset_item WHERE source_id = ?',
      [sourceId],
    )
    const total = Number((countRows as { n: number }[])[0]?.n ?? 0)
    res.json({ items: rows, total, limit, offset })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.get('/items/:itemId', async (req, res, next) => {
  try {
    const itemId = Number(req.params.itemId)
    if (!Number.isFinite(itemId)) {
      res.status(400).json({ error: 'invalid itemId' })
      return
    }
    const pool = getPool()
    const [rows] = await pool.execute(
      `SELECT ai.id, ai.source_id AS sourceId, ai.external_ref AS externalRef, ai.name, ai.asset_type AS assetType,
              ai.summary, ai.summary_status AS summaryStatus, ai.ingest_status AS ingestStatus,
              UNIX_TIMESTAMP(ai.updated_at) * 1000 AS updatedAtMs,
              akl.status AS linkStatus, akl.vector_mapping_id AS vectorMappingId
       FROM asset_item ai
       LEFT JOIN asset_knowledge_link akl ON akl.item_id = ai.id
       WHERE ai.id = ?`,
      [itemId],
    )
    const list = rows as Record<string, unknown>[]
    if (!list.length) {
      res.status(404).json({ error: 'item not found' })
      return
    }
    const row = list[0]
    const pageId = parseBookstackPageId(String(row.externalRef ?? ''))
    let chunkCount = 0
    if (pageId != null) {
      const [cRows] = await pool.execute(
        'SELECT COUNT(*) AS n FROM knowledge_chunks WHERE page_id = ?',
        [pageId],
      )
      chunkCount = Number((cRows as { n: number }[])[0]?.n ?? 0)
    }
    const linkStatus = row.linkStatus != null ? String(row.linkStatus) : null
    const vectorMappingId = row.vectorMappingId != null ? String(row.vectorMappingId) : null
    const { linkStatus: _ls, vectorMappingId: _vm, ...itemRow } = row as Record<string, unknown>
    res.json({
      item: itemRow,
      rag: {
        chunkCount,
        pageId,
        indexed: chunkCount > 0,
        linkStatus,
        vectorMappingId,
      },
      graph: { status: 'not_configured', message: '知识图谱未接入' },
    })
  } catch (e) {
    next(e)
  }
})

/** 入库建页后登记：写入 asset_item、增量 knowledge_chunks、刷新 asset_knowledge_link（与 /api/ingest/register-indexed-page 等价） */
assetDirectoryRouter.post('/register-bookstack-page', async (req, res, next) => {
  try {
    const pageId = Number((req.body as { pageId?: number })?.pageId)
    const summaryRaw = (req.body as { summary?: string })?.summary
    const summary =
      typeof summaryRaw === 'string' && summaryRaw.trim() ? summaryRaw.trim() : undefined
    if (!Number.isFinite(pageId) || pageId <= 0) {
      res.status(400).json({ ok: false, error: 'pageId is required' })
      return
    }
    const pool = getPool()
    const result = await registerUploadedBookstackPage(pool, pageId, { summary })
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

/**
 * 重新索引单个 BookStack 页面（含附件）。
 * ADR-31 · 2026-04-24 · 给用户一个"改代码后不需要重传，直接重跑附件提取"的入口。
 * POST /api/asset-directory/reindex-page  { pageId }
 */
assetDirectoryRouter.post('/reindex-page', requireAssetWriter, async (req, res, next) => {
  try {
    const pageId = Number((req.body as { pageId?: number })?.pageId)
    if (!Number.isFinite(pageId) || pageId <= 0) {
      res.status(400).json({ ok: false, error: 'pageId is required' })
      return
    }
    const { indexBookstackPage } = await import('../services/indexBookstackPage.ts')
    const result = await indexBookstackPage(pageId)
    res.json({ ok: true, pageId, ...result })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.post('/sync-pages', requireAssetWriter, async (req, res, next) => {
  try {
    const pool = getPool()
    let sourceId = Number((req.body as { sourceId?: number })?.sourceId)
    if (!Number.isFinite(sourceId) || sourceId <= 0) {
      const def = await getDefaultBookstackSourceId(pool)
      if (def == null) {
        res.status(400).json({ error: 'no bookstack source' })
        return
      }
      sourceId = def
    }
    const [src] = await pool.execute('SELECT id FROM asset_source WHERE id = ?', [sourceId])
    if (!(src as { id: number }[]).length) {
      res.status(404).json({ error: 'source not found' })
      return
    }
    const out = await syncBookstackAssetsForSource(pool, sourceId)
    const links = await refreshKnowledgeLinksForSource(pool, sourceId)
    res.json({ ok: true, sourceId, ...out, linksUpdated: links.updated })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.post('/refresh-knowledge-links', requireAssetWriter, async (req, res, next) => {
  try {
    const pool = getPool()
    let sourceId = Number((req.body as { sourceId?: number })?.sourceId)
    if (!Number.isFinite(sourceId) || sourceId <= 0) {
      const def = await getDefaultBookstackSourceId(pool)
      if (def == null) {
        res.status(400).json({ error: 'no bookstack source' })
        return
      }
      sourceId = def
    }
    const links = await refreshKnowledgeLinksForSource(pool, sourceId)
    res.json({ ok: true, sourceId, linksUpdated: links.updated })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.post('/enrich-summaries', requireAssetWriter, async (req, res, next) => {
  try {
    const pool = getPool()
    const body = req.body as { sourceId?: number; limit?: number }
    let sourceId = Number(body?.sourceId)
    if (!Number.isFinite(sourceId) || sourceId <= 0) {
      const def = await getDefaultBookstackSourceId(pool)
      if (def == null) {
        res.status(400).json({ error: 'no bookstack source' })
        return
      }
      sourceId = def
    }
    const limit = body?.limit != null ? Number(body.limit) : undefined
    const out = await enrichSummariesForSource(pool, sourceId, { limit })
    res.json({ ok: true, sourceId, ...out })
  } catch (e) {
    next(e)
  }
})

// PRD §10.3 —— 资产详情页数据源（pgvector 侧 metadata_asset）
// 与上面 /items/:itemId（MySQL asset_item）并存；前端 /assets/:id 使用此 pg 端点
assetDirectoryRouter.get('/pg-assets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = getPgPool()
    const limit = Math.min(200, Number(req.query.limit ?? 50))
    const offset = Math.max(0, Number(req.query.offset ?? 0))
    const type = typeof req.query.type === 'string' ? req.query.type : undefined
    const sourceIdRaw = req.query.source_id
    const sourceId = sourceIdRaw != null && sourceIdRaw !== '' ? Number(sourceIdRaw) : undefined
    // space-permissions (ADR 2026-04-23-26)：按空间过滤资产（经由 space_source）
    const spaceIdRaw = req.query.space_id
    const spaceId = spaceIdRaw != null && spaceIdRaw !== '' ? Number(spaceIdRaw) : undefined
    const conds: string[] = ['ma.merged_into IS NULL']
    const params: unknown[] = []
    if (type) { params.push(type); conds.push(`ma.type = $${params.length}`) }
    if (Number.isFinite(sourceId)) {
      params.push(sourceId)
      conds.push(`ma.source_id = $${params.length}`)
    }
    if (Number.isFinite(spaceId)) {
      params.push(spaceId)
      conds.push(`ma.source_id IN (SELECT source_id FROM space_source WHERE space_id = $${params.length})`)
    }
    const where = `WHERE ${conds.join(' AND ')}`
    const { rows } = await pool.query(
      `SELECT ma.id, ma.name, ma.type, ma.tags, ma.indexed_at,
              ms.name AS source_name, ms.connector,
              (SELECT COUNT(*) FROM metadata_field mf WHERE mf.asset_id = ma.id) AS chunks_total,
              (SELECT COUNT(*) FROM metadata_asset_image mai WHERE mai.asset_id = ma.id) AS images_total
       FROM metadata_asset ma
       LEFT JOIN metadata_source ms ON ms.id = ma.source_id
       ${where}
       ORDER BY ma.indexed_at DESC NULLS LAST, ma.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    )
    const { rows: cntRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM metadata_asset ma ${where}`, params,
    )
    res.json({
      items: rows,
      total: Number(cntRows[0].n),
    })
  } catch (e) {
    next(e)
  }
})

// PRD §10 —— 数据源列表（PG metadata_source + 资产数）
assetDirectoryRouter.get('/pg-sources', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT ms.id, ms.name, ms.type, ms.connector, ms.status,
              EXTRACT(EPOCH FROM ms.created_at) * 1000 AS created_at_ms,
              COUNT(ma.id) FILTER (WHERE ma.merged_into IS NULL)::int AS asset_count
       FROM metadata_source ms
       LEFT JOIN metadata_asset ma ON ma.source_id = ms.id
       GROUP BY ms.id
       ORDER BY ms.id ASC`,
    )
    res.json({ sources: rows })
  } catch (e) {
    next(e)
  }
})

// PRD §10 —— 创建空间（数据源）
//   body: { name (required), description?, type? = 'document', connector? = 'manual' }
assetDirectoryRouter.post('/pg-sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as {
      name?: unknown; description?: unknown; type?: unknown; connector?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return res.status(400).json({ error: 'name required' })
    if (name.length > 256) return res.status(400).json({ error: 'name too long (≤ 256)' })

    const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'document'
    const connector = typeof body.connector === 'string' && body.connector.trim()
      ? body.connector.trim() : 'manual'
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const config: Record<string, unknown> = {}
    if (description) config.description = description

    const pool = getPgPool()
    // 软去重：name 相同则报 409
    const { rows: dup } = await pool.query(
      `SELECT id FROM metadata_source WHERE name = $1 LIMIT 1`,
      [name],
    )
    if (dup.length > 0) {
      return res.status(409).json({ error: 'name already exists', id: Number(dup[0].id) })
    }
    const { rows } = await pool.query(
      `INSERT INTO metadata_source (name, type, connector, config, status)
       VALUES ($1, $2, $3, $4::jsonb, 'active')
       RETURNING id, name, type, connector, status,
                 EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms`,
      [name, type, connector, JSON.stringify(config)],
    )
    const row = rows[0]
    res.status(201).json({
      id: Number(row.id),
      name: row.name,
      type: row.type,
      connector: row.connector,
      status: row.status,
      asset_count: 0,
      created_at_ms: row.created_at_ms,
    })
  } catch (e) {
    next(e)
  }
})

assetDirectoryRouter.get('/pg-assets/:id/detail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const pool = getPgPool()

    const { rows: assetRows } = await pool.query(
      `SELECT ma.id, ma.name, ma.type, ma.path, ma.tags, ma.indexed_at, ma.author, ma.merged_into,
              ma.extractor_id, ma.ingest_warnings, ma.ingest_chunks_by_kind, ma.external_path,
              ms.id AS source_id, ms.name AS source_name, ms.type AS source_type, ms.connector
       FROM metadata_asset ma
       LEFT JOIN metadata_source ms ON ms.id = ma.source_id
       WHERE ma.id = $1`,
      [id],
    )
    if (!assetRows[0]) {
      res.status(404).json({ error: 'not found' })
      return
    }
    const a = assetRows[0]

    const { rows: headings } = await pool.query(
      `SELECT page, content AS text, heading_path
       FROM metadata_field
       WHERE asset_id = $1 AND chunk_level = 1
       ORDER BY page, chunk_index
       LIMIT 200`,
      [id],
    )
    const { rows: samples } = await pool.query(
      `SELECT page, content AS text, kind
       FROM metadata_field
       WHERE asset_id = $1 AND chunk_level = 3
       ORDER BY chunk_index
       LIMIT 10`,
      [id],
    )
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM metadata_field WHERE asset_id = $1`, [id],
    )
    const { rows: images } = await pool.query(
      `SELECT id, page, image_index, caption, file_path
       FROM metadata_asset_image WHERE asset_id = $1
       ORDER BY page, image_index LIMIT 30`,
      [id],
    )

    // Neo4j 图谱：mock（Q3=c，真接入留后续 change）
    const graph = buildMockGraph(a.name as string, Number(a.source_id ?? 0))

    // ADR-32 · 解析诊断信息（用户可见）
    let ingestWarnings: string[] = []
    if (typeof a.ingest_warnings === 'string' && a.ingest_warnings) {
      try {
        const parsed = JSON.parse(a.ingest_warnings) as unknown
        if (Array.isArray(parsed)) ingestWarnings = parsed.map(String)
      } catch { /* keep [] */ }
    }

    res.json({
      asset: {
        id: Number(a.id),
        name: a.name,
        type: a.type,
        path: a.path,
        tags: a.tags ?? [],
        indexed_at: a.indexed_at,
        author: a.author,
        merged_into: a.merged_into,
        // ADR-32 诊断字段
        extractor_id: a.extractor_id ?? null,
        ingest_warnings: ingestWarnings,
        ingest_chunks_by_kind: a.ingest_chunks_by_kind ?? null,
        external_path: a.external_path ?? null,
      },
      source: {
        id: Number(a.source_id ?? 0),
        name: a.source_name,
        type: a.source_type,
        connector: a.connector,
      },
      chunks: {
        headings,
        samples,
        total: Number(totalRows[0].n),
      },
      images,
      graph,
    })
  } catch (e) {
    next(e)
  }
})

function buildMockGraph(assetName: string, sourceId: number): {
  nodes: Array<{ id: string; label: string; count?: number; type: 'entity' | 'template' }>
  edges: Array<{ from: string; to: string; label: string; kind: 'fk' | 'logical' }>
} {
  // 演示用硬编码（PRD §10.3.3 风格）
  return {
    nodes: [
      { id: 'asset', label: assetName, count: 1200, type: 'entity' },
      { id: 'supplier', label: '供应商主表', count: 42, type: 'entity' },
      { id: 'material', label: '物料主表', count: 8000, type: 'entity' },
      { id: 'payment', label: '付款记录表', count: 90000, type: 'entity' },
      { id: 'contract', label: '合同模板', type: 'template' },
    ],
    edges: [
      { from: 'supplier', to: 'asset', label: 'supplier_id FK', kind: 'fk' },
      { from: 'asset', to: 'material', label: 'material_id FK', kind: 'fk' },
      { from: 'asset', to: 'payment', label: 'po_id FK', kind: 'fk' },
      { from: 'contract', to: 'supplier', label: '业务关联', kind: 'logical' },
    ],
  }
}

// PRD §10.3 —— 资产图片二进制流
//   GET /api/asset-directory/asset-images/:imageId
//
//   实现：从 metadata_asset_image 取 file_path（仓库相对路径），
//   解析到绝对路径后流式返回。做路径越界防御 + 简单 MIME 推断。
//
//   注意：该路由跟整个 /asset-directory 一致目前未挂 requireAuth；
//   如要加权限请整片加上。
assetDirectoryRouter.get('/asset-images/:imageId', async (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId)
  if (!Number.isFinite(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'invalid imageId' })
  }
  try {
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT file_path FROM metadata_asset_image WHERE id = $1 LIMIT 1`,
      [imageId],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'image not found' })
    const relPath = String(rows[0].file_path ?? '')
    if (!relPath) return res.status(404).json({ error: 'image has no file_path' })

    // 解析根：与 imageStore.ts 同源 —— 默认 {repo}/infra/asset_images，可被 ASSET_IMAGE_ROOT 覆盖
    // file_path 是仓库相对路径（infra/asset_images/<assetId>/<page>-<idx>.<ext>），
    // 直接 join 仓库根即可。
    const here = fileURLToPath(import.meta.url)
    const repoRoot = path.resolve(here, '../../../../..')
    const envRoot = process.env.ASSET_IMAGE_ROOT?.trim()
    const imageRoot = envRoot
      ? (path.isAbsolute(envRoot) ? envRoot : path.resolve(repoRoot, envRoot))
      : path.resolve(repoRoot, 'infra/asset_images')

    // file_path 可能是 "infra/asset_images/27/1-0.png"（默认）或 "27/1-0.png"（env 覆盖时）
    // 优先按"完整仓库相对"解析；fallback 到"相对 imageRoot"
    let absPath = path.resolve(repoRoot, relPath)
    if (!fsSync.existsSync(absPath)) {
      absPath = path.resolve(imageRoot, relPath)
    }

    // 防穿透：解析后必须仍在 imageRoot 之下
    const normRoot = path.resolve(imageRoot)
    if (!absPath.startsWith(normRoot + path.sep) && absPath !== normRoot) {
      return res.status(403).json({ error: 'path escapes image root' })
    }
    if (!fsSync.existsSync(absPath)) {
      return res.status(404).json({ error: 'image file missing on disk', path: relPath })
    }

    const ext = path.extname(absPath).toLowerCase()
    const mime =
      ext === '.png'  ? 'image/png'  :
      ext === '.jpg'  ? 'image/jpeg' :
      ext === '.jpeg' ? 'image/jpeg' :
      ext === '.gif'  ? 'image/gif'  :
      ext === '.webp' ? 'image/webp' :
      'application/octet-stream'

    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fsSync.createReadStream(absPath)
      .on('error', () => res.status(500).end())
      .pipe(res)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' })
  }
})

assetDirectoryRouter.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : 'asset-directory error'
    res.status(500).json({ error: msg })
  },
)
