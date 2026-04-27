/**
 * graphInsights/config.ts —— 集中式配置读取
 *
 * design.md §环境变量清单。所有 env var 默认值在本文件落位；env 覆盖在启动时生效。
 */
export interface GraphInsightsConfig {
  enabled: boolean
  ttlSec: number
  louvainResolution: number
  maxEdges: number
  topSurprises: number
  weights: {
    crossCommunity: number
    crossType: number
    edgeLog: number
  }
  topicModel: string  // 空字符串 = 沿用 rag 同模型
  isolatedMinAgeDays: number
  sparseCohesionThreshold: number
  sparseMinSize: number
}

function numEnv(key: string, def: number): number {
  const v = process.env[key]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function boolEnv(key: string, def: boolean): boolean {
  const v = process.env[key]
  if (v == null) return def
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase())
}

export function loadGraphInsightsConfig(): GraphInsightsConfig {
  return {
    enabled: boolEnv('GRAPH_INSIGHTS_ENABLED', true),
    ttlSec: numEnv('GRAPH_INSIGHTS_TTL_SEC', 1800),
    louvainResolution: numEnv('GRAPH_INSIGHTS_LOUVAIN_RESOLUTION', 1.0),
    maxEdges: numEnv('GRAPH_INSIGHTS_MAX_EDGES', 10_000),
    topSurprises: numEnv('GRAPH_INSIGHTS_TOP_SURPRISES', 10),
    weights: {
      crossCommunity: numEnv('GRAPH_INSIGHTS_WEIGHT_CROSS_COMMUNITY', 3.0),
      crossType: numEnv('GRAPH_INSIGHTS_WEIGHT_CROSS_TYPE', 1.5),
      edgeLog: numEnv('GRAPH_INSIGHTS_WEIGHT_EDGE_LOG', 1.0),
    },
    topicModel: process.env.GRAPH_INSIGHTS_TOPIC_MODEL?.trim() ?? '',
    isolatedMinAgeDays: numEnv('GRAPH_INSIGHTS_ISOLATED_MIN_AGE_DAYS', 7),
    sparseCohesionThreshold: numEnv('GRAPH_INSIGHTS_SPARSE_COHESION_THRESHOLD', 0.15),
    sparseMinSize: numEnv('GRAPH_INSIGHTS_SPARSE_MIN_SIZE', 3),
  }
}
