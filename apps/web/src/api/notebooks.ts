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
}

export interface NotebookMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  citations: Citation[] | null
  trace: Record<string, unknown> | null
  created_at_ms: number
}

export type ArtifactKind = 'briefing' | 'faq'
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
  name: string; description?: string
}): Promise<NotebookSummary> {
  const { data } = await client.post<NotebookSummary>('/', input)
  return data
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
