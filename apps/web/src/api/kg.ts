/**
 * api/kg.ts —— 知识图谱前端 API（ADR 2026-04-23-27）
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/kg' })

export interface KgStatus {
  enabled: boolean
  stats: { nodes: number; edges: number } | null
}

export interface KgNeighborhood {
  nodes: Array<{ id: string; label: string; kind: 'asset' | 'source' | 'space' | 'tag' | 'question'; count?: number }>
  edges: Array<{ from: string; to: string; kind: string; weight?: number }>
}

export async function getKgStatus(): Promise<KgStatus> {
  const { data } = await client.get<KgStatus>('/status')
  return data
}

export async function getAssetNeighbors(assetId: number): Promise<KgNeighborhood> {
  const { data } = await client.get<KgNeighborhood>(`/assets/${assetId}/neighbors`)
  // 防御：后端返异常 shape 时不炸
  return {
    nodes: Array.isArray(data?.nodes) ? data.nodes : [],
    edges: Array.isArray(data?.edges) ? data.edges : [],
  }
}

// ── knowledge-graph-view ────────────────────────────────────────────────────

export interface KgGraphNode {
  id: string
  label: string
  type: string
  degree: number
}

export interface KgGraphEdge {
  source: string
  target: string
  kind: 'CO_CITED' | 'HAS_TAG'
  weight?: number
}

export interface KgGraphPayload {
  space_id: number
  generated_at: string
  empty: boolean
  hint?: 'space_not_in_graph'
  truncated: boolean
  stats: { node_count: number; edge_count: number }
  nodes: KgGraphNode[]
  edges: KgGraphEdge[]
}

export async function getKgGraph(spaceId: number): Promise<KgGraphPayload> {
  const { data } = await client.get<KgGraphPayload>('/graph', { params: { spaceId } })
  return {
    ...data,
    nodes: Array.isArray(data?.nodes) ? data.nodes : [],
    edges: Array.isArray(data?.edges) ? data.edges : [],
  }
}
