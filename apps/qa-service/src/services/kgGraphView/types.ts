/**
 * kgGraphView/types.ts —— GraphPayload 是面向渲染的、不是分析的
 *
 * 节点 id 形如 'asset:N' 或 'tag:NAME'，避免类型间碰撞。
 * 与 graphInsights/loader.ts 的 SubgraphAsset 平行：那个面向洞察统计，本类型面向 sigma.js。
 */

export interface GraphNode {
  /** 'asset:N' 或 'tag:NAME' */
  id: string
  /** 显示名（已截 12 字符） */
  label: string
  /** Asset.type（pdf/md/docx/...）；Tag 节点固定 '_tag' */
  type: string
  /** CO_CITED + HAS_TAG 度数之和；用于半径缩放 */
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
  kind: 'CO_CITED' | 'HAS_TAG'
  /** CO_CITED 才有；HAS_TAG 不带 */
  weight?: number
}

export interface GraphPayload {
  space_id: number
  generated_at: string
  /** 老 Space 在 AGE 无 :Space 节点时为 true */
  empty: boolean
  /** empty=true 时给前端的 banner 提示 key */
  hint?: 'space_not_in_graph'
  /** 任意一边超限触发截断 → true */
  truncated: boolean
  stats: {
    node_count: number
    edge_count: number
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface LoaderOptions {
  maxNodes: number
  maxEdges: number
}
