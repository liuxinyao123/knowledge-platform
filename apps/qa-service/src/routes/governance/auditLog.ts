import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../../auth/index.ts'
import { getPgPool } from '../../services/pgDb.ts'

export const auditLogRouter = Router()

interface Filter {
  from?: string
  to?: string
  action?: string
  user_id?: number
  limit: number
  offset: number
}

function parseFilter(q: Request['query']): Filter {
  return {
    from: typeof q.from === 'string' ? q.from : undefined,
    to: typeof q.to === 'string' ? q.to : undefined,
    action: typeof q.action === 'string' ? q.action : undefined,
    user_id: q.user_id ? Number(q.user_id) : undefined,
    limit: Math.min(500, Math.max(1, Number(q.limit ?? 50))),
    offset: Math.max(0, Number(q.offset ?? 0)),
  }
}

function buildWhere(f: Filter): { where: string; params: unknown[] } {
  const c: string[] = []
  const p: unknown[] = []
  if (f.from) { p.push(f.from); c.push(`ts >= $${p.length}`) }
  if (f.to)   { p.push(f.to);   c.push(`ts <= $${p.length}`) }
  if (f.action) { p.push(f.action); c.push(`action = $${p.length}`) }
  if (Number.isFinite(f.user_id)) { p.push(f.user_id); c.push(`principal_user_id = $${p.length}`) }
  return { where: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p }
}

auditLogRouter.get(
  '/audit-log',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const f = parseFilter(req.query)
    const { where, params } = buildWhere(f)
    const pool = getPgPool()
    const { rows: countRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM audit_log ${where}`, params,
    )
    const { rows } = await pool.query(
      `SELECT id, ts, principal_user_id, principal_email, action, target_type, target_id, detail
       FROM audit_log ${where}
       ORDER BY ts DESC
       LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    )
    res.json({ items: rows, total: Number(countRows[0].n) })
  },
)

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

auditLogRouter.get(
  '/audit-log.csv',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const f = parseFilter(req.query)
    const { where, params } = buildWhere(f)
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT ts, principal_email, action, target_type, target_id, detail
       FROM audit_log ${where}
       ORDER BY ts DESC
       LIMIT ${Math.min(50000, f.limit * 10)}`,
      params,
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"')
    res.write('ts,user_email,action,target_type,target_id,detail\n')
    for (const r of rows as Array<Record<string, unknown>>) {
      res.write([
        csvEscape(r.ts),
        csvEscape(r.principal_email),
        csvEscape(r.action),
        csvEscape(r.target_type),
        csvEscape(r.target_id),
        csvEscape(r.detail),
      ].join(',') + '\n')
    }
    res.end()
  },
)
