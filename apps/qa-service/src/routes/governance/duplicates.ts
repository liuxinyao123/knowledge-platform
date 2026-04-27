import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../../auth/index.ts'
import { writeAudit } from '../../services/audit.ts'
import {
  findDuplicatePairs, mergeAssets, dismissDuplicate,
} from '../../services/governance/duplicates.ts'

export const duplicatesRouter = Router()

duplicatesRouter.get(
  '/',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const threshold = req.query.threshold ? Number(req.query.threshold) : undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const pairs = await findDuplicatePairs({ threshold, limit })
    res.json({ items: pairs, total: pairs.length })
  },
)

duplicatesRouter.post(
  '/merge',
  requireAuth(),
  enforceAcl({ action: 'WRITE', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const { srcId, dstId } = (req.body ?? {}) as { srcId?: number; dstId?: number }
    if (!Number.isFinite(srcId) || !Number.isFinite(dstId)) {
      return res.status(400).json({ error: 'srcId and dstId required' })
    }
    if (srcId === dstId) return res.status(400).json({ error: 'srcId === dstId' })
    await mergeAssets(srcId!, dstId!)
    await writeAudit({
      action: 'asset_merge', targetType: 'asset', targetId: dstId,
      detail: { srcId, dstId }, principal: req.principal,
    })
    res.json({ ok: true })
  },
)

duplicatesRouter.post(
  '/dismiss',
  requireAuth(),
  enforceAcl({ action: 'WRITE', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const { a, b } = (req.body ?? {}) as { a?: number; b?: number }
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return res.status(400).json({ error: 'a and b required' })
    }
    await dismissDuplicate(a!, b!)
    await writeAudit({
      action: 'duplicate_dismiss', targetType: 'asset', targetId: `${a},${b}`,
      principal: req.principal,
    })
    res.json({ ok: true })
  },
)
