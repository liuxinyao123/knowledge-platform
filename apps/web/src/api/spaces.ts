/**
 * api/spaces.ts —— space-permissions 前端 API 客户端
 *
 * 契约：openspec/changes/space-permissions/specs/space-permissions-spec.md
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/spaces' })

export type SpaceVisibility = 'org' | 'private'
export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type SpaceMemberSubjectType = 'user' | 'team'

export interface SpaceSummary {
  id: number
  slug: string
  name: string
  description: string | null
  visibility: SpaceVisibility
  owner_email: string
  doc_count: number
  source_count: number
  member_count: number
  my_role: SpaceRole | null
  updated_at_ms: number
}

export interface SpaceRoleDefaultRule {
  effect: 'allow' | 'deny'
  permission: 'READ' | 'WRITE' | 'DELETE' | 'ADMIN'
  permission_required?: string | null
}

export type SpaceRoleTemplates = Record<SpaceRole, SpaceRoleDefaultRule[]>

export interface SpaceMemberPreview {
  subject_type: SpaceMemberSubjectType
  subject_id: string
  role: SpaceRole
  added_at: string
}

export interface SpaceDetail extends SpaceSummary {
  is_member: boolean
  created_at: string
  updated_at: string
  members_preview: SpaceMemberPreview[]
  role_templates: SpaceRoleTemplates
}

export interface SpaceMember {
  subject_type: SpaceMemberSubjectType
  subject_id: string
  role: SpaceRole
  display_name: string
  added_by: string | null
  added_at: string
  derived_permissions: string[]
}

export interface SpaceSourceItem {
  id: number
  name: string
  tag: string | null
  asset_count: number
  updated_at_ms: number
}

export interface SpaceSourceGroup {
  name: string
  sources: SpaceSourceItem[]
}

// ── spaces ──────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<SpaceSummary[]> {
  const { data } = await client.get<{ items?: SpaceSummary[] }>('/')
  // 防御：后端旧进程未挂 /api/spaces 时 axios 可能拿到 HTML / 非预期 shape
  return Array.isArray(data?.items) ? data.items : []
}

export async function getSpace(id: number): Promise<SpaceDetail> {
  const { data } = await client.get<SpaceDetail>(`/${id}`)
  return data
}

export interface CreateSpacePayload {
  slug: string
  name: string
  description?: string | null
  visibility?: SpaceVisibility
  initialMembers?: Array<{ subject_type: SpaceMemberSubjectType; subject_id: string; role: SpaceRole }>
}

export async function createSpace(payload: CreateSpacePayload): Promise<{ id: number }> {
  const { data } = await client.post<{ id: number }>('/', payload)
  return data
}

export interface UpdateSpacePayload {
  name?: string
  description?: string | null
  visibility?: SpaceVisibility
}

export async function updateSpace(id: number, patch: UpdateSpacePayload): Promise<void> {
  await client.patch(`/${id}`, patch)
}

export async function deleteSpace(id: number): Promise<void> {
  await client.delete(`/${id}`, { data: { confirm: true } })
}

export async function getRoleTemplates(): Promise<SpaceRoleTemplates> {
  const { data } = await client.get<{ templates: SpaceRoleTemplates }>('/role-templates')
  return data.templates
}

// ── members ─────────────────────────────────────────────────────────────────

export async function listMembers(id: number): Promise<SpaceMember[]> {
  const { data } = await client.get<{ items?: SpaceMember[] }>(`/${id}/members`)
  return Array.isArray(data?.items) ? data.items : []
}

export async function addMember(
  id: number,
  body: { subject_type: SpaceMemberSubjectType; subject_id: string; role: Exclude<SpaceRole, 'owner'> },
): Promise<void> {
  await client.post(`/${id}/members`, body)
}

function memberKey(subject_type: SpaceMemberSubjectType, subject_id: string): string {
  return encodeURIComponent(`${subject_type}:${subject_id}`)
}

export async function updateMember(
  id: number,
  subject_type: SpaceMemberSubjectType,
  subject_id: string,
  role: Exclude<SpaceRole, 'owner'>,
): Promise<void> {
  await client.patch(`/${id}/members/${memberKey(subject_type, subject_id)}`, { role })
}

export async function removeMember(
  id: number,
  subject_type: SpaceMemberSubjectType,
  subject_id: string,
): Promise<void> {
  await client.delete(`/${id}/members/${memberKey(subject_type, subject_id)}`)
}

export async function transferOwner(id: number, subject_id: string): Promise<void> {
  await client.post(`/${id}/transfer-owner`, { subject_type: 'user', subject_id })
}

// ── sources ─────────────────────────────────────────────────────────────────

export async function listSpaceSources(
  id: number,
  groupBy: 'tag' | 'none' = 'tag',
): Promise<SpaceSourceGroup[]> {
  const { data } = await client.get<{ groups?: SpaceSourceGroup[] }>(`/${id}/sources`, { params: { groupBy } })
  return Array.isArray(data?.groups) ? data.groups : []
}

export async function attachSources(id: number, source_ids: number[]): Promise<number> {
  const { data } = await client.post<{ added: number }>(`/${id}/sources`, { source_ids })
  return data.added
}

export async function detachSource(id: number, source_id: number): Promise<void> {
  await client.delete(`/${id}/sources/${source_id}`)
}
