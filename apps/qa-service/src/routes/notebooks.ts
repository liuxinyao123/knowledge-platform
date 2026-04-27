/**
 * routes/notebooks.ts —— Notebook V1
 *
 * 端点（统一 requireAuth；写/读 owner 限定）：
 *   GET    /                                    list (owner only)
 *   POST   /                                    create
 *   GET    /:id                                 detail（meta + sources + 最近 N msg）
 *   PATCH  /:id                                 改名/改述
 *   DELETE /:id                                 删除（级联）
 *
 *   POST   /:id/sources                         加 sources
 *   DELETE /:id/sources/:assetId                移除
 *
 *   GET    /:id/messages                        所有历史
 *   DELETE /:id/messages                        清空
 *   POST   /:id/chat (SSE)                      发问 + 流式回答 + 自动入库
 *
 *   GET    /:id/artifacts                       列 artifact
 *   POST   /:id/artifacts/:kind                 触发生成（briefing/faq）
 *   GET    /:id/artifacts/:artifactId           读详情
 *   DELETE /:id/artifacts/:artifactId           删除
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { requireAuth } from '../auth/index.ts'
import { getPgPool } from '../services/pgDb.ts'
import { streamNotebookChat } from '../services/notebookChat.ts'
import { executeArtifact, type ArtifactKind } from '../services/artifactGenerator.ts'

export const notebooksRouter = Router()

notebooksRouter.use(requireAuth())

// ── helper: 取 owner 或 404/403 ──────────────────────────────────────────────

type NotebookAccess = {
  id: number
  owner_email: string
  name: string
  /** 'owner' | 'editor' | 'reader' */
  access: 'owner' | 'editor' | 'reader'
}

/** 老接口：仅 owner 能访问 —— 用于删除 notebook、改名等敏感操作 */
async function loadOwnedNotebook(req: Request, res: Response, idStr: string) {
  const acc = await loadAccessibleNotebook(req, res, idStr, 'owner')
  return acc
}

/**
 * Permissions V2：可访问性判定
 *   - notebook owner_email == principal.email → 'owner'
 *   - notebook_member 命中（user/team） → 'editor' or 'reader' 按 role
 *   - 否则 → 403
 *
 * @param need 'read' = reader/editor/owner 都行；'write' = editor/owner；'owner' = 只 owner
 */
async function loadAccessibleNotebook(
  req: Request, res: Response, idStr: string,
  need: 'read' | 'write' | 'owner' = 'read',
): Promise<NotebookAccess | null> {
  const id = Number(idStr)
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return null }
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, owner_email, name FROM notebook WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'notebook not found' }); return null }
  const ownerEmail = String(rows[0].owner_email)
  const userEmail = req.principal?.email ?? ''

  // owner
  if (userEmail && userEmail === ownerEmail) {
    return { id, owner_email: ownerEmail, name: String(rows[0].name), access: 'owner' }
  }
  // 走共享：从 notebook_member 找匹配 (user / team)
  const teamIds = req.principal?.team_ids ?? []
  const params: unknown[] = [id]
  const orParts: string[] = []
  if (userEmail) { params.push(userEmail); orParts.push(`(subject_type='user' AND subject_id = $${params.length})`) }
  if (teamIds.length > 0) {
    params.push(teamIds)
    orParts.push(`(subject_type='team' AND subject_id = ANY($${params.length}::text[]))`)
  }
  if (orParts.length === 0) { res.status(403).json({ error: 'not accessible' }); return null }
  const { rows: mr } = await pool.query(
    `SELECT role FROM notebook_member
     WHERE notebook_id = $1 AND (${orParts.join(' OR ')})
     ORDER BY CASE role WHEN 'editor' THEN 1 WHEN 'reader' THEN 2 ELSE 3 END LIMIT 1`,
    params,
  )
  if (mr.length === 0) { res.status(403).json({ error: 'not accessible' }); return null }
  const access: 'editor' | 'reader' = mr[0].role === 'editor' ? 'editor' : 'reader'

  if (need === 'owner') { res.status(403).json({ error: 'owner only' }); return null }
  if (need === 'write' && access !== 'editor') {
    res.status(403).json({ error: 'editor or owner required' }); return null
  }
  return { id, owner_email: ownerEmail, name: String(rows[0].name), access }
}

// ── notebooks CRUD ──────────────────────────────────────────────────────────

notebooksRouter.get('/', async (req: Request, res: Response) => {
  const email = req.principal?.email
  if (!email) return res.status(401).json({ error: 'unauthenticated' })
  const teamIds = req.principal?.team_ids ?? []
  const pool = getPgPool()

  // 「我的」
  const { rows: ownRows } = await pool.query(
    `SELECT n.id, n.name, n.description, n.owner_email, 'owner' AS access,
            EXTRACT(EPOCH FROM n.created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM n.updated_at) * 1000 AS updated_at_ms,
            (SELECT COUNT(*)::int FROM notebook_source ns WHERE ns.notebook_id = n.id) AS source_count,
            (SELECT COUNT(*)::int FROM notebook_chat_message m WHERE m.notebook_id = n.id) AS message_count
     FROM notebook n
     WHERE n.owner_email = $1
     ORDER BY n.updated_at DESC, n.id DESC`,
    [email],
  )

  // 「共享给我的」(去掉 owner 自己)
  const sharedParams: unknown[] = [email]
  const orParts: string[] = [`(nm.subject_type='user' AND nm.subject_id = $1)`]
  if (teamIds.length > 0) {
    sharedParams.push(teamIds)
    orParts.push(`(nm.subject_type='team' AND nm.subject_id = ANY($${sharedParams.length}::text[]))`)
  }
  sharedParams.push(email)  // 排除 owner
  const { rows: sharedRows } = await pool.query(
    `SELECT n.id, n.name, n.description, n.owner_email,
            CASE WHEN MAX(CASE WHEN nm.role='editor' THEN 1 ELSE 0 END) = 1 THEN 'editor' ELSE 'reader' END AS access,
            EXTRACT(EPOCH FROM n.created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM n.updated_at) * 1000 AS updated_at_ms,
            (SELECT COUNT(*)::int FROM notebook_source ns WHERE ns.notebook_id = n.id) AS source_count,
            (SELECT COUNT(*)::int FROM notebook_chat_message m WHERE m.notebook_id = n.id) AS message_count
     FROM notebook n
     JOIN notebook_member nm ON nm.notebook_id = n.id
     WHERE (${orParts.join(' OR ')})
       AND n.owner_email <> $${sharedParams.length}
     GROUP BY n.id
     ORDER BY n.updated_at DESC, n.id DESC`,
    sharedParams,
  )

  res.json({ items: ownRows, shared: sharedRows })
})

notebooksRouter.post('/', async (req: Request, res: Response) => {
  const email = req.principal?.email
  if (!email) return res.status(401).json({ error: 'unauthenticated' })
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name required' })
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const pool = getPgPool()
  const { rows } = await pool.query(
    `INSERT INTO notebook (name, description, owner_email)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, owner_email,
               EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms`,
    [name, description, email],
  )
  res.status(201).json(rows[0])
})

notebooksRouter.get('/:id', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const pool = getPgPool()
  const { rows: srcRows } = await pool.query(
    `SELECT ns.asset_id, ma.name AS asset_name, ma.type, ma.tags,
            ma.indexed_at, ma.path,
            EXTRACT(EPOCH FROM ns.added_at) * 1000 AS added_at_ms,
            (SELECT COUNT(*)::int FROM metadata_field mf WHERE mf.asset_id = ma.id) AS chunks_total
     FROM notebook_source ns
     JOIN metadata_asset ma ON ma.id = ns.asset_id
     WHERE ns.notebook_id = $1
     ORDER BY ns.added_at DESC`,
    [nb.id],
  )
  const { rows: msgRows } = await pool.query(
    `SELECT id, role, content, citations, trace,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms
     FROM notebook_chat_message
     WHERE notebook_id = $1
     ORDER BY id ASC`,
    [nb.id],
  )
  const { rows: nbRow } = await pool.query(
    `SELECT id, name, description, owner_email,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_ms
     FROM notebook WHERE id = $1`,
    [nb.id],
  )
  res.json({ notebook: nbRow[0], sources: srcRows, messages: msgRows })
})

notebooksRouter.patch('/:id', async (req: Request, res: Response) => {
  const nb = await loadOwnedNotebook(req, res, String(req.params.id))
  if (!nb) return
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.name === 'string') { params.push(body.name.trim()); sets.push(`name = $${params.length}`) }
  if (typeof body.description === 'string') { params.push(body.description.trim()); sets.push(`description = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  sets.push(`updated_at = NOW()`)
  params.push(nb.id)
  const pool = getPgPool()
  await pool.query(`UPDATE notebook SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
  res.json({ ok: true })
})

notebooksRouter.delete('/:id', async (req: Request, res: Response) => {
  const nb = await loadOwnedNotebook(req, res, String(req.params.id))
  if (!nb) return
  const pool = getPgPool()
  await pool.query(`DELETE FROM notebook WHERE id = $1`, [nb.id])
  res.json({ ok: true })
})

// ── sources ─────────────────────────────────────────────────────────────────

notebooksRouter.post('/:id/sources', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'write')
  if (!nb) return
  const body = (req.body ?? {}) as { asset_ids?: unknown }
  const ids = sanitizeIds(body.asset_ids)
  if (ids.length === 0) return res.status(400).json({ error: 'asset_ids required (number[])' })
  const pool = getPgPool()
  let inserted = 0
  for (const aid of ids) {
    const r = await pool.query(
      `INSERT INTO notebook_source (notebook_id, asset_id) VALUES ($1, $2)
       ON CONFLICT (notebook_id, asset_id) DO NOTHING`,
      [nb.id, aid],
    )
    if (r.rowCount) inserted++
  }
  await pool.query(`UPDATE notebook SET updated_at = NOW() WHERE id = $1`, [nb.id])
  res.status(201).json({ inserted, total: ids.length })
})

notebooksRouter.delete('/:id/sources/:assetId', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'write')
  if (!nb) return
  const aid = Number(req.params.assetId)
  if (!Number.isFinite(aid)) return res.status(400).json({ error: 'invalid assetId' })
  const pool = getPgPool()
  const { rowCount } = await pool.query(
    `DELETE FROM notebook_source WHERE notebook_id = $1 AND asset_id = $2`,
    [nb.id, aid],
  )
  await pool.query(`UPDATE notebook SET updated_at = NOW() WHERE id = $1`, [nb.id])
  res.json({ ok: true, removed: rowCount ?? 0 })
})

// ── messages ────────────────────────────────────────────────────────────────

notebooksRouter.get('/:id/messages', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, role, content, citations, trace,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms
     FROM notebook_chat_message
     WHERE notebook_id = $1
     ORDER BY id ASC`,
    [nb.id],
  )
  res.json({ items: rows })
})

notebooksRouter.delete('/:id/messages', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'write')
  if (!nb) return
  const pool = getPgPool()
  await pool.query(`DELETE FROM notebook_chat_message WHERE notebook_id = $1`, [nb.id])
  res.json({ ok: true })
})

// ── chat (SSE) ──────────────────────────────────────────────────────────────

notebooksRouter.post('/:id/chat', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const body = (req.body ?? {}) as { question?: unknown }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return res.status(400).json({ error: 'question required' })
  await streamNotebookChat({
    notebookId: nb.id,
    question,
    ownerEmail: nb.owner_email,
    res, req,
  })
})

// ── artifacts ───────────────────────────────────────────────────────────────

notebooksRouter.get('/:id/artifacts', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, kind, status, content, meta, error, created_by,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM finished_at) * 1000 AS finished_at_ms
     FROM notebook_artifact
     WHERE notebook_id = $1
     ORDER BY id DESC`,
    [nb.id],
  )
  res.json({ items: rows })
})

notebooksRouter.post('/:id/artifacts/:kind', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'write')
  if (!nb) return
  const kindRaw = String(req.params.kind)
  if (kindRaw !== 'briefing' && kindRaw !== 'faq') {
    return res.status(400).json({ error: 'kind must be briefing or faq' })
  }
  const kind = kindRaw as ArtifactKind
  const pool = getPgPool()
  // 校验 source 不为空
  const { rows: srcCount } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notebook_source WHERE notebook_id = $1`,
    [nb.id],
  )
  if (Number(srcCount[0]?.n ?? 0) === 0) {
    return res.status(400).json({ error: 'notebook 无任何 source；请先添加资料' })
  }
  const { rows } = await pool.query(
    `INSERT INTO notebook_artifact (notebook_id, kind, status, created_by)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id`,
    [nb.id, kind, req.principal?.email ?? null],
  )
  const artifactId = Number(rows[0].id)
  res.status(202).json({ artifactId })
  // fire-and-forget
  void executeArtifact(artifactId, kind).catch(async (err) => {
    try {
      await pool.query(
        `UPDATE notebook_artifact SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
        [artifactId, `runner crashed: ${err instanceof Error ? err.message : 'unknown'}`],
      )
    } catch { /* */ }
  })
})

notebooksRouter.get('/:id/artifacts/:artifactId', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const aid = Number(req.params.artifactId)
  if (!Number.isFinite(aid)) return res.status(400).json({ error: 'invalid artifactId' })
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, kind, status, content, meta, error, created_by,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM finished_at) * 1000 AS finished_at_ms
     FROM notebook_artifact
     WHERE id = $1 AND notebook_id = $2`,
    [aid, nb.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json(rows[0])
})

notebooksRouter.delete('/:id/artifacts/:artifactId', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'write')
  if (!nb) return
  const aid = Number(req.params.artifactId)
  if (!Number.isFinite(aid)) return res.status(400).json({ error: 'invalid artifactId' })
  const pool = getPgPool()
  await pool.query(
    `DELETE FROM notebook_artifact WHERE id = $1 AND notebook_id = $2`,
    [aid, nb.id],
  )
  res.json({ ok: true })
})

// ── members（共享） ─────────────────────────────────────────────────────────

notebooksRouter.get('/:id/members', async (req: Request, res: Response) => {
  const nb = await loadAccessibleNotebook(req, res, String(req.params.id), 'read')
  if (!nb) return
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT subject_type, subject_id, role, added_by,
            EXTRACT(EPOCH FROM added_at) * 1000 AS added_at_ms
     FROM notebook_member
     WHERE notebook_id = $1
     ORDER BY added_at DESC`,
    [nb.id],
  )
  // 顺手把 team_id 数字回查 team_name（不影响 user）
  const teamIds = rows
    .filter((r) => r.subject_type === 'team')
    .map((r) => Number(r.subject_id))
    .filter(Number.isFinite)
  const teamNameMap = new Map<number, string>()
  if (teamIds.length > 0) {
    const { rows: tn } = await pool.query(
      `SELECT id, name FROM team WHERE id = ANY($1::int[])`,
      [teamIds],
    )
    for (const t of tn) teamNameMap.set(Number(t.id), String(t.name))
  }
  const items = rows.map((r) => ({
    ...r,
    display: r.subject_type === 'user'
      ? String(r.subject_id)
      : `${teamNameMap.get(Number(r.subject_id)) ?? `team#${r.subject_id}`}`,
  }))
  res.json({ items })
})

notebooksRouter.post('/:id/members', async (req: Request, res: Response) => {
  const nb = await loadOwnedNotebook(req, res, String(req.params.id))
  if (!nb) return
  const body = (req.body ?? {}) as {
    subject_type?: unknown; subject_id?: unknown; role?: unknown
  }
  const subject_type = body.subject_type === 'team' ? 'team' : 'user'
  const subject_id   = typeof body.subject_id === 'string' ? body.subject_id.trim() : ''
  if (!subject_id) return res.status(400).json({ error: 'subject_id required' })
  if (subject_type === 'user' && !/^[^@\s]+@[^@\s]+$/.test(subject_id)) {
    return res.status(400).json({ error: 'subject_id must be a valid email when subject_type=user' })
  }
  const role = body.role === 'editor' ? 'editor' : 'reader'

  const pool = getPgPool()
  await pool.query(
    `INSERT INTO notebook_member (notebook_id, subject_type, subject_id, role, added_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (notebook_id, subject_type, subject_id) DO UPDATE SET role = EXCLUDED.role`,
    [nb.id, subject_type, subject_id, role, req.principal?.email ?? null],
  )
  res.status(201).json({ ok: true })
})

notebooksRouter.delete('/:id/members/:type/:sid', async (req: Request, res: Response) => {
  const nb = await loadOwnedNotebook(req, res, String(req.params.id))
  if (!nb) return
  const stype = req.params.type === 'team' ? 'team' : 'user'
  const sid = String(req.params.sid).trim()
  const pool = getPgPool()
  const { rowCount } = await pool.query(
    `DELETE FROM notebook_member WHERE notebook_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [nb.id, stype, sid],
  )
  res.json({ ok: true, removed: rowCount ?? 0 })
})

// ── helpers ─────────────────────────────────────────────────────────────────

function sanitizeIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const x of raw) {
    const n = Number(x)
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n); out.push(n)
    }
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
notebooksRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' })
})
