import axios from 'axios'

const mcpClient = axios.create({ baseURL: '/api/mcp' })
const graphClient = axios.create({ baseURL: '/api/graph' })

export interface DebugQueryResult {
  ok: boolean
  authCheck: { passed: boolean; rules: string[] }
  rowFilter?: string
  maskedFields?: string[]
  rows: Array<Record<string, unknown>>
  durationMs: number
  reason?: string
  note?: string
}

export interface CypherResult {
  nodes: Array<{ id: string; label: string; count?: number }>
  edges: Array<{ from: string; to: string; label: string }>
  durationMs: number
  note?: string
}

export interface McpStats {
  assetsTotal: number
  chunksTotal: number
  chunksEmbedded: number
  ingestsLast24h: number
  ingestsLast7d: number
  qasLast24h: number
  lastAssetIndexedAt: string | null
  lastQaAt: string | null
  actions7d: Array<{ action: string; count: number; last_at: string | null }>
  generatedAt: string
}

export const mcpDebugApi = {
  debugQuery: (source: string, sql: string): Promise<DebugQueryResult> =>
    mcpClient.post('/debug-query', { source, sql }).then((r) => r.data),
  runCypher: (query: string): Promise<CypherResult> =>
    graphClient.post('/cypher', { query }).then((r) => r.data),
  getStats: (): Promise<McpStats> =>
    mcpClient.get('/stats').then((r) => r.data),
}
