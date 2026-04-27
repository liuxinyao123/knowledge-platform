/**
 * services/actionEngine.ts
 *
 * Core Action Framework: registration, state machine, execution flow
 * Implements design.md §"actionEngine.ts API" and §"执行流程"
 */

import { randomUUID } from 'node:crypto'
import type Ajv from 'ajv'
import type { Principal, AclResource } from '../auth/types.ts'
import { getPgPool } from './pgDb.ts'
import { evaluateAcl } from '../auth/evaluateAcl.ts'
import { sendActionWebhook } from './actionWebhook.ts'
import { evaluatePreconditions } from './actionPreconditions.ts'

// ── Error Types ────────────────────────────────────────────────────────────

export class ActionFatalError extends Error {
  // Note: NOT using TypeScript parameter properties (`public code: string`) here —
  // Node 22's --experimental-strip-types (the qa-service `dev` runner) doesn't
  // support them and throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at startup.
  code: string
  constructor(code: string, message?: string) {
    super(message || code)
    this.code = code
    this.name = 'ActionFatalError'
  }
}

export class ActionRetryableError extends Error {
  constructor(message?: string) {
    super(message || 'retryable error')
    this.name = 'ActionRetryableError'
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStateTransitionError'
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ActionContext {
  runId: string
  principal: Principal
  reason?: string
  attempts: number
  cancelRequested?: boolean
}

export type ActionEvent = 'submitted' | 'approved' | 'rejected' | 'started' | 'succeeded' | 'failed' | 'cancelled'

export interface ActionDefinition<I = unknown, O = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  preconditions?: Record<string, unknown>
  approvalPolicy: { required: boolean; approverRoles: string[] }
  webhook?: { url: string; events: ActionEvent[]; retry?: number }
  handler: (args: I, ctx: ActionContext) => Promise<O>
  enabled?: boolean
}

export interface ActionRun {
  id: string
  actionName: string
  actorId: string
  actorRole: string
  args: Record<string, unknown>
  reason?: string
  state: string
  attempts: number
  result?: Record<string, unknown>
  error?: Record<string, unknown>
  approverId?: string
  approvalNote?: string
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  auditLog?: ActionAuditEntry[]
}

export interface ActionAuditEntry {
  id: string
  runId: string
  event: string
  beforeJson?: Record<string, unknown>
  afterJson?: Record<string, unknown>
  actorId: string
  extra?: Record<string, unknown>
  createdAt: Date
}

// ── Registry ───────────────────────────────────────────────────────────────

const _registry = new Map<string, ActionDefinition>()

export function registerAction(def: ActionDefinition): void {
  // Validate webhook allowlist
  if (def.webhook?.url) {
    const webhookUrl = def.webhook.url
    const allowlist = (process.env.ACTION_WEBHOOK_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (allowlist.length > 0 && !allowlist.some((prefix) => webhookUrl.startsWith(prefix))) {
      throw new Error(`Webhook URL ${webhookUrl} not in ACTION_WEBHOOK_ALLOWLIST`)
    }
  }

  _registry.set(def.name, { ...def, enabled: def.enabled !== false })
}

export async function listActions(principal: Principal): Promise<(ActionDefinition & { can_submit: boolean })[]> {
  const result = []
  for (const def of _registry.values()) {
    if (!def.enabled) continue

    // Check EXECUTE permission
    const decision = await evaluateAcl(principal, 'EXECUTE', { action_name: def.name } as AclResource)
    if (!decision.allow) continue

    result.push({ ...def, can_submit: true })
  }
  return result
}

// ── State Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['pending', 'approved']),
  pending: new Set(['approved', 'rejected', 'cancelled']),
  approved: new Set(['executing', 'cancelled']),
  executing: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  rejected: new Set(),
}

async function transitionState(
  runId: string,
  newState: string,
  actorId: string,
): Promise<void> {
  const pool = getPgPool()

  // Read current state
  const { rows: runRows } = await pool.query(
    'SELECT state FROM action_run WHERE id = $1',
    [runId],
  )
  if (runRows.length === 0) throw new Error(`Run ${runId} not found`)

  const currentState = (runRows[0] as { state: string }).state
  if (!VALID_TRANSITIONS[currentState]?.has(newState)) {
    throw new InvalidStateTransitionError(
      `Cannot transition from ${currentState} to ${newState}`,
    )
  }

  // Atomically update state + write audit
  await pool.query('BEGIN')
  try {
    const before = currentState
    const after = newState
    const completedAt = ['succeeded', 'failed', 'cancelled', 'rejected'].includes(newState)
      ? new Date().toISOString()
      : null

    await pool.query(
      `UPDATE action_run
       SET state = $1, updated_at = NOW(), completed_at = $2
       WHERE id = $3`,
      [newState, completedAt, runId],
    )

    await pool.query(
      `INSERT INTO action_audit (run_id, event, before_json, after_json, actor_id, created_at)
       VALUES ($1, 'state_change', $2, $3, $4, NOW())`,
      [runId, JSON.stringify(before), JSON.stringify(after), actorId],
    )

    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
}

// ── submitRun ──────────────────────────────────────────────────────────────

export async function submitRun(
  name: string,
  args: unknown,
  principal: Principal,
  reason?: string,
): Promise<{ run_id: string; state: string }> {
  const pool = getPgPool()

  // 1. Lookup action definition
  const def = _registry.get(name)
  if (!def) {
    throw new Error(`action_not_found:${name}`)
  }

  // 2. Schema validation (basic)
  // In production, use AJV; for now accept any args
  if (typeof args !== 'object' || args === null) {
    throw new Error('invalid_args:args must be an object')
  }

  // 3. Precondition evaluation
  if (def.preconditions) {
    const precondResult = await evaluatePreconditions(def.preconditions, args as Record<string, unknown>, principal)
    if (!precondResult.pass) {
      throw new Error(`precondition_failed:${JSON.stringify(precondResult.detail)}`)
    }
  }

  // 4. Permissions V2 check (EXECUTE)
  const decision = await evaluateAcl(principal, 'EXECUTE', { action_name: name } as AclResource)
  if (!decision.allow) {
    throw new Error('permission_denied')
  }

  // 5. Determine initial state
  let initialState = 'draft'
  if (def.riskLevel === 'high' || def.approvalPolicy.required) {
    initialState = 'pending'
  } else {
    initialState = 'approved'
  }

  // 6. Write action_run
  const runId = randomUUID()
  await pool.query(
    `INSERT INTO action_run
     (id, action_name, actor_id, actor_role, args, reason, state, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NOW(), NOW())`,
    [runId, name, String(principal.user_id), principal.roles[0] ?? 'viewer', JSON.stringify(args), reason, initialState],
  )

  // 7. Write audit: state_change (null → initialState)
  await pool.query(
    `INSERT INTO action_audit (run_id, event, before_json, after_json, actor_id, created_at)
     VALUES ($1, 'state_change', null, $2, $3, NOW())`,
    [runId, JSON.stringify(initialState), String(principal.user_id)],
  )

  // 8. Send webhook: submitted (fire-and-forget)
  if (def.webhook?.events?.includes('submitted')) {
    sendActionWebhook(runId, name, 'submitted', String(principal.user_id), args, undefined).catch(() => {})
  }

  // 9. If approved, trigger execution
  if (initialState === 'approved') {
    setImmediate(() => {
      runApproved(runId).catch(() => {})
    })
  }

  return { run_id: runId, state: initialState }
}

// ── runApproved (handler execution) ────────────────────────────────────────

async function runApproved(runId: string): Promise<void> {
  const pool = getPgPool()

  // Fetch run
  const { rows: runRows } = await pool.query(
    'SELECT action_name, actor_id, args, state FROM action_run WHERE id = $1',
    [runId],
  )
  if (runRows.length === 0) return
  const run = runRows[0] as {
    action_name: string
    actor_id: string
    args: string
    state: string
  }

  if (run.state !== 'approved') return

  const def = _registry.get(run.action_name)
  if (!def) return

  try {
    // Transition to executing
    await transitionState(runId, 'executing', run.actor_id)

    // Send webhook: started
    if (def.webhook?.events?.includes('started')) {
      sendActionWebhook(runId, run.action_name, 'started', run.actor_id, JSON.parse(run.args), undefined).catch(
        () => {},
      )
    }

    // Fetch up-to-date principal for context
    const { rows: principalRows } = await pool.query(
      'SELECT actor_role FROM action_run WHERE id = $1',
      [runId],
    )
    const principal: Principal = {
      user_id: Number(run.actor_id),
      email: '',
      roles: principalRows.length > 0 ? [principalRows[0].actor_role] : ['viewer'],
      permissions: [],
    }

    // Increment attempts + execute handler
    await pool.query('UPDATE action_run SET attempts = attempts + 1 WHERE id = $1', [runId])
    const ctx: ActionContext = {
      runId,
      principal,
      attempts: 1,
    }
    const result = await def.handler(JSON.parse(run.args), ctx)

    // Success: state → succeeded
    await transitionState(runId, 'succeeded', run.actor_id)
    await pool.query('UPDATE action_run SET result = $1 WHERE id = $2', [JSON.stringify(result), runId])

    // Send webhook: succeeded
    if (def.webhook?.events?.includes('succeeded')) {
      sendActionWebhook(runId, run.action_name, 'succeeded', run.actor_id, JSON.parse(run.args), result).catch(
        () => {},
      )
    }
  } catch (err) {
    // Failure: state → failed
    const errorObj = {
      code: err instanceof ActionFatalError ? err.code : 'unknown',
      message: err instanceof Error ? err.message : String(err),
    }
    await transitionState(runId, 'failed', run.actor_id)
    await pool.query('UPDATE action_run SET error = $1 WHERE id = $2', [JSON.stringify(errorObj), runId])

    // Send webhook: failed
    if (def.webhook?.events?.includes('failed')) {
      sendActionWebhook(runId, run.action_name, 'failed', run.actor_id, JSON.parse(run.args), undefined).catch(
        () => {},
      )
    }
  }
}

// ── approveRun / rejectRun ─────────────────────────────────────────────────

export async function approveRun(
  runId: string,
  principal: Principal,
  note?: string,
): Promise<void> {
  const pool = getPgPool()

  const { rows: runRows } = await pool.query(
    'SELECT state, action_name FROM action_run WHERE id = $1',
    [runId],
  )
  if (runRows.length === 0) throw new Error(`run_not_found:${runId}`)

  const run = runRows[0] as { state: string; action_name: string }
  const def = _registry.get(run.action_name)

  if (run.state !== 'pending') {
    throw new InvalidStateTransitionError(`Cannot approve from state ${run.state}`)
  }

  // Check approver role
  if (!def?.approvalPolicy.approverRoles.some((r) => principal.roles.includes(r))) {
    throw new Error('approver_role_required')
  }

  // Update run with approver info
  await pool.query(
    'UPDATE action_run SET approver_id = $1, approval_note = $2, updated_at = NOW() WHERE id = $3',
    [String(principal.user_id), note || null, runId],
  )

  // Transition to approved
  await transitionState(runId, 'approved', String(principal.user_id))

  // Send webhook: approved
  const { rows: detailRows } = await pool.query(
    'SELECT args FROM action_run WHERE id = $1',
    [runId],
  )
  if (def?.webhook?.events?.includes('approved') && detailRows.length > 0) {
    const args = JSON.parse((detailRows[0] as { args: string }).args)
    sendActionWebhook(runId, run.action_name, 'approved', String(principal.user_id), args, undefined).catch(() => {})
  }

  // Trigger execution
  setImmediate(() => {
    runApproved(runId).catch(() => {})
  })
}

export async function rejectRun(
  runId: string,
  principal: Principal,
  note?: string,
): Promise<void> {
  const pool = getPgPool()

  const { rows: runRows } = await pool.query(
    'SELECT state, action_name FROM action_run WHERE id = $1',
    [runId],
  )
  if (runRows.length === 0) throw new Error(`run_not_found:${runId}`)

  const run = runRows[0] as { state: string; action_name: string }
  const def = _registry.get(run.action_name)

  if (run.state !== 'pending') {
    throw new InvalidStateTransitionError(`Cannot reject from state ${run.state}`)
  }

  // Check approver role
  if (!def?.approvalPolicy.approverRoles.some((r) => principal.roles.includes(r))) {
    throw new Error('approver_role_required')
  }

  // Update run with approver info
  await pool.query(
    'UPDATE action_run SET approver_id = $1, approval_note = $2, updated_at = NOW() WHERE id = $3',
    [String(principal.user_id), note || null, runId],
  )

  // Transition to rejected
  await transitionState(runId, 'rejected', String(principal.user_id))

  // Send webhook: rejected
  const { rows: detailRows } = await pool.query(
    'SELECT args FROM action_run WHERE id = $1',
    [runId],
  )
  if (def?.webhook?.events?.includes('rejected') && detailRows.length > 0) {
    const args = JSON.parse((detailRows[0] as { args: string }).args)
    sendActionWebhook(runId, run.action_name, 'rejected', String(principal.user_id), args, undefined).catch(() => {})
  }
}

// ── cancelRun ──────────────────────────────────────────────────────────────

export async function cancelRun(runId: string, principal: Principal): Promise<void> {
  const pool = getPgPool()

  const { rows: runRows } = await pool.query(
    'SELECT state, actor_id, action_name FROM action_run WHERE id = $1',
    [runId],
  )
  if (runRows.length === 0) throw new Error(`run_not_found:${runId}`)

  const run = runRows[0] as { state: string; actor_id: string; action_name: string }

  // Check permission: owner or admin
  const isOwner = String(run.actor_id) === String(principal.user_id)
  const isAdmin = principal.roles.includes('admin')
  if (!isOwner && !isAdmin) {
    throw new Error('permission_denied')
  }

  if (run.state === 'executing') {
    // Set flag, return 202
    await pool.query('UPDATE action_run SET cancel_requested = true WHERE id = $1', [runId])
  } else if (['draft', 'pending', 'approved'].includes(run.state)) {
    // Direct cancel
    await transitionState(runId, 'cancelled', String(principal.user_id))

    // Send webhook: cancelled
    const def = _registry.get(run.action_name)
    const { rows: detailRows } = await pool.query(
      'SELECT args FROM action_run WHERE id = $1',
      [runId],
    )
    if (def?.webhook?.events?.includes('cancelled') && detailRows.length > 0) {
      const args = JSON.parse((detailRows[0] as { args: string }).args)
      sendActionWebhook(runId, run.action_name, 'cancelled', String(principal.user_id), args, undefined).catch(() => {})
    }
  } else {
    throw new InvalidStateTransitionError(`Cannot cancel from state ${run.state}`)
  }
}

// ── listRuns ───────────────────────────────────────────────────────────────

export interface ListRunsOptions {
  state?: string         // filter by state; e.g. 'pending' / 'executing' / 'succeeded' / ...
  actionName?: string    // filter by action_name
  limit?: number         // default 50, max 200
  offset?: number        // default 0
}

/**
 * List action runs visible to `principal`.
 *
 *   - admin (role includes 'admin'): see ALL runs
 *   - non-admin: see only runs they submitted (actor_id = principal.user_id)
 *
 * 不返回 audit_log（用 getRun 单条查时再带）。结果按 created_at DESC 分页。
 */
export async function listRuns(
  principal: Principal,
  opts: ListRunsOptions = {},
): Promise<{ items: ActionRun[]; total: number }> {
  const pool = getPgPool()
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  const isAdmin = principal.roles?.includes('admin') ?? false

  const conds: string[] = []
  const params: unknown[] = []
  if (!isAdmin) {
    params.push(String(principal.user_id))
    conds.push(`actor_id = $${params.length}`)
  }
  if (opts.state) {
    params.push(opts.state)
    conds.push(`state = $${params.length}`)
  }
  if (opts.actionName) {
    params.push(opts.actionName)
    conds.push(`action_name = $${params.length}`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  // count
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM action_run ${where}`,
    params,
  )
  const total = (countRows[0]?.total ?? 0) as number

  // data
  params.push(limit, offset)
  const { rows } = await pool.query(
    `SELECT id, action_name, actor_id, actor_role, args, reason, state, attempts,
            result, error, approver_id, approval_note,
            created_at, updated_at, completed_at
       FROM action_run
       ${where}
   ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  const items: ActionRun[] = rows.map((r: any) => ({
    id: r.id,
    actionName: r.action_name,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    args: r.args ? (typeof r.args === 'string' ? JSON.parse(r.args) : r.args) : {},
    reason: r.reason ?? undefined,
    state: r.state,
    attempts: r.attempts,
    result: r.result ? (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) : undefined,
    error: r.error ? (typeof r.error === 'string' ? JSON.parse(r.error) : r.error) : undefined,
    approverId: r.approver_id ?? undefined,
    approvalNote: r.approval_note ?? undefined,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
  }))

  return { items, total }
}

// ── getRun ─────────────────────────────────────────────────────────────────

export async function getRun(runId: string, principal: Principal): Promise<ActionRun> {
  const pool = getPgPool()

  const { rows: runRows } = await pool.query(
    `SELECT id, action_name, actor_id, actor_role, args, reason, state, attempts,
            result, error, approver_id, approval_note, created_at, updated_at, completed_at
     FROM action_run WHERE id = $1`,
    [runId],
  )

  if (runRows.length === 0) {
    throw new Error(`run_not_found:${runId}`)
  }

  const run = runRows[0] as any

  // ACL: actor can always view; otherwise require READ permission
  const isActor = String(run.actor_id) === String(principal.user_id)
  if (!isActor) {
    const decision = await evaluateAcl(principal, 'READ', { action_run_id: runId } as AclResource)
    if (!decision.allow) {
      throw new Error(`run_not_found:${runId}`)
    }
  }

  // Fetch audit log (last 5)
  const { rows: auditRows } = await pool.query(
    `SELECT id, run_id, event, before_json, after_json, actor_id, extra, created_at
     FROM action_audit WHERE run_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [runId],
  )

  return {
    id: run.id,
    actionName: run.action_name,
    actorId: run.actor_id,
    actorRole: run.actor_role,
    args: JSON.parse(run.args),
    reason: run.reason,
    state: run.state,
    attempts: run.attempts,
    result: run.result ? JSON.parse(run.result) : undefined,
    error: run.error ? JSON.parse(run.error) : undefined,
    approverId: run.approver_id,
    approvalNote: run.approval_note,
    createdAt: new Date(run.created_at),
    updatedAt: new Date(run.updated_at),
    completedAt: run.completed_at ? new Date(run.completed_at) : undefined,
    auditLog: auditRows.reverse().map((r: any) => ({
      id: r.id,
      runId: r.run_id,
      event: r.event,
      beforeJson: r.before_json ? JSON.parse(r.before_json) : undefined,
      afterJson: r.after_json ? JSON.parse(r.after_json) : undefined,
      actorId: r.actor_id,
      extra: r.extra ? JSON.parse(r.extra) : undefined,
      createdAt: new Date(r.created_at),
    })),
  }
}
