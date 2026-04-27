/**
 * routes/eval.ts —— 评测体系 API
 *
 * 数据集（dataset） / 用例（case） / 运行（run） / 单题结果（case_result）
 *
 * 端点：
 *   GET    /api/eval/datasets                  列表（任意已登录用户可读）
 *   POST   /api/eval/datasets                  创建            permission:manage
 *   GET    /api/eval/datasets/:id              详情 + cases
 *   PATCH  /api/eval/datasets/:id              改名/改描述     permission:manage
 *   DELETE /api/eval/datasets/:id              删除            permission:manage
 *
 *   POST   /api/eval/datasets/:id/cases        加 case         permission:manage
 *   POST   /api/eval/datasets/:id/import-jsonl 批量导入        permission:manage
 *   PATCH  /api/eval/cases/:id                 改 case         permission:manage
 *   DELETE /api/eval/cases/:id                 删 case         permission:manage
 *
 *   POST   /api/eval/datasets/:id/run          启动 run        permission:manage
 *   GET    /api/eval/runs                      列表 (?dataset_id=)
 *   GET    /api/eval/runs/:id                  详情 + 逐题结果
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { getPgPool } from '../services/pgDb.ts'
import { executeRun } from '../services/evalRunner.ts'

export const evalRouter = Router()

const adminOnly = enforceAcl({ requiredPermission: 'permission:manage' })

evalRouter.use(requireAuth())

// ── datasets ────────────────────────────────────────────────────────────────

evalRouter.get('/datasets', async (_req: Request, res: Response) => {
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.description, d.created_by,
            EXTRACT(EPOCH FROM d.created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM d.updated_at) * 1000 AS updated_at_ms,
            (SELECT COUNT(*)::int FROM eval_case c WHERE c.dataset_id = d.id) AS case_count,
            (SELECT EXTRACT(EPOCH FROM MAX(r.started_at)) * 1000
             FROM eval_run r WHERE r.dataset_id = d.id) AS last_run_at_ms
     FROM eval_dataset d
     ORDER BY d.id DESC`,
  )
  res.json({ items: rows })
})

evalRouter.post('/datasets', adminOnly, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name required' })
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const pool = getPgPool()
  const { rows } = await pool.query(
    `INSERT INTO eval_dataset (name, description, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, created_by,
               EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms`,
    [name, description, req.principal?.email ?? null],
  )
  res.status(201).json(rows[0])
})

evalRouter.get('/datasets/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rows: dRows } = await pool.query(
    `SELECT id, name, description, created_by,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms,
            EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_ms
     FROM eval_dataset WHERE id = $1`,
    [id],
  )
  if (rows0(dRows)) return res.status(404).json({ error: 'not found' })
  const { rows: cases } = await pool.query(
    `SELECT id, ext_id, question, expected_asset_ids, comment, expected_answer,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms
     FROM eval_case WHERE dataset_id = $1 ORDER BY id ASC`,
    [id],
  )
  res.json({ dataset: dRows[0], cases })
})

evalRouter.patch('/datasets/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.name === 'string') { params.push(body.name.trim()); sets.push(`name = $${params.length}`) }
  if (typeof body.description === 'string') { params.push(body.description.trim()); sets.push(`description = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  sets.push(`updated_at = NOW()`)
  params.push(id)
  const pool = getPgPool()
  const { rowCount } = await pool.query(
    `UPDATE eval_dataset SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  )
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

evalRouter.delete('/datasets/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rowCount } = await pool.query(`DELETE FROM eval_dataset WHERE id = $1`, [id])
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

// ── cases ───────────────────────────────────────────────────────────────────

evalRouter.post('/datasets/:id/cases', adminOnly, async (req: Request, res: Response) => {
  const datasetId = Number(req.params.id)
  if (!Number.isFinite(datasetId)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as {
    ext_id?: unknown; question?: unknown
    expected_asset_ids?: unknown; comment?: unknown
    expected_answer?: unknown
  }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return res.status(400).json({ error: 'question required' })
  const expected = sanitizeIds(body.expected_asset_ids)
  const ext_id = typeof body.ext_id === 'string' ? body.ext_id.trim() || null : null
  const comment = typeof body.comment === 'string' ? body.comment.trim() || null : null
  const expected_answer = typeof body.expected_answer === 'string'
    ? body.expected_answer.trim() || null : null

  const pool = getPgPool()
  const { rows } = await pool.query(
    `INSERT INTO eval_case (dataset_id, ext_id, question, expected_asset_ids, comment, expected_answer)
     VALUES ($1, $2, $3, $4::int[], $5, $6)
     RETURNING id, ext_id, question, expected_asset_ids, comment, expected_answer,
               EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms`,
    [datasetId, ext_id, question, expected, comment, expected_answer],
  )
  res.status(201).json(rows[0])
})

evalRouter.patch('/cases/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as Record<string, unknown>
  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.ext_id === 'string') { params.push(body.ext_id); sets.push(`ext_id = $${params.length}`) }
  if (typeof body.question === 'string') { params.push(body.question.trim()); sets.push(`question = $${params.length}`) }
  if ('expected_asset_ids' in body) {
    params.push(sanitizeIds(body.expected_asset_ids))
    sets.push(`expected_asset_ids = $${params.length}::int[]`)
  }
  if (typeof body.comment === 'string') { params.push(body.comment); sets.push(`comment = $${params.length}`) }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' })
  params.push(id)
  const pool = getPgPool()
  const { rowCount } = await pool.query(
    `UPDATE eval_case SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  )
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

evalRouter.delete('/cases/:id', adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rowCount } = await pool.query(`DELETE FROM eval_case WHERE id = $1`, [id])
  if (!rowCount) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

// ── 批量 JSONL 导入 ──────────────────────────────────────────────────────────

evalRouter.post('/datasets/:id/import-jsonl', adminOnly, async (req: Request, res: Response) => {
  const datasetId = Number(req.params.id)
  if (!Number.isFinite(datasetId)) return res.status(400).json({ error: 'invalid id' })
  const body = (req.body ?? {}) as { jsonl?: unknown; replace?: unknown }
  const text = typeof body.jsonl === 'string' ? body.jsonl : ''
  if (!text.trim()) return res.status(400).json({ error: 'jsonl required (string)' })
  const replace = body.replace === true

  const lines = text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))

  const parsed: Array<{
    ext_id: string | null; question: string; expected: number[];
    comment: string | null; expected_answer: string | null
  }> = []
  const errors: Array<{ line: number; error: string }> = []
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]) as Record<string, unknown>
      const question = typeof obj.question === 'string' ? obj.question.trim() : ''
      if (!question) { errors.push({ line: i + 1, error: 'missing question' }); continue }
      const comment = typeof obj.comment === 'string' ? obj.comment : null
      // expected_answer：优先用顶层字段；否则从 comment 里 "期望: xxx" 后面提取
      let expected_answer: string | null =
        typeof obj.expected_answer === 'string' && obj.expected_answer.trim()
          ? obj.expected_answer.trim()
          : null
      if (!expected_answer && comment) {
        const m = comment.match(/期望[:：]\s*(.+?)$/m)
        if (m) expected_answer = m[1].trim()
      }
      parsed.push({
        ext_id: typeof obj.id === 'string' ? obj.id : null,
        question,
        expected: sanitizeIds(obj.expected_asset_ids),
        comment,
        expected_answer,
      })
    } catch (e) {
      errors.push({ line: i + 1, error: (e as Error).message })
    }
  }

  if (parsed.length === 0) {
    return res.status(400).json({ error: 'no valid records', errors })
  }

  const pool = getPgPool()
  if (replace) {
    await pool.query(`DELETE FROM eval_case WHERE dataset_id = $1`, [datasetId])
  }
  let inserted = 0
  for (const p of parsed) {
    await pool.query(
      `INSERT INTO eval_case (dataset_id, ext_id, question, expected_asset_ids, comment, expected_answer)
       VALUES ($1, $2, $3, $4::int[], $5, $6)`,
      [datasetId, p.ext_id, p.question, p.expected, p.comment, p.expected_answer],
    )
    inserted++
  }
  res.status(201).json({ inserted, parsed: parsed.length, errors })
})

// ── runs ────────────────────────────────────────────────────────────────────

evalRouter.post('/datasets/:id/run', adminOnly, async (req: Request, res: Response) => {
  const datasetId = Number(req.params.id)
  if (!Number.isFinite(datasetId)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rows: caseRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM eval_case WHERE dataset_id = $1`,
    [datasetId],
  )
  const total = Number(caseRows[0]?.n ?? 0)
  if (total === 0) return res.status(400).json({ error: 'dataset has no cases' })

  const body = (req.body ?? {}) as { notes?: unknown }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null

  const { rows } = await pool.query(
    `INSERT INTO eval_run (dataset_id, status, total, principal_email, notes)
     VALUES ($1, 'pending', $2, $3, $4)
     RETURNING id`,
    [datasetId, total, req.principal?.email ?? null, notes],
  )
  const runId = Number(rows[0].id)
  res.status(202).json({ runId, total })

  // 异步跑：fire-and-forget
  void executeRun(runId, datasetId).catch(async (err) => {
    try {
      await pool.query(
        `UPDATE eval_run SET status = 'failed', notes = $2, finished_at = NOW() WHERE id = $1`,
        [runId, `executor crashed: ${err instanceof Error ? err.message : 'unknown'}`],
      )
    } catch { /* ignore */ }
  })
})

evalRouter.get('/runs', async (req: Request, res: Response) => {
  const pool = getPgPool()
  const datasetId = req.query.dataset_id ? Number(req.query.dataset_id) : undefined
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))
  const where = Number.isFinite(datasetId) ? 'WHERE r.dataset_id = $1' : ''
  const params: unknown[] = Number.isFinite(datasetId) ? [datasetId] : []
  const { rows } = await pool.query(
    `SELECT r.id, r.dataset_id, d.name AS dataset_name,
            r.status, r.total, r.finished, r.errored,
            r.recall_at_1, r.recall_at_3, r.recall_at_5,
            r.avg_first_hit_rank, r.avg_judge_score, r.judged_count,
            r.notes, r.principal_email,
            EXTRACT(EPOCH FROM r.started_at) * 1000 AS started_at_ms,
            EXTRACT(EPOCH FROM r.finished_at) * 1000 AS finished_at_ms
     FROM eval_run r
     LEFT JOIN eval_dataset d ON d.id = r.dataset_id
     ${where}
     ORDER BY r.id DESC
     LIMIT ${limit}`,
    params,
  )
  res.json({ items: rows })
})

evalRouter.get('/runs/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const pool = getPgPool()
  const { rows: rRows } = await pool.query(
    `SELECT r.id, r.dataset_id, d.name AS dataset_name,
            r.status, r.total, r.finished, r.errored,
            r.recall_at_1, r.recall_at_3, r.recall_at_5,
            r.avg_first_hit_rank, r.avg_judge_score, r.judged_count,
            r.notes, r.principal_email,
            EXTRACT(EPOCH FROM r.started_at) * 1000 AS started_at_ms,
            EXTRACT(EPOCH FROM r.finished_at) * 1000 AS finished_at_ms
     FROM eval_run r
     LEFT JOIN eval_dataset d ON d.id = r.dataset_id
     WHERE r.id = $1`,
    [id],
  )
  if (!rRows[0]) return res.status(404).json({ error: 'not found' })
  const { rows: rsRows } = await pool.query(
    `SELECT id, case_id, ext_id, question, expected_asset_ids, retrieved_asset_ids,
            recall_at_1, recall_at_3, recall_at_5, first_hit_rank, duration_ms, error,
            expected_answer, system_answer, judge_score, judge_reasoning,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_ms
     FROM eval_case_result
     WHERE run_id = $1
     ORDER BY id ASC`,
    [id],
  )
  res.json({ run: rRows[0], results: rsRows })
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

function rows0(rows: unknown[]): boolean {
  return rows.length === 0
}
