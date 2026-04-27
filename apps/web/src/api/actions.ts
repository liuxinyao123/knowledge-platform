/**
 * api/actions.ts
 *
 * Typed fetch client for Action Framework API
 */

import axios from 'axios'

export interface ActionDefinition {
  name: string
  description: string
  risk_level: 'low' | 'medium' | 'high'
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  approval_policy: { required: boolean; approver_roles: string[] }
  can_submit: boolean
}

export interface ActionRun {
  id: string
  action_name: string
  actor_id: string
  actor_role: string
  args: Record<string, unknown>
  reason?: string
  state: string
  attempts: number
  result?: Record<string, unknown>
  error?: Record<string, unknown>
  approver_id?: string
  approval_note?: string
  created_at: string
  updated_at: string
  completed_at?: string
  audit_log?: ActionAuditEntry[]
}

export interface ActionAuditEntry {
  id: string
  run_id: string
  event: string
  before_json?: Record<string, unknown>
  after_json?: Record<string, unknown>
  actor_id: string
  extra?: Record<string, unknown>
  created_at: string
}

const actionsClient = axios.create({ baseURL: '/api/actions' })

export const actionsApi = {
  // GET /api/actions
  listActions: (): Promise<{ items: ActionDefinition[] }> =>
    actionsClient.get('/').then((r) => r.data),

  // POST /api/actions/:name/run
  submitRun: (
    name: string,
    args: Record<string, unknown>,
    reason?: string,
  ): Promise<{ run_id: string; state: string }> =>
    actionsClient
      .post(`/${encodeURIComponent(name)}/run`, { args, reason })
      .then((r) => r.data),

  // GET /api/actions/runs — list runs (admin sees all, others see own)
  listRuns: (opts: {
    state?: string
    actionName?: string
    limit?: number
    offset?: number
  } = {}): Promise<{ items: ActionRun[]; total: number }> =>
    actionsClient
      .get('/runs', {
        params: {
          state: opts.state,
          action_name: opts.actionName,
          limit: opts.limit,
          offset: opts.offset,
        },
      })
      .then((r) => r.data),

  // GET /api/actions/runs/:run_id
  getRun: (runId: string): Promise<ActionRun> =>
    actionsClient.get(`/runs/${encodeURIComponent(runId)}`).then((r) => r.data),

  // POST /api/actions/runs/:run_id/approve
  approveRun: (runId: string, note?: string): Promise<{ ok: boolean }> =>
    actionsClient
      .post(`/runs/${encodeURIComponent(runId)}/approve`, { note })
      .then((r) => r.data),

  // POST /api/actions/runs/:run_id/reject
  rejectRun: (runId: string, note?: string): Promise<{ ok: boolean }> =>
    actionsClient
      .post(`/runs/${encodeURIComponent(runId)}/reject`, { note })
      .then((r) => r.data),

  // POST /api/actions/runs/:run_id/cancel
  cancelRun: (runId: string): Promise<{ ok: boolean }> =>
    actionsClient
      .post(`/runs/${encodeURIComponent(runId)}/cancel`, {})
      .then((r) => r.data),
}
