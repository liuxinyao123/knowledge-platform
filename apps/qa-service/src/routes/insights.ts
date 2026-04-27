/**
 * routes/insights.ts —— graph-insights HTTP 契约
 *
 * 契约见 openspec/changes/graph-insights/specs/graph-insights-spec.md
 *
 * Endpoints:
 *   GET    /api/insights?spaceId=N
 *   POST   /api/insights/refresh        { spaceId }
 *   POST   /api/insights/dismiss        { spaceId, insight_key }
 *   DELETE /api/insights/dismiss        { spaceId, insight_key }
 *   POST   /api/insights/topic          { spaceId, insight_key }
 */
import { Router, type Request, type Response } from 'express'

import { requireAuth } from '../auth/requireAuth.ts'
import { enforceAcl } from '../auth/enforceAcl.ts'

import {
  getInsights,
  findInsightByKey,
  FeatureDisabledError,
  KgUnavailableError,
  type InsightsPayload,
} from '../services/graphInsights/index.ts'
import {
  listDismissed,
  addDismissed,
  removeDismissed,
} from '../services/graphInsights/dismissed.ts'
import { generateDeepResearchTopic } from '../services/graphInsights/deepResearchPrompt.ts'
import { loadGraphInsightsConfig } from '../services/graphInsights/config.ts'

export const insightsRouter = Router()

insightsRouter.use(requireAuth())

function parseSpaceId(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null
  return n
}

function errorResponse(err: unknown, res: Response): void {
  if (err instanceof FeatureDisabledError) {
    res.status(503).json({ code: 'FEATURE_DISABLED', message: 'graph-insights 未启用' })
    return
  }
  if (err instanceof KgUnavailableError) {
    res.status(503).json({ code: 'KG_UNAVAILABLE', message: '知识图谱暂不可用' })
    return
  }
  const msg = err instanceof Error ? err.message : String(err)
  // eslint-disable-next-line no-console
  console.error(`[insights] unhandled error: ${msg}`)
  res.status(500).json({ error: 'internal_error', detail: msg.slice(0, 300) })
}

async function filterDismissed(
  payload: InsightsPayload,
  userEmail: string,
): Promise<InsightsPayload> {
  const dismissed = await listDismissed(userEmail, payload.space_id)
  if (dismissed.size === 0) return payload
  return {
    ...payload,
    isolated: payload.isolated.filter((x) => !dismissed.has(x.key)),
    bridges: payload.bridges.filter((x) => !dismissed.has(x.key)),
    surprises: payload.surprises.filter((x) => !dismissed.has(x.key)),
    sparse: payload.sparse.filter((x) => !dismissed.has(x.key)),
  }
}

// ── GET /api/insights?spaceId=N ─────────────────────────────────────────────

insightsRouter.get(
  '/',
  async (req: Request, res: Response, next) => {
    // 先对 spaceId 做 400 校验，再进 enforceAcl（否则 extractor 抛 400 时消息不清晰）
    const spaceId = parseSpaceId(req.query.spaceId)
    if (spaceId == null) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED', message: 'spaceId 查询参数必填' })
    }
    ;(req as Request & { _spaceId: number })._spaceId = spaceId
    return next()
  },
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => ({
      space_id: (req as Request & { _spaceId: number })._spaceId,
    }),
  }),
  async (req: Request, res: Response) => {
    const spaceId = (req as Request & { _spaceId: number })._spaceId
    try {
      const payload = await getInsights(spaceId)
      const filtered = await filterDismissed(payload, req.principal!.email)
      res.json(filtered)
    } catch (err) {
      errorResponse(err, res)
    }
  },
)

// ── POST /api/insights/refresh ──────────────────────────────────────────────

insightsRouter.post(
  '/refresh',
  async (req: Request, res: Response, next) => {
    const spaceId = parseSpaceId(req.body?.spaceId)
    if (spaceId == null) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED' })
    }
    ;(req as Request & { _spaceId: number })._spaceId = spaceId
    return next()
  },
  enforceAcl({
    action: 'ADMIN',
    resourceExtractor: (req) => ({
      space_id: (req as Request & { _spaceId: number })._spaceId,
    }),
  }),
  async (req: Request, res: Response) => {
    const spaceId = (req as Request & { _spaceId: number })._spaceId
    try {
      const payload = await getInsights(spaceId, { force: true })
      const filtered = await filterDismissed(payload, req.principal!.email)
      res.json(filtered)
    } catch (err) {
      errorResponse(err, res)
    }
  },
)

// ── POST /api/insights/dismiss ──────────────────────────────────────────────

insightsRouter.post(
  '/dismiss',
  async (req: Request, res: Response, next) => {
    const spaceId = parseSpaceId(req.body?.spaceId)
    if (spaceId == null) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED' })
    }
    const key = typeof req.body?.insight_key === 'string' ? req.body.insight_key.trim() : ''
    if (!key || key.length > 128) {
      return res.status(400).json({ code: 'INSIGHT_KEY_REQUIRED' })
    }
    ;(req as Request & { _spaceId: number; _key: string })._spaceId = spaceId
    ;(req as Request & { _spaceId: number; _key: string })._key = key
    return next()
  },
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => ({
      space_id: (req as Request & { _spaceId: number })._spaceId,
    }),
  }),
  async (req: Request, res: Response) => {
    const { _spaceId: spaceId, _key: key } = req as Request & { _spaceId: number; _key: string }
    try {
      await addDismissed(req.principal!.email, spaceId, key)
      // eslint-disable-next-line no-console
      console.log(
        `graph_insights_dismissed ${JSON.stringify({
          user: req.principal!.email,
          space_id: spaceId,
          insight_key: key,
        })}`,
      )
      res.status(204).end()
    } catch (err) {
      errorResponse(err, res)
    }
  },
)

// ── DELETE /api/insights/dismiss ────────────────────────────────────────────

insightsRouter.delete(
  '/dismiss',
  async (req: Request, res: Response, next) => {
    const spaceId = parseSpaceId(req.body?.spaceId ?? req.query?.spaceId)
    if (spaceId == null) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED' })
    }
    const raw = req.body?.insight_key ?? req.query?.insight_key
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (!key || key.length > 128) {
      return res.status(400).json({ code: 'INSIGHT_KEY_REQUIRED' })
    }
    ;(req as Request & { _spaceId: number; _key: string })._spaceId = spaceId
    ;(req as Request & { _spaceId: number; _key: string })._key = key
    return next()
  },
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => ({
      space_id: (req as Request & { _spaceId: number })._spaceId,
    }),
  }),
  async (req: Request, res: Response) => {
    const { _spaceId: spaceId, _key: key } = req as Request & { _spaceId: number; _key: string }
    try {
      await removeDismissed(req.principal!.email, spaceId, key)
      res.status(204).end()
    } catch (err) {
      errorResponse(err, res)
    }
  },
)

// ── POST /api/insights/topic ────────────────────────────────────────────────

insightsRouter.post(
  '/topic',
  async (req: Request, res: Response, next) => {
    const spaceId = parseSpaceId(req.body?.spaceId)
    if (spaceId == null) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED' })
    }
    const key = typeof req.body?.insight_key === 'string' ? req.body.insight_key.trim() : ''
    if (!key || key.length > 128) {
      return res.status(400).json({ code: 'INSIGHT_KEY_REQUIRED' })
    }
    ;(req as Request & { _spaceId: number; _key: string })._spaceId = spaceId
    ;(req as Request & { _spaceId: number; _key: string })._key = key
    return next()
  },
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => ({
      space_id: (req as Request & { _spaceId: number })._spaceId,
    }),
  }),
  async (req: Request, res: Response) => {
    const { _spaceId: spaceId, _key: key } = req as Request & { _spaceId: number; _key: string }
    try {
      const payload = await getInsights(spaceId)
      const insight = findInsightByKey(payload, key)
      if (!insight) {
        return res.status(404).json({ error: 'insight_not_found' })
      }
      const topic = await generateDeepResearchTopic(insight)
      res.json({ ...topic, kind: insight.kind })
    } catch (err) {
      errorResponse(err, res)
    }
  },
)

// ── health（可选）给前端在 Layout 里 probe feature flag 用 ─────────────────

insightsRouter.get('/health', (_req, res) => {
  const cfg = loadGraphInsightsConfig()
  res.json({ enabled: cfg.enabled })
})
