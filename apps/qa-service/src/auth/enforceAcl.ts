/**
 * auth/enforceAcl.ts —— 查询前强制授权 middleware
 *
 * 用法：
 *   router.post('/search',
 *     requireAuth(),
 *     enforceAcl({ action: 'READ', resourceExtractor: (req) => ({ source_id: req.body.source_id }) }),
 *     handler,
 *   )
 *
 *   或者只要 permission（不走 ACL 规则）：
 *   router.get('/iam/users',
 *     requireAuth(),
 *     enforceAcl({ requiredPermission: 'iam:manage' }),
 *     handler,
 *   )
 *
 * 成功后在 req 上挂：
 *   - req.aclDecision: Decision
 *   - req.aclFilter?: SqlFragment（注入到 SQL WHERE）
 */
import type { Request, RequestHandler } from 'express'
import type { AclAction, AclResource } from './types.ts'
import { evaluateAcl } from './evaluateAcl.ts'
import { aclCacheGet, aclCacheSet, aclCacheKey } from './aclCache.ts'
import { isAuthConfigured } from './verifyToken.ts'
import { hasPermission } from './permissions.ts'

export interface EnforceAclOptions {
  /** 旧 ACL 路径：要 action + resource */
  action?: AclAction
  resourceExtractor?: (req: Request) => AclResource | Promise<AclResource>
  /** 新 PRD 路径：直接要求 permission（绕过 ACL 规则） */
  requiredPermission?: string
}

export function enforceAcl(opts: EnforceAclOptions): RequestHandler {
  return async (req, res, next) => {
    const principal = req.principal
    if (!principal) {
      return res.status(401).json({ error: 'principal missing' })
    }

    // DEV BYPASS：本地开发未配 AUTH_*；requireAuth 会注入 admin principal + ADMIN_PERMS。
    // 这里直接放行 ACL，避免用户还没插规则被 403。
    if (!isAuthConfigured() && process.env.NODE_ENV !== 'production') {
      req.aclDecision = { allow: true }
      return next()
    }

    // 1) requiredPermission（PRD §17.4 路径）
    if (opts.requiredPermission && !hasPermission(principal, opts.requiredPermission)) {
      return res.status(403).json({
        error: 'forbidden',
        reason: `missing permission ${opts.requiredPermission}`,
      })
    }

    // 2) action + resource（旧 ACL 路径）；若未提供则跳过
    if (opts.action && opts.resourceExtractor) {
      let resource: AclResource
      try {
        resource = await opts.resourceExtractor(req)
      } catch {
        return res.status(400).json({ error: 'bad resource' })
      }

      const key = aclCacheKey(principal, opts.action, resource)
      let decision = aclCacheGet(key)
      if (!decision) {
        try {
          decision = await evaluateAcl(principal, opts.action, resource)
        } catch (err) {
          return res.status(500).json({
            error: 'acl eval failed',
            detail: err instanceof Error ? err.message : 'unknown',
          })
        }
        aclCacheSet(key, decision)
      }

      if (!decision.allow) {
        return res.status(403).json({ error: 'forbidden', reason: decision.reason })
      }

      req.aclDecision = decision
      if (decision.filter) req.aclFilter = decision.filter
    } else {
      req.aclDecision = { allow: true }
    }

    return next()
  }
}
