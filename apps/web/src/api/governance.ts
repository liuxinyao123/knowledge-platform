import axios from 'axios'

export interface GovUser {
  id: number
  name: string
  email: string
  avatar_url: string | null
  role: 'admin' | 'editor' | 'viewer'
}

export interface GovShelf {
  id: number
  name: string
  visibility: 'public' | 'team' | 'private'
}

const govClient = axios.create({ baseURL: '/api/governance' })

// ── G1 knowledge-governance ──────────────────────────────────────────────

export interface TagInfo {
  name: string
  count: number
  recentGrowth: number
}

export interface DuplicatePair {
  a: { id: number; name: string }
  b: { id: number; name: string }
  similarity: number
}

export type QualityIssueKind =
  | 'missing_author' | 'stale' | 'empty_content' | 'no_tags'

export interface QualityIssueGroup {
  kind: QualityIssueKind
  description: string
  count: number
  hint: string
}

export interface AuditEntry {
  id: number
  ts: string
  principal_user_id: number | null
  principal_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
}

export const govApi = {
  getUsers: (): Promise<{ users: GovUser[] }> =>
    govClient.get('/users').then((r) => r.data),
  updateUserRole: (id: number, role: string): Promise<{ ok: boolean }> =>
    govClient.put(`/users/${id}/role`, { role }).then((r) => r.data),
  getShelfVisibility: (): Promise<{ shelves: GovShelf[] }> =>
    govClient.get('/shelf-visibility').then((r) => r.data),
  updateShelfVisibility: (id: number, visibility: string): Promise<{ ok: boolean }> =>
    govClient.put(`/shelf-visibility/${id}`, { visibility }).then((r) => r.data),

  // G1 —— 知识治理
  listTags: (): Promise<{ items: TagInfo[]; total: number }> =>
    govClient.get('/tags').then((r) => r.data),
  mergeTags: (srcs: string[], dst: string): Promise<{ ok: boolean; affected: number }> =>
    govClient.post('/tags/merge', { srcs, dst }).then((r) => r.data),
  renameTag: (from: string, to: string): Promise<{ ok: boolean; affected: number }> =>
    govClient.post('/tags/rename', { from, to }).then((r) => r.data),

  listDuplicates: (threshold = 0.85, limit = 50): Promise<{ items: DuplicatePair[]; total: number }> =>
    govClient.get('/duplicates', { params: { threshold, limit } }).then((r) => r.data),
  mergeAssets: (srcId: number, dstId: number): Promise<{ ok: boolean }> =>
    govClient.post('/duplicates/merge', { srcId, dstId }).then((r) => r.data),
  dismissDuplicate: (a: number, b: number): Promise<{ ok: boolean }> =>
    govClient.post('/duplicates/dismiss', { a, b }).then((r) => r.data),

  listQualityIssues: (): Promise<{ items: QualityIssueGroup[] }> =>
    govClient.get('/quality').then((r) => r.data),
  listQualityAssets: (kind: QualityIssueKind, limit = 50): Promise<{
    items: Array<{ id: number; name: string; updatedAt?: string }>
    total: number
  }> =>
    govClient.get(`/quality/${kind}`, { params: { limit } }).then((r) => r.data),
  fixQualityIssue: (kind: QualityIssueKind, assetIds: number[]): Promise<{
    ok: boolean; fixed: number; reminded?: number[]
  }> =>
    govClient.post('/quality/fix', { kind, assetIds }).then((r) => r.data),

  listAuditLog: (params: {
    from?: string; to?: string; action?: string; user_id?: number
    limit?: number; offset?: number
  } = {}): Promise<{ items: AuditEntry[]; total: number }> =>
    govClient.get('/audit-log', { params }).then((r) => r.data),

  /** CSV 下载 URL（前端用 <a href> 触发下载，避免 fetch 处理二进制） */
  auditLogCsvUrl: (params: Record<string, string | number> = {}): string => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString()
    return `/api/governance/audit-log.csv${qs ? '?' + qs : ''}`
  },
}
