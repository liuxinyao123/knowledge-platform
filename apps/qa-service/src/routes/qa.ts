/**
 * routes/qa.ts —— 向后兼容壳 + retrieve 端点
 *
 * 历史上 /api/qa/ask 是 RAG 独占入口；Agent 编排层上线后，入口迁移到
 * POST /api/agent/dispatch。本路由保留兼容：强制注入 hint_intent=knowledge_qa
 * 再交给 dispatchHandler。
 *
 * /retrieve 是 ontology.query_chunks MCP 工具的后端（mcp-service skill yaml
 * 声明的契约），单纯做语义召回，不跑完整 RAG。
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { dispatchHandler } from '../agent/dispatchHandler.ts'
import {
  searchKnowledgeChunks,
  EmbeddingNotConfiguredError,
} from '../services/knowledgeSearch.ts'
import { getPgPool } from '../services/pgDb.ts'

export const qaRouter = Router()

function forceKnowledgeQaIntent(req: Request, _res: Response, next: NextFunction) {
  req.body = { ...(req.body ?? {}), hint_intent: 'knowledge_qa' }
  next()
}

qaRouter.post(
  '/ask',
  requireAuth(),
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => {
      const sid = (req.body ?? {}).source_id
      return { source_id: typeof sid === 'number' ? sid : undefined }
    },
  }),
  forceKnowledgeQaIntent,
  dispatchHandler,
)

/**
 * POST /api/qa/retrieve —— ontology.query_chunks MCP 工具后端
 *
 * 契约：apps/mcp-service/skills/ontology/query_chunks.skill.yaml
 *   入参：{ query: string, topK?: number, spaceId?: string }
 *   出参：{ chunks: [{ asset_id: string, score: number, preview: string }] }
 *
 * 行为：
 *   - 薄壳调 searchKnowledgeChunks（不跑 rerank/grade/rewrite，纯向量召回）
 *   - spaceId 提供时下推为 source_ids 范围（同 ragPipeline retrieveInitial 行为）
 *   - preview 取 chunk_content 前 240 字符
 *   - EmbeddingNotConfiguredError → 503
 */
qaRouter.post('/retrieve', requireAuth(), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    query?: unknown
    topK?: unknown
    spaceId?: unknown
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) {
    return res.status(400).json({ error: 'query is required (non-empty string)' })
  }

  const rawTopK = Number(body.topK ?? 10)
  const topK = Number.isFinite(rawTopK) && rawTopK > 0 ? Math.min(50, Math.floor(rawTopK)) : 10

  // spaceId 接受字符串或数字；非空时解析为 source_ids 集合下推
  let scopedSourceIds: number[] | undefined
  const rawSpaceId = body.spaceId
  if (rawSpaceId !== undefined && rawSpaceId !== null && rawSpaceId !== '') {
    const sid = Number(rawSpaceId)
    if (!Number.isInteger(sid) || sid <= 0) {
      return res.status(400).json({ error: 'spaceId must be a positive integer' })
    }
    try {
      const { rows } = await getPgPool().query(
        `SELECT source_id FROM space_source WHERE space_id = $1`,
        [sid],
      )
      scopedSourceIds = rows.map((r) => Number(r.source_id))
      if (scopedSourceIds.length === 0) {
        // 空间下无源 → 直接返回空结果，不打 embedding
        return res.json({ chunks: [] })
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[qa/retrieve] space_source lookup failed:', (err as Error).message)
      // 不抛，继续走全局检索；spaceId 失效但召回不阻塞
    }
  }

  try {
    const hits = await searchKnowledgeChunks({
      query,
      top_k: topK,
      source_ids: scopedSourceIds,
    })
    const chunks = hits.map((h) => ({
      asset_id: String(h.asset_id),
      score: typeof h.score === 'number' ? h.score : 0,
      preview: typeof h.chunk_content === 'string' ? h.chunk_content.slice(0, 240) : '',
    }))
    return res.json({ chunks })
  } catch (err) {
    if (err instanceof EmbeddingNotConfiguredError) {
      return res.status(503).json({ error: 'embedding_not_configured' })
    }
    // eslint-disable-next-line no-console
    console.error('[qa/retrieve] failed:', err)
    return res.status(500).json({ error: 'retrieve_failed' })
  }
})
