/**
 * routes/actions.ts
 *
 * Action Framework endpoints:
 *   GET  /api/actions
 *   POST /api/actions/:name/run
 *   GET  /api/actions/runs/:run_id
 *   POST /api/actions/runs/:run_id/approve
 *   POST /api/actions/runs/:run_id/reject
 *   POST /api/actions/runs/:run_id/cancel
 */

import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../auth/requireAuth.ts'
import {
  registerAction,
  listActions,
  listRuns,
  submitRun,
  approveRun,
  rejectRun,
  cancelRun,
  getRun,
  InvalidStateTransitionError,
} from '../services/actionEngine.ts'

export const actionsRouter = Router()

// All routes require auth
actionsRouter.use(requireAuth())

// ── GET /api/actions — List available actions ──────────────────────────────

actionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const actions = await listActions(req.principal!)
    const items = actions.map((a) => ({
      name: a.name,
      description: a.description,
      risk_level: a.riskLevel,
      input_schema: a.inputSchema,
      output_schema: a.outputSchema,
      approval_policy: a.approvalPolicy,
      can_submit: a.can_submit,
    }))
    res.json({ items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/actions/:name/run — Submit action ────────────────────────────

actionsRouter.post('/:name/run', async (req: Request, res: Response) => {
  try {
    const { name } = req.params
    const { args, reason } = req.body

    const result = await submitRun(String(name), args, req.principal!, reason)
    res.status(201).json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.startsWith('action_not_found:')) {
      return res.status(404).json({ error: 'action_not_found' })
    }
    if (msg.startsWith('invalid_args:')) {
      return res.status(400).json({
        error: 'invalid_args',
        detail: msg.replace('invalid_args:', ''),
      })
    }
    if (msg.startsWith('precondition_failed:')) {
      const detail = msg.replace('precondition_failed:', '')
      return res.status(409).json({
        error: 'precondition_failed',
        detail: JSON.parse(detail),
      })
    }
    if (msg === 'permission_denied') {
      return res.status(403).json({ error: 'permission_denied' })
    }

    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/actions/runs — List runs (admin sees all, others see own) ────

actionsRouter.get('/runs', async (req: Request, res: Response) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined
    const actionName = typeof req.query.action_name === 'string' ? req.query.action_name : undefined
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const offset = req.query.offset ? Number(req.query.offset) : undefined

    const { items, total } = await listRuns(req.principal!, { state, actionName, limit, offset })

    res.json({
      total,
      items: items.map((run) => ({
        id: run.id,
        action_name: run.actionName,
        actor_id: run.actorId,
        actor_role: run.actorRole,
        args: run.args,
        reason: run.reason,
        state: run.state,
        attempts: run.attempts,
        result: run.result,
        error: run.error,
        approver_id: run.approverId,
        approval_note: run.approvalNote,
        created_at: run.createdAt.toISOString(),
        updated_at: run.updatedAt.toISOString(),
        completed_at: run.completedAt?.toISOString(),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/actions/runs/:run_id — Get run details ────────────────────────

actionsRouter.get('/runs/:run_id', async (req: Request, res: Response) => {
  try {
    const { run_id } = req.params
    const run = await getRun(String(run_id), req.principal!)

    res.json({
      id: run.id,
      action_name: run.actionName,
      actor_id: run.actorId,
      actor_role: run.actorRole,
      args: run.args,
      reason: run.reason,
      state: run.state,
      attempts: run.attempts,
      result: run.result,
      error: run.error,
      approver_id: run.approverId,
      approval_note: run.approvalNote,
      created_at: run.createdAt.toISOString(),
      updated_at: run.updatedAt.toISOString(),
      completed_at: run.completedAt?.toISOString(),
      audit_log: run.auditLog?.map((a) => ({
        id: a.id,
        run_id: a.runId,
        event: a.event,
        before_json: a.beforeJson,
        after_json: a.afterJson,
        actor_id: a.actorId,
        extra: a.extra,
        created_at: a.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('run_not_found:')) {
      return res.status(404).json({ error: 'run_not_found' })
    }
    res.status(500).json({ error: String(err) })
  }
})

// ── POST /api/actions/runs/:run_id/approve ─────────────────────────────────

actionsRouter.post('/runs/:run_id/approve', async (req: Request, res: Response) => {
  try {
    const { run_id } = req.params
    const { note } = req.body

    await approveRun(String(run_id), req.principal!, note)
    res.status(200).json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.startsWith('run_not_found:')) {
      return res.status(404).json({ error: 'run_not_found' })
    }
    if (err instanceof InvalidStateTransitionError) {
      return res.status(409).json({ error: 'invalid_state_transition' })
    }
    if (msg === 'approver_role_required') {
      return res.status(403).json({ error: 'approver_role_required' })
    }

    res.status(500).json({ error: String(err) })
  }
})

// ── POST /api/actions/runs/:run_id/reject ──────────────────────────────────

actionsRouter.post('/runs/:run_id/reject', async (req: Request, res: Response) => {
  try {
    const { run_id } = req.params
    const { note } = req.body

    await rejectRun(String(run_id), req.principal!, note)
    res.status(200).json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.startsWith('run_not_found:')) {
      return res.status(404).json({ error: 'run_not_found' })
    }
    if (err instanceof InvalidStateTransitionError) {
      return res.status(409).json({ error: 'invalid_state_transition' })
    }
    if (msg === 'approver_role_required') {
      return res.status(403).json({ error: 'approver_role_required' })
    }

    res.status(500).json({ error: String(err) })
  }
})

// ── POST /api/actions/runs/:run_id/cancel ──────────────────────────────────

actionsRouter.post('/runs/:run_id/cancel', async (req: Request, res: Response) => {
  try {
    const { run_id } = req.params

    await cancelRun(String(run_id), req.principal!)
    res.status(200).json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.startsWith('run_not_found:')) {
      return res.status(404).json({ error: 'run_not_found' })
    }
    if (msg === 'permission_denied') {
      return res.status(403).json({ error: 'permission_denied' })
    }
    if (err instanceof InvalidStateTransitionError) {
      return res.status(409).json({ error: 'invalid_state_transition' })
    }

    res.status(500).json({ error: String(err) })
  }
})
