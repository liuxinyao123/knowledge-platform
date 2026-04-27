/**
 * api/fileSource.ts —— 文件服务器接入 API 封装
 * 契约：openspec/changes/file-source-integration/specs/file-source-api-spec.md
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/file-sources' })

export type FileSourceType = 'smb' | 's3' | 'webdav' | 'sftp'

export interface FileSource {
  id: number
  type: FileSourceType
  name: string
  config_json: Record<string, unknown>
  cron: string
  last_cursor?: { lastScanAt: string | null; seenIds: string[] } | null
  last_scan_status: 'ok' | 'partial' | 'error' | null
  last_scan_error: string | null
  last_scan_at: string | null
  permission_source_id: number | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ScanLog {
  id: number
  source_id: number
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'partial' | 'error'
  added_count: number
  updated_count: number
  removed_count: number
  failed_items: Array<{ id: string; error: string }> | null
  error_message: string | null
}

export interface CreateFileSourceInput {
  type: FileSourceType
  name: string
  config_json: Record<string, unknown>
  cron?: string
  permission_source_id?: number | null
  enabled?: boolean
}

export type PatchFileSourceInput = Partial<Omit<CreateFileSourceInput, 'type'>>

export const fileSourceApi = {
  list: (): Promise<{ items: FileSource[] }> =>
    client.get('/').then((r) => r.data),
  get: (id: number): Promise<FileSource> =>
    client.get(`/${id}`).then((r) => r.data),
  create: (body: CreateFileSourceInput): Promise<FileSource> =>
    client.post('/', body).then((r) => r.data),
  patch: (id: number, body: PatchFileSourceInput): Promise<FileSource> =>
    client.patch(`/${id}`, body).then((r) => r.data),
  remove: (id: number): Promise<void> =>
    client.delete(`/${id}`).then(() => undefined),
  scan: (id: number): Promise<{ scan_log_id: number | null; status: 'queued' | 'already_running' }> =>
    client.post(`/${id}/scan`).then((r) => r.data),
  logs: (id: number, limit = 20): Promise<{ items: ScanLog[] }> =>
    client.get(`/${id}/logs`, { params: { limit } }).then((r) => r.data),
  test: (id: number): Promise<
    { ok: true; sample: Array<{ id: string; name: string; path: string; size: number; mtime: string }> }
    | { ok: false; error_code: string; message: string }
  > =>
    client.post(`/${id}/test`).then((r) => r.data),
}
