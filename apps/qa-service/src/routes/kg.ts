/**
 * routes/kg.ts —— 知识图谱读端（ADR 2026-04-23-27）
 *
 * 端点：
 *   GET /api/kg/status                 —— 图谱是否可用 + 节点/边统计
 *   GET /api/kg/assets/:id/neighbors   —— 资产 1 跳邻域（给 DetailGraph 用）
 *   POST /api/kg/cypher  (admin only)  —— 只读 Cypher 入口，受限；默认关闭
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../auth/index.ts'
import { enforceAcl } from '../auth/enforceAcl.ts'
import {
  getAssetNeighborhood,
} from '../services/knowledgeGraph.ts'
import { isGraphEnabled, runCypher } from '../services/graphDb.ts'
import { loadSpaceGraphForViz } from '../services/kgGraphView/loader.ts'
import { loadKgGraphViewLimits } from '../services/kgGraphView/config.ts'

export const kgRouter = Router()
kgRouter.use(requireAuth())

kgRouter.get('/status', async (_req: Request, res: Response) => {
  const enabled = isGraphEnabled()
  if (!enabled) {
    return res.json({ enabled: false, stats: null })
  }
  const nodeRows = await runCypher(
    `MATCH (n) RETURN count(n) AS c`, {}, 'c agtype',
  )
  const edgeRows = await runCypher(
    `MATCH ()-[r]->() RETURN count(r) AS c`, {}, 'c agtype',
  )
  const parse = (v: unknown): number => {
    if (v == null) return 0
    const s = String(v).replace(/::agtype$/, '').replace(/"/g, '')
    return Number(s) || 0
  }
  res.json({
    enabled: true,
    stats: {
      nodes: parse(nodeRows[0]?.c),
      edges: parse(edgeRows[0]?.c),
    },
  })
})

kgRouter.get('/assets/:id/neighbors', async (req: Request, res: Response) => {
  const id = Number(String(req.params.id))
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const data = await getAssetNeighborhood(id)
  res.json(data)
})

// ── GET /api/kg/graph?spaceId=N —— 全 Space 子图（knowledge-graph-view）─────────

kgRouter.get(
  '/graph',
  async (req: Request, res: Response, next) => {
    const raw = req.query.spaceId
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return res.status(400).json({ code: 'SPACE_ID_REQUIRED', message: 'spaceId 查询参数必填' })
    }
    ;(req as Request & { _spaceId: number })._spaceId = n
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
    if (!isGraphEnabled()) {
      return res.status(503).json({ code: 'KG_UNAVAILABLE', message: '知识图谱暂不可用' })
    }
    const t0 = Date.now()
    try {
      const limits = loadKgGraphViewLimits()
      const payload = await loadSpaceGraphForViz(spaceId, limits)
      // eslint-disable-next-line no-console
      console.log(
        `kg_graph_loaded ${JSON.stringify({
          space_id: spaceId,
          node_count: payload.stats.node_count,
          edge_count: payload.stats.edge_count,
          truncated: payload.truncated,
          empty: payload.empty,
          duration_ms: Date.now() - t0,
        })}`,
      )
      res.json(payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(`[kg/graph] error: ${msg}`)
      res.status(500).json({ error: 'internal_error', detail: msg.slice(0, 300) })
    }
  },
)

/**
 * 只读 Cypher —— 仅 admin；默认不暴露（KG_CYPHER_ENDPOINT=1 才启用）
 * 写操作语句（CREATE/MERGE/DELETE/SET/REMOVE）直接拒绝
 */
kgRouter.post('/cypher', async (req: Request, res: Response) => {
  if (process.env.KG_CYPHER_ENDPOINT !== '1') {
    return res.status(404).json({ error: 'not enabled' })
  }
  if (!req.principal?.roles?.includes('admin')) {
    return res.status(403).json({ error: 'admin required' })
  }
  const q = typeof req.body?.query === 'string' ? req.body.query : ''
  if (!q.trim()) return res.status(400).json({ error: 'query required' })
  if (/\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP|CALL)\b/i.test(q)) {
    return res.status(403).json({ error: 'read-only endpoint; write operations blocked' })
  }
  const rows = await runCypher(q, {}, 'v agtype')
  res.json({ rows })
})
