/**
 * kgGraphView/loader.ts —— 拉 Space 子图、转成渲染就绪 GraphPayload
 *
 * 与 graphInsights/loader.ts 并存：那个返 SubgraphAsset[]+ edges 给算法用，本文件返 GraphNode[]
 * + GraphEdge[] 给 sigma 用，并做截断（按 degree / weight）。
 *
 * D-008：先查 :Space 是否存在，无则给 empty payload，**不做 lazy fix 写**。
 * D-004：按 KG_GRAPH_MAX_NODES / KG_GRAPH_MAX_EDGES 截断。
 */
import { runCypher } from '../graphDb.ts'
import type { GraphEdge, GraphNode, GraphPayload, LoaderOptions } from './types.ts'

function parseAgtypeScalar(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/::agtype$/, '').trim()
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  }
  return s
}

function toNum(v: unknown): number | null {
  const s = parseAgtypeScalar(v)
  if (s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function truncateLabel(s: string, max = 12): string {
  if (!s) return ''
  // 简单按字符数截；中英文混排都按字符 1
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export async function loadSpaceGraphForViz(
  spaceId: number,
  opts: LoaderOptions,
): Promise<GraphPayload> {
  const generated_at = new Date().toISOString()

  // 1. 先查 :Space 节点是否存在；不存在直接给 empty
  const spaceCheck = await runCypher(
    `MATCH (sp:Space {id: $spid}) RETURN sp.id AS id LIMIT 1`,
    { spid: spaceId },
    'id agtype',
  )
  if (spaceCheck.length === 0) {
    return {
      space_id: spaceId,
      generated_at,
      empty: true,
      hint: 'space_not_in_graph',
      truncated: false,
      stats: { node_count: 0, edge_count: 0 },
      nodes: [],
      edges: [],
    }
  }

  // 2. 拉 :Asset 节点
  const assetRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)
     RETURN DISTINCT a.id AS id, a.name AS name, a.type AS type`,
    { spid: spaceId },
    'id agtype, name agtype, type agtype',
  )
  const assets = new Map<number, { name: string; type: string }>()
  for (const r of assetRows) {
    const id = toNum(r.id)
    if (id == null) continue
    assets.set(id, {
      name: parseAgtypeScalar(r.name) ?? String(id),
      type: parseAgtypeScalar(r.type) ?? 'unknown',
    })
  }

  // 3. 拉 CO_CITED 边（两端都在 Space 内）
  const edgeRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)-[r:CO_CITED]-(b:Asset)
     WHERE (sp)-[:SCOPES]->(:Source)-[:CONTAINS]->(b)
     RETURN a.id AS aid, b.id AS bid, r.weight AS w`,
    { spid: spaceId },
    'aid agtype, bid agtype, w agtype',
  )
  const seenCoCited = new Set<string>()
  const coCitedEdges: Array<{ a: number; b: number; weight: number }> = []
  for (const r of edgeRows) {
    const aid = toNum(r.aid)
    const bid = toNum(r.bid)
    const w = toNum(r.w) ?? 1
    if (aid == null || bid == null || aid === bid) continue
    const lo = Math.min(aid, bid)
    const hi = Math.max(aid, bid)
    const k = `${lo}-${hi}`
    if (seenCoCited.has(k)) continue
    seenCoCited.add(k)
    coCitedEdges.push({ a: lo, b: hi, weight: w })
  }

  // 4. 拉 HAS_TAG 边 + Tag 节点
  const tagRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)-[:HAS_TAG]->(t:Tag)
     RETURN a.id AS aid, t.name AS name`,
    { spid: spaceId },
    'aid agtype, name agtype',
  )
  const tagLinks: Array<{ asset_id: number; tag: string }> = []
  const tagSet = new Set<string>()
  for (const r of tagRows) {
    const aid = toNum(r.aid)
    const name = parseAgtypeScalar(r.name)
    if (aid == null || !name) continue
    tagLinks.push({ asset_id: aid, tag: name })
    tagSet.add(name)
  }

  // 5. 计算 degree（CO_CITED + HAS_TAG）—— 只对 Asset 节点；Tag 节点 degree 单算
  const assetDegree = new Map<number, number>()
  for (const e of coCitedEdges) {
    assetDegree.set(e.a, (assetDegree.get(e.a) ?? 0) + 1)
    assetDegree.set(e.b, (assetDegree.get(e.b) ?? 0) + 1)
  }
  for (const t of tagLinks) {
    assetDegree.set(t.asset_id, (assetDegree.get(t.asset_id) ?? 0) + 1)
  }
  const tagDegree = new Map<string, number>()
  for (const t of tagLinks) {
    tagDegree.set(t.tag, (tagDegree.get(t.tag) ?? 0) + 1)
  }

  // 6. 截断节点（按 degree 降序，先 Asset 再 Tag）
  const sortedAssets = Array.from(assets.entries()).sort(
    (x, y) => (assetDegree.get(y[0]) ?? 0) - (assetDegree.get(x[0]) ?? 0),
  )
  const sortedTags = Array.from(tagSet).sort(
    (x, y) => (tagDegree.get(y) ?? 0) - (tagDegree.get(x) ?? 0),
  )

  const totalNodeBudget = opts.maxNodes
  // 资产优先，Tag 顶到剩余预算（但不少于 0）
  const assetBudget = Math.min(sortedAssets.length, totalNodeBudget)
  const tagBudget = Math.max(0, totalNodeBudget - assetBudget)
  const keptAssets = new Set(sortedAssets.slice(0, assetBudget).map(([id]) => id))
  const keptTags = new Set(sortedTags.slice(0, Math.min(sortedTags.length, tagBudget)))

  let truncated =
    keptAssets.size < assets.size || keptTags.size < tagSet.size

  // 7. 构造节点
  const nodes: GraphNode[] = []
  for (const id of keptAssets) {
    const meta = assets.get(id)
    if (!meta) continue
    nodes.push({
      id: `asset:${id}`,
      label: truncateLabel(meta.name),
      type: meta.type,
      degree: assetDegree.get(id) ?? 0,
    })
  }
  for (const tag of keptTags) {
    nodes.push({
      id: `tag:${tag}`,
      label: truncateLabel(tag),
      type: '_tag',
      degree: tagDegree.get(tag) ?? 0,
    })
  }

  // 8. 截断边（先过滤两端在保留集，再按 weight 降序截到 maxEdges）
  const filteredCoCited = coCitedEdges.filter(
    (e) => keptAssets.has(e.a) && keptAssets.has(e.b),
  )
  const filteredTagLinks = tagLinks.filter(
    (t) => keptAssets.has(t.asset_id) && keptTags.has(t.tag),
  )

  // 合并到一个数组按 weight 降序（HAS_TAG 视为 weight=0.5，劣后于 CO_CITED）
  type EdgeIntermediate = { source: string; target: string; kind: 'CO_CITED' | 'HAS_TAG'; weight: number; payloadWeight?: number }
  const allEdges: EdgeIntermediate[] = []
  for (const e of filteredCoCited) {
    allEdges.push({
      source: `asset:${e.a}`,
      target: `asset:${e.b}`,
      kind: 'CO_CITED',
      weight: e.weight,
      payloadWeight: e.weight,
    })
  }
  for (const t of filteredTagLinks) {
    allEdges.push({
      source: `asset:${t.asset_id}`,
      target: `tag:${t.tag}`,
      kind: 'HAS_TAG',
      weight: 0.5,
    })
  }
  allEdges.sort((x, y) => y.weight - x.weight)
  const totalRawEdges = allEdges.length
  const keptEdges = allEdges.slice(0, opts.maxEdges)
  if (keptEdges.length < totalRawEdges) truncated = true

  const edges: GraphEdge[] = keptEdges.map((e) =>
    e.kind === 'CO_CITED'
      ? { source: e.source, target: e.target, kind: 'CO_CITED', weight: e.payloadWeight }
      : { source: e.source, target: e.target, kind: 'HAS_TAG' },
  )

  return {
    space_id: spaceId,
    generated_at,
    empty: false,
    truncated,
    stats: { node_count: nodes.length, edge_count: edges.length },
    nodes,
    edges,
  }
}
