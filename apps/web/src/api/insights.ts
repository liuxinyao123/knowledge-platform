/**
 * api/insights.ts —— graph-insights 前端 API 客户端
 *
 * 契约：openspec/changes/graph-insights/specs/graph-insights-spec.md
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/insights' })

export interface InsightIsolated {
  key: string
  asset_id: number
  name: string
  type: string
  degree: number
  created_at: string | null
}

export interface InsightBridge {
  key: string
  asset_id: number
  name: string
  type: string
  bridge_count: number
  mode: 'community' | 'tag'
  neighbor_sample: number[]
}

export interface InsightSurprise {
  key: string
  a: { id: number; name: string; type: string }
  b: { id: number; name: string; type: string }
  edge_weight: number
  cross_community: boolean
  cross_type: boolean
  surprise_score: number
}

export interface InsightSparseCore {
  id: number
  name: string
  degree: number
}

export interface InsightSparse {
  key: string
  community_id: number
  size: number
  cohesion: number
  core_assets: InsightSparseCore[]
}

export interface InsightsPayload {
  space_id: number
  generated_at: string
  computed_at: string
  degraded: boolean
  degrade_reason: string | null
  stats: {
    asset_count: number
    edge_count: number
    community_count: number
  }
  isolated: InsightIsolated[]
  bridges: InsightBridge[]
  surprises: InsightSurprise[]
  sparse: InsightSparse[]
}

export interface DeepResearchTopicResponse {
  topic: string
  query_hint: string
  seed_asset_ids: number[]
  kind: 'isolated' | 'bridge' | 'surprise' | 'sparse'
}

export const insightsApi = {
  get: (spaceId: number): Promise<InsightsPayload> =>
    client.get('/', { params: { spaceId } }).then((r) => r.data),

  refresh: (spaceId: number): Promise<InsightsPayload> =>
    client.post('/refresh', { spaceId }).then((r) => r.data),

  dismiss: (spaceId: number, insightKey: string): Promise<void> =>
    client.post('/dismiss', { spaceId, insight_key: insightKey }).then(() => undefined),

  undismiss: (spaceId: number, insightKey: string): Promise<void> =>
    client
      .delete('/dismiss', { data: { spaceId, insight_key: insightKey } })
      .then(() => undefined),

  topic: (spaceId: number, insightKey: string): Promise<DeepResearchTopicResponse> =>
    client
      .post('/topic', { spaceId, insight_key: insightKey })
      .then((r) => r.data),
}
