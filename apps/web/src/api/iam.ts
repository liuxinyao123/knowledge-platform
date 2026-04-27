/**
 * api/iam.ts —— G3/G4 admin API 封装（PRD §11-13 + §15）
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/acl' })

// ──────────────────────── Rule CRUD ────────────────────────

export type SubjectType = 'role' | 'user' | 'team'
export type RuleEffect = 'allow' | 'deny'

/** ACL 规则的 `permission` 字段合法取值（PRD §2 细粒度权限走 `permission_required`） */
export type AclAction = 'READ' | 'WRITE' | 'DELETE' | 'ADMIN'
export const ACL_ACTIONS: readonly AclAction[] = ['READ', 'WRITE', 'DELETE', 'ADMIN']

export interface AclRule {
  id: number
  source_id: number | null
  asset_id: number | null
  /** space-permissions (ADR 2026-04-23-26)：作用空间；null = org 级 */
  space_id?: number | null
  /** @deprecated 向后兼容 V1，新代码请用 subject_type+subject_id */
  role: string | null
  /** V2 新字段 */
  subject_type?: SubjectType | null
  subject_id?: string | null
  effect?: RuleEffect | null
  expires_at?: string | null
  /** ACL action：READ / WRITE / DELETE / ADMIN；ADMIN 是超集 */
  permission: AclAction | string
  /** PRD §2 细粒度权限（可选附加判断；null = 仅按 action 评估） */
  permission_required?: string | null
  condition: Record<string, unknown> | null
  created_at?: string
}

export interface RulePatch {
  source_id?: number | null
  asset_id?: number | null
  space_id?: number | null
  role?: string | null
  subject_type?: SubjectType | null
  subject_id?: string | null
  effect?: RuleEffect | null
  expires_at?: string | null
  permission?: AclAction | string
  permission_required?: string | null
  condition?: Record<string, unknown> | null
}

export interface ListRulesParams {
  source_id?: number
  asset_id?: number
  subject_type?: SubjectType
  subject_id?: string
}

export async function listRules(params?: ListRulesParams): Promise<AclRule[]> {
  const { data } = await client.get<{ items: AclRule[] }>('/rules', { params })
  return data.items
}

export async function createRule(rule: RulePatch): Promise<{ id: number }> {
  const { data } = await client.post<{ id: number }>('/rules', rule)
  return data
}

export async function updateRule(id: number, patch: RulePatch): Promise<void> {
  await client.put(`/rules/${id}`, patch)
}

export async function deleteRule(id: number): Promise<void> {
  await client.delete(`/rules/${id}`)
}

// ──────────────────────── Simulate ────────────────────────

export interface SimulatePrincipal {
  user_id?: number
  email?: string
  roles: string[]
  permissions?: string[]
}

export interface SimulateResource {
  source_id?: number
  asset_id?: number
  project_id?: string
  [k: string]: unknown
}

export interface SimulateResult {
  decision: {
    allow: boolean
    reason?: string
    filter?: { where: string; params: unknown[] }
    mask?: Array<{ field: string; mode: string }>
    matchedRuleIds?: number[]
  }
  durationMs: number
}

export async function simulateRule(
  principal: SimulatePrincipal,
  action: string,
  resource: SimulateResource,
): Promise<SimulateResult> {
  const { data } = await client.post<SimulateResult>('/rules/simulate', {
    principal, action, resource,
  })
  return data
}

// ──────────────────────── IAM 面板 ────────────────────────

export interface IamUser {
  user_id: string
  email: string
  roles: string[]
  permissions: string[]
  dev_bypass: boolean
  source: 'session' | 'seed'
}

export async function listUsers(): Promise<IamUser[]> {
  const { data } = await client.get<{ items: IamUser[] }>('/users')
  return data.items
}

export interface RoleMatrix {
  roles: string[]
  permissions: string[]
  matrix: Record<string, string[]>
}

export async function getRoleMatrix(): Promise<RoleMatrix> {
  const { data } = await client.get<RoleMatrix>('/role-matrix')
  return data
}

export async function listPermissions(): Promise<string[]> {
  const { data } = await client.get<{ permissions: string[] }>('/permissions')
  return data.permissions
}

// ──────────────────────── 用户 CRUD（G10） ────────────────────────
// 路由在 /api/auth（由 requireAuth + enforceAcl ADMIN 把关）
// 复用顶部已 import 的 axios
const authCli = axios.create({ baseURL: '/api/auth' })

export const userAdmin = {
  create: (email: string, password: string, roles: string[]): Promise<{ id: number }> =>
    authCli.post('/register', { email, password, roles }).then((r) => r.data),

  update: (id: number, patch: { email?: string; roles?: string[] }): Promise<void> =>
    authCli.patch(`/users/${id}`, patch).then(() => undefined),

  remove: (id: number): Promise<void> =>
    authCli.delete(`/users/${id}`).then(() => undefined),

  resetPassword: (id: number, newPassword: string): Promise<void> =>
    authCli.post(`/users/${id}/reset-password`, { newPassword }).then(() => undefined),

  changeOwnPassword: (oldPassword: string, newPassword: string): Promise<void> =>
    authCli.post('/password', { oldPassword, newPassword }).then(() => undefined),
}

// ──────────────────────── ACL Rule Audit (F-3) ────────────────────────

const iamCli = axios.create({ baseURL: '/api/iam/acl' })

export interface AuditRow {
  id: number
  rule_id: number | null
  actor_user_id: number | null
  actor_email: string | null
  op: 'CREATE' | 'UPDATE' | 'DELETE'
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  at: string  // ISO
}

export interface AuditFilters {
  rule_id?: number
  actor?: string
  since?: string    // ISO
  until?: string    // ISO
  limit?: number
}

export async function listAclAudit(
  filters: AuditFilters = {},
): Promise<{ items: AuditRow[]; total: number }> {
  const params: Record<string, string | number> = {}
  if (filters.rule_id != null) params.rule_id = filters.rule_id
  if (filters.actor) params.actor = filters.actor
  if (filters.since) params.since = filters.since
  if (filters.until) params.until = filters.until
  if (filters.limit != null) params.limit = filters.limit
  const r = await iamCli.get<{ items: AuditRow[]; total: number }>('/audit', { params })
  return r.data
}
