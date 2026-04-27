/**
 * kgGraphView/config.ts —— env 读取
 */
import type { LoaderOptions } from './types.ts'

function numEnv(key: string, def: number): number {
  const v = process.env[key]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export function loadKgGraphViewLimits(): LoaderOptions {
  return {
    maxNodes: numEnv('KG_GRAPH_MAX_NODES', 800),
    maxEdges: numEnv('KG_GRAPH_MAX_EDGES', 3000),
  }
}
