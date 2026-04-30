/**
 * routes/templates.ts —— N-008 用户自定义模板 CRUD
 *
 * 端点（require auth；env 守卫 USER_TEMPLATES_ENABLED）:
 *   GET    /_meta            —— 暴露 enabled flag (前端用来决定是否显示创建入口)
 *   POST   /                 —— 创建用户模板
 *   PATCH  /:key             —— 改自己的（admin 可改任意 user 模板，但 system/community 拒）
 *   DELETE /:key             —— 删自己的（admin 可删任意 user 模板）
 *
 * env=false 时 4 个 mutating endpoint 直接返 404（伪装不存在），_meta 仍可访问
 * 因为前端要用它判断是否隐藏 UI。
 *
 * 详见 openspec/changes/notebook-user-templates/{proposal,design,specs/user-template-crud-spec,tasks}.md
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { requireAuth } from '../auth/index.ts'
import {
  isUserTemplatesEnabled,
  validateUserTemplateInput,
  createUserTemplate,
  updateUserTemplate,
  deleteUserTemplate,
} from '../services/notebookTemplates.ts'

export const templatesRouter = Router()

templatesRouter.use(requireAuth())

/**
 * env 守卫 middleware：关闭时让 4 个 mutating endpoint 返 404
 * /_meta 不走这层，要在 _meta 之后挂。
 */
function requireUserTemplatesEnabled(req: Request, res: Response, next: NextFunction) {
  if (!isUserTemplatesEnabled()) {
    return res.status(404).json({ error: 'not found' })
  }
  next()
}

// /_meta —— 任何登录用户都可看 enabled flag
templatesRouter.get('/_meta', (_req: Request, res: Response) => {
  res.json({
    enabled: isUserTemplatesEnabled(),
  })
})

// 后续 routes 走 env 守卫
templatesRouter.use(requireUserTemplatesEnabled)

// POST / —— 创建
templatesRouter.post('/', async (req: Request, res: Response) => {
  const principal = req.principal
  if (!principal) return res.status(401).json({ error: 'unauthenticated' })

  const v = validateUserTemplateInput(req.body)
  if (!v.ok) {
    return res.status(400).json({ error: 'validation failed', errors: v.errors })
  }
  try {
    const spec = await createUserTemplate(principal.user_id, v.data)
    return res.status(201).json(spec)
  } catch (err) {
    return res.status(500).json({
      error: 'failed to create template',
      detail: err instanceof Error ? err.message : 'unknown',
    })
  }
})

// PATCH /:key —— 编辑
templatesRouter.patch('/:key', async (req: Request, res: Response) => {
  const principal = req.principal
  if (!principal) return res.status(401).json({ error: 'unauthenticated' })

  const v = validateUserTemplateInput(req.body, true)
  if (!v.ok) {
    return res.status(400).json({ error: 'validation failed', errors: v.errors })
  }
  const isAdmin = Array.isArray(principal.roles) && principal.roles.includes('admin')
  const r = await updateUserTemplate({
    key: String(req.params.key),
    userId: principal.user_id,
    isAdmin,
    patch: v.data,
  })
  if (r.ok) return res.json(r.spec)
  switch (r.reason) {
    case 'not_found':
      return res.status(404).json({ error: 'template not found' })
    case 'system_or_community_immutable':
      return res.status(403).json({ error: '系统模板 / 社区模板不可由用户修改' })
    case 'forbidden':
      return res.status(403).json({ error: '只能修改自己创建的模板' })
  }
})

// DELETE /:key —— 删除
templatesRouter.delete('/:key', async (req: Request, res: Response) => {
  const principal = req.principal
  if (!principal) return res.status(401).json({ error: 'unauthenticated' })

  const isAdmin = Array.isArray(principal.roles) && principal.roles.includes('admin')
  const r = await deleteUserTemplate({
    key: String(req.params.key),
    userId: principal.user_id,
    isAdmin,
  })
  if (r.deleted) return res.json({ ok: true })
  switch (r.reason) {
    case 'not_found':
      return res.status(404).json({ error: 'template not found' })
    case 'system_or_community_immutable':
      return res.status(403).json({ error: '系统模板 / 社区模板不可由用户删除' })
    case 'forbidden':
      return res.status(403).json({ error: '只能删除自己创建的模板' })
  }
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
templatesRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' })
})
