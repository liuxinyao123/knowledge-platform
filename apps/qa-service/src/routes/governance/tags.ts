import { Router, type Request, type Response } from 'express'
import { requireAuth, enforceAcl } from '../../auth/index.ts'
import { listTags, mergeTags, renameTag } from '../../services/governance/tags.ts'
import { writeAudit } from '../../services/audit.ts'

export const tagsRouter = Router()

tagsRouter.get(
  '/',
  requireAuth(),
  enforceAcl({ action: 'READ', resourceExtractor: () => ({}) }),
  async (_req: Request, res: Response) => {
    const items = await listTags()
    res.json({ items, total: items.length })
  },
)

tagsRouter.post(
  '/merge',
  requireAuth(),
  enforceAcl({ action: 'WRITE', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const { srcs, dst } = (req.body ?? {}) as { srcs?: string[]; dst?: string }
    if (!Array.isArray(srcs) || srcs.length === 0 || !dst) {
      return res.status(400).json({ error: 'srcs[] and dst required' })
    }
    const r = await mergeTags(srcs, dst)
    await writeAudit({
      action: 'tag_merge', targetType: 'tag', targetId: dst,
      detail: { srcs, dst, affected: r.affected }, principal: req.principal,
    })
    res.json({ ok: true, affected: r.affected })
  },
)

tagsRouter.post(
  '/rename',
  requireAuth(),
  enforceAcl({ action: 'WRITE', resourceExtractor: () => ({}) }),
  async (req: Request, res: Response) => {
    const { from, to } = (req.body ?? {}) as { from?: string; to?: string }
    if (!from || !to) return res.status(400).json({ error: 'from and to required' })
    const r = await renameTag(from, to)
    await writeAudit({
      action: 'tag_rename', targetType: 'tag', targetId: to,
      detail: { from, to, affected: r.affected }, principal: req.principal,
    })
    res.json({ ok: true, affected: r.affected })
  },
)
