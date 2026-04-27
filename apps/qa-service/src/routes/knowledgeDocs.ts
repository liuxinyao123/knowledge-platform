import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { getPgPool } from '../services/pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from '../services/embeddings.ts'
import { chunkDocument } from '../services/chunkDocument.ts'
import { searchKnowledgeChunks, EmbeddingNotConfiguredError } from '../services/knowledgeSearch.ts'
import { requireAuth, enforceAcl, shapeResultByAcl } from '../auth/index.ts'
import { ingestDocument } from '../services/ingestPipeline/index.ts'
import { decodeUploadedFilename } from '../services/fileName.ts'
import { writeAudit } from '../services/audit.ts'

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
//
// 2026-04-24 ADR-30 · 加固：
//   · requireAuth + enforceAcl DELETE（之前无鉴权，任意请求都能删）
//   · 按 (source_id) 判权，未来可扩资产级精准权限
//   · metadata_field / metadata_asset_image 走 FK ON DELETE CASCADE（见 pgDb.ts）
//   · 磁盘图片 `infra/asset_images/{assetId}/` best-effort 清理
//   · 写审计 audit_log（action: 'asset_delete'）
knowledgeDocsRouter.delete(
  '/documents/:id',
  requireAuth(),
  // ACL 判权：先查 asset 的 source_id；不存在则放过（下面主逻辑再返 404）
  enforceAcl({
    action: 'DELETE',
    resourceExtractor: async (req) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return {}
      const pool = getPgPool()
      const { rows } = await pool.query<{ source_id: number | null }>(
        'SELECT source_id FROM metadata_asset WHERE id = $1',
        [id],
      )
      const sourceId = rows[0]?.source_id
      return sourceId != null ? { source_id: Number(sourceId) } : {}
    },
  }),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return }

    const pool = getPgPool()
    // 取 name/source_id 用于审计 + 错误消息；一次查询完所需字段
    const pre = await pool.query<{ name: string; source_id: number | null }>(
      'SELECT name, source_id FROM metadata_asset WHERE id = $1',
      [id],
    )
    if (pre.rowCount === 0) { res.status(404).json({ error: 'not found' }); return }
    const assetName = pre.rows[0].name
    const sourceId = pre.rows[0].source_id

    // ingest-async-pipeline · ADR-30 联动（2026-04-25 ADR-40 Follow-up #4）：
    // 把该 asset 仍在排队 / 进行中的 ingest_job 标 cancelled，让 worker 在下次 cancel
    // 探测中（CANCEL_POLL_INTERVAL_MS=1s）抛 JobCancelledError 中止 pipeline。
    // **必须**在 DELETE metadata_asset 之前执行：FK ON DELETE SET NULL 会清掉
    // ingest_job.asset_id，丢失关联线索。Best-effort：失败只 WARN 不阻塞 DELETE。
    let cancelledJobs = 0
    try {
      const upd = await pool.query(
        `UPDATE ingest_job
            SET status = 'cancelled',
                updated_at = NOW(),
                error = COALESCE(error, 'asset deleted while job in flight')
          WHERE asset_id = $1
            AND status IN ('queued', 'in_progress')`,
        [id],
      )
      cancelledJobs = upd.rowCount ?? 0
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[asset_delete] cancel-pending-jobs failed for asset=${id}:`, (err as Error).message)
    }

    // 主删除：FK 级联会带走 metadata_field / metadata_asset_image
    const { rowCount } = await pool.query('DELETE FROM metadata_asset WHERE id = $1', [id])
    if (!rowCount) { res.status(404).json({ error: 'not found' }); return }

    // 磁盘图片目录 best-effort 清理；失败不阻塞
    const imageDir = path.resolve(process.cwd(), 'infra', 'asset_images', String(id))
    try {
      await rm(imageDir, { recursive: true, force: true })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[asset_delete] image dir cleanup failed for asset=${id}:`, e)
    }

    // 审计
    await writeAudit({
      action: 'asset_delete',
      targetType: 'asset',
      targetId: id,
      detail: { name: assetName, sourceId, cancelledJobs },
      principal: req.principal,
    })

    res.json({ ok: true, deleted: { id, name: assetName }, cancelledJobs })
  },
)

// POST /api/knowledge/ingest
knowledgeDocsRouter.post(
  '/ingest',
  requireAuth(),
  enforceAcl({
    action: 'WRITE',
    resourceExtractor: (req) => ({
      source_id: Number((req.body ?? {}).source_id ?? 1),
    }),
  }),
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'file required' }); return }
    if (!isEmbeddingConfigured()) { res.status(503).json({ error: 'embedding not configured' }); return }

    const sourceId = Number(req.body.source_id ?? 1)
    const out = await ingestDocument({
      buffer: req.file.buffer,
      name: decodeUploadedFilename(req.file.originalname),
      sourceId,
      principal: req.principal,
    })
    res.json(out)
  },
)

// POST /api/knowledge/search
knowledgeDocsRouter.post(
  '/search',
  requireAuth(),
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => {
      const sids = (req.body ?? {}).source_ids
      const sid = Array.isArray(sids) && sids.length === 1 ? Number(sids[0]) : undefined
      return { source_id: typeof sid === 'number' && Number.isFinite(sid) ? sid : undefined }
    },
  }),
  async (req: Request, res: Response) => {
    const { query, source_ids, top_k = 10 } = req.body as {
      query?: string; source_ids?: number[]; top_k?: number
    }
    if (!query?.trim()) { res.status(400).json({ error: 'query required' }); return }

    try {
      const results = await searchKnowledgeChunks({
        query, source_ids, top_k,
        aclFilter: req.aclFilter,
      })
      const shaped = shapeResultByAcl(req.aclDecision, results)
      res.json({ results: shaped })
    } catch (err) {
      if (err instanceof EmbeddingNotConfiguredError) {
        res.status(503).json({ error: 'embedding not configured' })
        return
      }
      throw err
    }
  },
)
