import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../../auth/index.ts'
import { writeAudit } from '../../services/audit.ts'
import {
  listQualityIssues, listIssueAssets, fixIssueBatch,
  type QualityIssueKind,
} from '../../services/governance/quality.ts'

export const qualityRouter = Router()

const KINDS: QualityIssueKind[] = ['missing_author', 'stale', 'empty_content', 'no_tags']
const isKind = (v: unknown): v is QualityIssueKind =>
  typeof v === 'string' && (KINDS as string[]).includes(v)

qualityRouter.get(
  '/',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (_req: Request, res: Response) => {
    const groups = await listQualityIssues()
    res.json({ items: groups })
  },
)

qualityRouter.get(
  '/:kind',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    if (!isKind(req.params.kind)) return res.status(400).json({ error: 'invalid kind' })
    const limit = req.query.limit ? Math.min(200, Number(req.query.limit)) : 50
    const items = await listIssueAssets(req.params.kind, limit)
    res.json({ items, total: items.length })
  },
)

qualityRouter.post(
  '/fix',
  requireAuth(),
  enforceAcl({ action: 'WRITE', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const { kind, assetIds } = (req.body ?? {}) as { kind?: unknown; assetIds?: unknown }
    if (!isKind(kind)) return res.status(400).json({ error: 'invalid kind' })
    if (!Array.isArray(assetIds)) return res.status(400).json({ error: 'assetIds[] required' })
    const ids = assetIds.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    const r = await fixIssueBatch(kind, ids)
    await writeAudit({
      action: 'quality_fix', targetType: 'asset', targetId: kind,
      detail: { kind, assetIds: ids, ...r }, principal: req.principal,
    })
    res.json({ ok: true, ...r })
  },
)
