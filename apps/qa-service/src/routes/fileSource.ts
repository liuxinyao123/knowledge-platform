/**
 * routes/fileSource.ts —— 外部文件服务器接入的 HTTP API
 *
 * 门：requireAuth + enforceAcl({ requiredPermission: 'iam:manage' })
 * 契约：openspec/changes/file-source-integration/specs/file-source-api-spec.md
 */
import { Router, type Request, type Response } from 'express'
import { getPgPool } from '../services/pgDb.ts'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { runScan, testConnection, loadSourceRow, isScanRunning } from '../services/fileSource/index.ts'
import { encryptConfig, mergeConfigForPatch, redactConfig } from '../services/fileSource/crypto.ts'
import { rescheduleOne, unschedule } from '../services/fileSource/scheduler.ts'
import { createRequire } from 'node:module'

export const fileSourceRouter = Router()

const ALLOWED_TYPES = new Set(['smb', 's3', 'webdav', 'sftp'])

function err(res: Response, status: number, code: string, message: string): Response {
  return res.status(status).json({ error: { code, message } })
}

function validateCron(expr: string): boolean {
  if (expr === '@manual') return true
  try {
    const req = createRequire(import.meta.url)
    const cron = req('node-cron') as { validate: (e: string) => boolean }
    return cron.validate(expr)
  } catch {
    // node-cron 未装：放过合理形状的表达式，由 scheduler 兜底跳过非法
    return /^(\S+\s+){4}\S+$/.test(expr.trim())
  }
}

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  if (out.config_json && typeof out.config_json === 'object') {
    out.config_json = redactConfig(out.config_json as Record<string, unknown>)
  }
  return out
}

fileSourceRouter.use(requireAuth())
fileSourceRouter.use(enforceAcl({ requiredPermission: 'iam:manage' }))

// ── POST / —— 创建 ────────────────────────────────────────────────────────
fileSourceRouter.post('/', async (req: Request, res: Response) => {
  const { type, name, config_json, cron = '@manual', permission_source_id, enabled = true } = req.body ?? {}
  if (!type || !ALLOWED_TYPES.has(type)) return err(res, 400, 'invalid_file_source_type', `type must be one of ${[...ALLOWED_TYPES].join(',')}`)
  if (!name || typeof name !== 'string') return err(res, 400, 'invalid_name', 'name required')
  if (!config_json || typeof config_json !== 'object') return err(res, 400, 'invalid_config_json', 'config_json required')
  if (!validateCron(String(cron))) return err(res, 400, 'invalid_cron', `cron invalid: ${cron}`)

  const pool = getPgPool()
  if (permission_source_id != null) {
    const { rows } = await pool.query(`SELECT id FROM metadata_source WHERE id = $1`, [permission_source_id])
    if (!rows.length) return err(res, 400, 'permission_source_id_not_found', `no metadata_source id=${permission_source_id}`)
  }

  let encrypted: Record<string, unknown>
  try {
    encrypted = encryptConfig(config_json as Record<string, unknown>)
  } catch (e) {
    return err(res, 503, 'master_encrypt_key_missing', (e as Error).message)
  }

  const { rows } = await pool.query(
    `INSERT INTO metadata_file_source (type, name, config_json, cron, permission_source_id, enabled)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING *`,
    [type, name, JSON.stringify(encrypted), cron, permission_source_id ?? null, !!enabled],
  )
  const row = rows[0]
  if (enabled && cron !== '@manual') rescheduleOne(row.id, cron, true)
  res.status(201).json(redactRow(row))
})

// ── GET / —— 列表 ────────────────────────────────────────────────────────
fileSourceRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)
  const pool = getPgPool()
  const [{ rows: items }, { rows: [cnt] }] = await Promise.all([
    pool.query(
      `SELECT id, type, name, config_json, cron, last_scan_status, last_scan_at, last_scan_error,
              permission_source_id, enabled, created_at, updated_at
       FROM metadata_file_source ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM metadata_file_source`),
  ])
  res.setHeader('X-Total-Count', String(cnt.n))
  res.json({ items: items.map(redactRow) })
})

// ── GET /:id —— 详情 ─────────────────────────────────────────────────────
fileSourceRouter.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const pool = getPgPool()
  const { rows } = await pool.query(`SELECT * FROM metadata_file_source WHERE id = $1`, [id])
  if (!rows.length) return err(res, 404, 'not_found', `no file source id=${id}`)
  res.json(redactRow(rows[0]))
})

// ── PATCH /:id —— 更新 ──────────────────────────────────────────────────
fileSourceRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const body = req.body ?? {}
  if ('last_cursor' in body) return err(res, 400, 'immutable_field', 'last_cursor is set by scheduler only')
  if ('id' in body) return err(res, 400, 'immutable_field', 'id is immutable')

  const pool = getPgPool()
  const cur = (await pool.query(`SELECT * FROM metadata_file_source WHERE id = $1`, [id])).rows[0]
  if (!cur) return err(res, 404, 'not_found', `no file source id=${id}`)

  const updates: string[] = []
  const params: unknown[] = []
  let i = 1

  if ('name' in body) { updates.push(`name = $${i++}`); params.push(body.name) }
  if ('cron' in body) {
    if (!validateCron(String(body.cron))) return err(res, 400, 'invalid_cron', `cron invalid: ${body.cron}`)
    updates.push(`cron = $${i++}`); params.push(body.cron)
  }
  if ('enabled' in body) { updates.push(`enabled = $${i++}`); params.push(!!body.enabled) }
  if ('permission_source_id' in body) {
    if (body.permission_source_id != null) {
      const { rows } = await pool.query(`SELECT id FROM metadata_source WHERE id = $1`, [body.permission_source_id])
      if (!rows.length) return err(res, 400, 'permission_source_id_not_found', `no metadata_source id=${body.permission_source_id}`)
    }
    updates.push(`permission_source_id = $${i++}`); params.push(body.permission_source_id)
  }
  if ('config_json' in body && typeof body.config_json === 'object' && body.config_json !== null) {
    const merged = mergeConfigForPatch(cur.config_json, body.config_json as Record<string, unknown>)
    updates.push(`config_json = $${i++}::jsonb`); params.push(JSON.stringify(merged))
  }
  if (updates.length === 0) return err(res, 400, 'no_fields', 'no updatable fields')

  updates.push(`updated_at = NOW()`)
  params.push(id)
  const { rows } = await pool.query(
    `UPDATE metadata_file_source SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  )
  const row = rows[0]
  rescheduleOne(row.id, row.cron, row.enabled)
  res.json(redactRow(row))
})

// ── DELETE /:id ──────────────────────────────────────────────────────────
fileSourceRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const pool = getPgPool()
  const { rowCount } = await pool.query(`DELETE FROM metadata_file_source WHERE id = $1`, [id])
  if (!rowCount) return err(res, 404, 'not_found', `no file source id=${id}`)
  unschedule(id)
  res.status(204).end()
})

// ── POST /:id/scan —— 立即扫 ────────────────────────────────────────────
fileSourceRouter.post('/:id/scan', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const row = await loadSourceRow(id)
  if (!row) return err(res, 404, 'not_found', `no file source id=${id}`)
  if (!row.enabled) return err(res, 409, 'source_disabled', 'enable source first')

  if (isScanRunning(id)) {
    return res.status(202).json({ scan_log_id: null, status: 'already_running' })
  }
  // fire-and-forget；scan 写 log 表，API 立即返回
  void runScan(id).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(`[fileSource] scan ${id} failed: ${(e as Error).message}`)
  })
  res.status(202).json({ scan_log_id: null, status: 'queued' })
})

// ── GET /:id/logs ────────────────────────────────────────────────────────
fileSourceRouter.get('/:id/logs', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const limit = Math.min(Number(req.query.limit ?? 20), 100)
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, source_id, started_at, finished_at, status,
            added_count, updated_count, removed_count, failed_items, error_message
     FROM file_source_scan_log
     WHERE source_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [id, limit],
  )
  res.json({ items: rows })
})

// ── POST /:id/test —— 试连 ──────────────────────────────────────────────
fileSourceRouter.post('/:id/test', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return err(res, 400, 'invalid_id', 'id must be integer')
  const r = await testConnection(id)
  res.json(r)
})
