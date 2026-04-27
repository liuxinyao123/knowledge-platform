/**
 * routes/agent.ts —— Agent 编排 HTTP 入口
 *
 * POST /api/agent/dispatch  —— SSE，按意图分发到对应 Agent
 *
 * 鉴权：requireAuth + enforceAcl(READ, source_id)
 * ADMIN 级 Agent（metadata_ops 的写操作）自己内部再检查；
 * 单一入口维持 READ 即可，细粒度由 Agent 或下游 API 负责。
 */
import { Router } from 'express'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { dispatchHandler } from '../agent/dispatchHandler.ts'

export const agentRouter = Router()

agentRouter.post(
  '/dispatch',
  requireAuth(),
  enforceAcl({
    action: 'READ',
    resourceExtractor: (req) => {
      const sid = (req.body ?? {}).source_id
      return { source_id: typeof sid === 'number' ? sid : undefined }
    },
  }),
  dispatchHandler,
)
