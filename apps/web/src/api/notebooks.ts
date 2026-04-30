/**
 * api/notebooks.ts —— Notebook V1 API client
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/notebooks' })

// ── types ────────────────────────────────────────────────────────────────────

export interface NotebookSummary {
  id: number
  name: string
  description: string | null
  owner_email: string
  /** 当前用户对该 notebook 的访问角色：owner / editor / reader */
  access?: 'owner' | 'editor' | 'reader'
  created_at_ms: number
  updated_at_ms: number
  source_count: number
  message_count: number
  /** N-006/N-007：模板 key（创建时选择，老 notebook 为 null）。N-007 起可为任意 community/user key，不再限定字面量 union */
  template_id?: string | null
}

export interface NotebookMember {
  subject_type: 'user' | 'team'
  subject_id: string         // user.email 或 team.id（数字字符串）
  role: 'reader' | 'editor'
  added_by: string | null
  added_at_ms: number
  display: string            // 用户邮箱 或 团队名
}

export interface NotebookSource {
  asset_id: number
  asset_name: string
  type: string
  tags: string[] | null
  indexed_at: string | null
  path: string | null
  added_at_ms: number
  chunks_total: number
}

export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /** asset-vector-coloc：来源 chunk 是 image_caption 时回填 */
  image_id?: number
  image_url?: string
}

export interface NotebookMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  citations: Citation[] | null
  trace: Record<string, unknown> | null
  created_at_ms: number
}

// N-002：跟后端 services/artifactGenerator.ts ARTIFACT_REGISTRY 同步
export type ArtifactKind =
  | 'briefing' | 'faq'                                          // V1
  | 'mindmap' | 'outline' | 'timeline'                          // N-002
  | 'comparison_matrix' | 'glossary' | 'slides'                 // N-002

export const ALL_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'briefing', 'faq',
  'mindmap', 'outline', 'timeline',
  'comparison_matrix', 'glossary', 'slides',
] as const

export type ArtifactStatus = 'pending' | 'running' | 'done' | 'failed'

export interface NotebookArtifact {
  id: number
  kind: ArtifactKind | string
  status: ArtifactStatus
  content: string | null
  meta: Record<string, unknown> | null
  error: string | null
  created_by: string | null
  created_at_ms: number
  finished_at_ms: number | null
}

// ── notebooks ───────────────────────────────────────────────────────────────

export async function listNotebooks(): Promise<{ items: NotebookSummary[]; shared: NotebookSummary[] }> {
  const { data } = await client.get<{ items: NotebookSummary[]; shared?: NotebookSummary[] }>('/')
  return { items: data.items ?? [], shared: data.shared ?? [] }
}

export async function createNotebook(input: {
  name: string; description?: string; template_id?: string | null
}): Promise<NotebookSummary> {
  const { data } = await client.post<NotebookSummary>('/', input)
  return data
}

// ── N-006/N-007：Notebook Templates ─────────────────────────────────────────
// 跟后端 services/notebookTemplates.ts 同步
//
// N-006：6 个 system 模板（字面量 union）
// N-007：把模板搬到 DB 表 notebook_template，加 source 字段；NotebookTemplateSpec.id
//        类型 widening 到 string（容纳 community / user 模板的任意 key）
//
// 内置 system id 字面量保留作类型 narrowing；不再约束 NotebookTemplateSpec.id
export type NotebookTemplateId =
  | 'research_review' | 'meeting_prep' | 'competitive_analysis'
  | 'learning_aid' | 'project_retrospective' | 'translation_explain'

export const ALL_NOTEBOOK_TEMPLATE_IDS: readonly NotebookTemplateId[] = [
  'research_review', 'meeting_prep', 'competitive_analysis',
  'learning_aid', 'project_retrospective', 'translation_explain',
] as const

/** N-007：模板来源 */
export type NotebookTemplateSource = 'system' | 'community' | 'user'

export interface NotebookTemplateSpec {
  /** N-007: 任意字符串（system 用 NotebookTemplateId，community/user 用 DB 生成的 key） */
  id: string
  /** N-007 新增：用来在 UI 上显示来源徽章 / 决定权限按钮 */
  source: NotebookTemplateSource
  label: string
  icon: string
  desc: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}

export async function listTemplates(): Promise<NotebookTemplateSpec[]> {
  const { data } = await client.get<{ templates: NotebookTemplateSpec[] }>('/templates')
  return data.templates
}

// ── N-008：用户自定义模板 CRUD ──────────────────────────────────────────────
// 跟后端 routes/templates.ts 同步
//
// 使用专门的 templatesClient（baseURL=/api/templates）而不是 client（/api/notebooks），
// 端点完全独立。

const templatesClient = axios.create({ baseURL: '/api/templates' })

/** N-008 用户自定义模板 input（创建用 / patch 用） */
export interface CreateUserTemplateInput {
  label: string
  icon: string
  description: string                       // ← 后端 service 字段名为 description（不是 desc）
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}

export interface UserTemplatesMeta {
  enabled: boolean
}

/** GET /api/templates/_meta —— 暴露 USER_TEMPLATES_ENABLED flag */
export async function getUserTemplatesMeta(): Promise<UserTemplatesMeta> {
  const { data } = await templatesClient.get<UserTemplatesMeta>('/_meta')
  return data
}

/** POST /api/templates */
export async function createUserTemplate(input: CreateUserTemplateInput): Promise<NotebookTemplateSpec> {
  const { data } = await templatesClient.post<NotebookTemplateSpec>('/', input)
  return data
}

/** PATCH /api/templates/:key */
export async function updateUserTemplate(
  key: string,
  patch: Partial<CreateUserTemplateInput>,
): Promise<NotebookTemplateSpec> {
  const { data } = await templatesClient.patch<NotebookTemplateSpec>(`/${encodeURIComponent(key)}`, patch)
  return data
}

/** DELETE /api/templates/:key */
export async function deleteUserTemplate(key: string): Promise<void> {
  await templatesClient.delete(`/${encodeURIComponent(key)}`)
}

export async function getNotebook(id: number): Promise<{
  notebook: NotebookSummary
  sources: NotebookSource[]
  messages: NotebookMessage[]
}> {
  const { data } = await client.get(`/${id}`)
  return data
}

export async function updateNotebook(id: number, input: {
  name?: string; description?: string
}): Promise<void> {
  await client.patch(`/${id}`, input)
}

export async function deleteNotebook(id: number): Promise<void> {
  await client.delete(`/${id}`)
}

// ── sources ────────────────────────────────────────────────────────────────

export async function addSources(notebookId: number, assetIds: number[]): Promise<{ inserted: number }> {
  const { data } = await client.post(`/${notebookId}/sources`, { asset_ids: assetIds })
  return data
}

export async function removeSource(notebookId: number, assetId: number): Promise<void> {
  await client.delete(`/${notebookId}/sources/${assetId}`)
}

// ── messages ────────────────────────────────────────────────────────────────

export async function listMessages(notebookId: number): Promise<NotebookMessage[]> {
  const { data } = await client.get<{ items: NotebookMessage[] }>(`/${notebookId}/messages`)
  return data.items
}

export async function clearMessages(notebookId: number): Promise<void> {
  await client.delete(`/${notebookId}/messages`)
}

// ── artifacts ──────────────────────────────────────────────────────────────

export async function listArtifacts(notebookId: number): Promise<NotebookArtifact[]> {
  const { data } = await client.get<{ items: NotebookArtifact[] }>(`/${notebookId}/artifacts`)
  return data.items
}

export async function generateArtifact(notebookId: number, kind: ArtifactKind): Promise<{ artifactId: number }> {
  const { data } = await client.post(`/${notebookId}/artifacts/${kind}`)
  return data
}

export async function getArtifact(notebookId: number, artifactId: number): Promise<NotebookArtifact> {
  const { data } = await client.get<NotebookArtifact>(`/${notebookId}/artifacts/${artifactId}`)
  return data
}

export async function deleteArtifact(notebookId: number, artifactId: number): Promise<void> {
  await client.delete(`/${notebookId}/artifacts/${artifactId}`)
}

// ── Members（共享） ────────────────────────────────────────────────────────

export async function listMembers(notebookId: number): Promise<NotebookMember[]> {
  const { data } = await client.get<{ items: NotebookMember[] }>(`/${notebookId}/members`)
  return data.items
}

export async function addMember(notebookId: number, input: {
  subject_type: 'user' | 'team'; subject_id: string; role?: 'reader' | 'editor'
}): Promise<void> {
  await client.post(`/${notebookId}/members`, input)
}

export async function removeMember(
  notebookId: number, subjectType: 'user' | 'team', subjectId: string,
): Promise<void> {
  await client.delete(`/${notebookId}/members/${subjectType}/${encodeURIComponent(subjectId)}`)
}
