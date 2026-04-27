/**
 * routes/ontology.ts —— Ontology API endpoints
 *
 * POST /api/ontology/context
 *   - 鉴权：requireAuth
 *   - 请求体：{chunks: [{asset_id, score}], maxHop?: 1|2}
 *   - 响应：OntologyContext + X-Ontology-Fallback 响应头
 *   - 503 if KG_ENABLED=0
 *
 * POST /api/ontology/path  (mcp.ontology.path_between · ADR-33)
 *   - 入参：{ fromId, toId, maxDepth? (1..8, default 4) }
 *   - 出参：{ paths: [{ nodes, edges, length }] }
 *   - 实现：BFS in app（AGE path agtype 解析不稳，逐跳 Cypher 更可靠）
 *
 * POST /api/ontology/match (mcp.ontology.match_tag · ADR-33)
 *   - 入参：{ text, topK? (1..50, default 10) }
 *   - 出参：{ tags: [{ id, name, score }] }
 *   - 实现 v1：去重 + 子串/token 重叠打分；语义嵌入留 follow-up
 */

import { Router } from 'express'
import { requireAuth } from '../auth/requireAuth.ts'
import { expandOntologyContext } from '../services/ontologyContext.ts'
import { isGraphEnabled, runCypher } from '../services/graphDb.ts'
import { getPgPool } from '../services/pgDb.ts'

export const ontologyRouter = Router()

ontologyRouter.use(requireAuth())

ontologyRouter.post('/context', async (req, res) => {
  // KG 不可用 → 503
  if (!isGraphEnabled()) {
    return res.status(503).json({ error: 'ontology_unavailable' })
  }

  const { chunks, maxHop } = req.body

  // 验证 chunks
  if (!Array.isArray(chunks)) {
    return res.status(400).json({ error: 'chunks must be an array' })
  }

  const cleanChunks = chunks
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      asset_id: String(c.asset_id || ''),
      score: Number(c.score || 0),
    }))
    .filter((c) => c.asset_id.length > 0 && Number.isFinite(c.score))

  try {
    if (!req.principal) {
      return res.status(401).json({ error: 'not authenticated' })
    }
    const clampedHop = (maxHop ? Math.max(1, Math.min(2, Number(maxHop))) : 2) as 1 | 2
    const context = await expandOntologyContext({
      chunks: cleanChunks,
      principal: req.principal,
      maxHop: clampedHop,
    })

    res.set('X-Ontology-Fallback', context.meta.fallback ? 'true' : 'false')
    return res.json(context)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ontology] POST /context failed:', err)
    return res.status(500).json({ error: 'ontology_error' })
  }
})

// ── helpers for /path 与 /match ─────────────────────────────────────

/** 解析 agtype 字符串（去引号 + 反转义） */
function parseAgString(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  // agtype 字符串形如 "foo"，可能带 ::string 后缀
  const m = s.match(/^"((?:[^"\\]|\\.)*)"(?:::\w+)?$/)
  if (m) return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  // 纯数字 / 标识符
  return s.replace(/::\w+$/, '')
}

/** 给 asset_id 拿一跳邻居（仅 Asset 节点；保留 HAS_TAG/CITED/CO_CITED/CONTAINS 反向也算） */
async function getOneHopAssetNeighbors(
  assetId: string,
): Promise<Array<{ neighbor: string; kind: string }>> {
  // 先取 Asset->Asset 的 CITED / CO_CITED 边（双向）
  const rows = await runCypher(
    `MATCH (a:Asset {id: $aid})-[r:CITED|CO_CITED]-(b:Asset)
     RETURN b.id AS id, type(r) AS kind`,
    { aid: assetId },
    'id agtype, kind agtype',
  )
  const out: Array<{ neighbor: string; kind: string }> = []
  for (const r of rows) {
    const id = parseAgString(r.id)
    const kind = parseAgString(r.kind)
    if (id && id !== assetId) out.push({ neighbor: id, kind })
  }
  return out
}

/**
 * BFS 找 from → to 的所有最短路径，深度上限 maxDepth。
 * 返回路径列表（node id 序列 + 边 kind 序列）；找到第一个深度命中即停（同长度全收）。
 */
async function bfsShortestPaths(
  fromId: string,
  toId: string,
  maxDepth: number,
  maxPaths: number = 5,
): Promise<Array<{ nodes: string[]; edges: Array<{ from: string; to: string; kind: string }> }>> {
  if (fromId === toId) {
    return [{ nodes: [fromId], edges: [] }]
  }

  // 多源 BFS：每层都记下所有"指向当前层节点"的 (parent, edgeKind)，最后回溯组装路径
  type Edge = { from: string; to: string; kind: string }
  const parents = new Map<string, Array<{ from: string; kind: string }>>() // 节点 → 多个 parent
  const visited = new Set<string>([fromId])
  let frontier: string[] = [fromId]

  let foundDepth = -1
  for (let depth = 1; depth <= maxDepth && foundDepth < 0; depth++) {
    const nextFrontier: string[] = []
    const nextSeen = new Set<string>()
    for (const node of frontier) {
      const neighbors = await getOneHopAssetNeighbors(node)
      for (const { neighbor, kind } of neighbors) {
        if (visited.has(neighbor)) continue
        if (!parents.has(neighbor)) parents.set(neighbor, [])
        parents.get(neighbor)!.push({ from: node, kind })
        if (!nextSeen.has(neighbor)) {
          nextSeen.add(neighbor)
          nextFrontier.push(neighbor)
        }
        if (neighbor === toId) foundDepth = depth
      }
    }
    for (const n of nextSeen) visited.add(n)
    frontier = nextFrontier
    if (frontier.length === 0) break
  }

  if (foundDepth < 0) return []

  // 回溯所有最短路径
  const paths: Array<{ nodes: string[]; edges: Edge[] }> = []
  function backtrack(node: string, partialNodes: string[], partialEdges: Edge[]): void {
    if (paths.length >= maxPaths) return
    if (node === fromId) {
      paths.push({
        nodes: [fromId, ...partialNodes.slice().reverse()],
        edges: partialEdges.slice().reverse(),
      })
      return
    }
    const ps = parents.get(node) || []
    for (const p of ps) {
      backtrack(
        p.from,
        [...partialNodes, node],
        [...partialEdges, { from: p.from, to: node, kind: p.kind }],
      )
      if (paths.length >= maxPaths) return
    }
  }
  backtrack(toId, [], [])
  return paths
}

/**
 * 取该 asset 的人类可读名（从 metadata_asset 拉）
 * 失败/不存在返回 null。
 */
async function fetchAssetNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  try {
    const numericIds = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x))
    if (numericIds.length === 0) return map
    const { rows } = await getPgPool().query(
      `SELECT id, name FROM metadata_asset WHERE id = ANY($1::int[])`,
      [numericIds],
    )
    for (const r of rows) map.set(String(r.id), String(r.name ?? ''))
  } catch {
    // 库不可用降级到空名
  }
  return map
}

// ── POST /api/ontology/path ─────────────────────────────────────────

ontologyRouter.post('/path', async (req, res) => {
  if (!isGraphEnabled()) {
    return res.status(503).json({ error: 'ontology_unavailable', paths: [] })
  }

  const body = (req.body ?? {}) as { fromId?: unknown; toId?: unknown; maxDepth?: unknown }
  const fromId = typeof body.fromId === 'string' || typeof body.fromId === 'number'
    ? String(body.fromId).trim()
    : ''
  const toId = typeof body.toId === 'string' || typeof body.toId === 'number'
    ? String(body.toId).trim()
    : ''
  if (!fromId || !toId) {
    return res.status(400).json({ error: 'fromId and toId are required' })
  }

  const rawDepth = Number(body.maxDepth ?? 4)
  const maxDepth = Number.isInteger(rawDepth) ? Math.max(1, Math.min(8, rawDepth)) : 4

  try {
    const rawPaths = await bfsShortestPaths(fromId, toId, maxDepth, 5)
    if (rawPaths.length === 0) {
      return res.json({ paths: [] })
    }

    // 收集所有 node id 拉一次 name
    const allIds = new Set<string>()
    for (const p of rawPaths) p.nodes.forEach((n) => allIds.add(n))
    const names = await fetchAssetNames([...allIds])

    const paths = rawPaths.map((p) => ({
      nodes: p.nodes.map((id) => ({
        id,
        label: 'Asset',
        name: names.get(id) ?? '',
      })),
      edges: p.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
      length: p.edges.length,
    }))
    return res.json({ paths })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ontology] POST /path failed:', err)
    return res.status(500).json({ error: 'path_error', paths: [] })
  }
})

// ── POST /api/ontology/match ─────────────────────────────────────────

/**
 * 子串 + token 重叠打分。
 * - 完全包含查询 → 1.0
 * - tag 是查询的子串 → 0.6 + (tag.length / query.length) * 0.4
 * - 否则按 token 集合 Jaccard
 */
function scoreTagMatch(query: string, tag: string): number {
  const q = query.trim().toLowerCase()
  const t = tag.trim().toLowerCase()
  if (!q || !t) return 0
  if (t === q) return 1
  if (t.includes(q)) return 0.85
  if (q.includes(t)) return 0.6 + (t.length / q.length) * 0.25

  // token Jaccard（非 ASCII 友好：按字符切词 + 空格切）
  const splitter = /[\s,;.，。、；：:|/\\()（）\-_]+/u
  const qTokens = new Set(q.split(splitter).filter(Boolean))
  const tTokens = new Set(t.split(splitter).filter(Boolean))
  if (qTokens.size === 0 || tTokens.size === 0) return 0
  let inter = 0
  for (const x of qTokens) if (tTokens.has(x)) inter++
  const union = qTokens.size + tTokens.size - inter
  return union === 0 ? 0 : inter / union
}

ontologyRouter.post('/match', async (req, res) => {
  const body = (req.body ?? {}) as { text?: unknown; topK?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return res.status(400).json({ error: 'text is required (non-empty string)' })
  }
  const rawTopK = Number(body.topK ?? 10)
  const topK = Number.isFinite(rawTopK) && rawTopK > 0 ? Math.min(50, Math.floor(rawTopK)) : 10

  try {
    // 真相源是 metadata_asset.tags TEXT[]（KG 镜像里也有 Tag 节点，但 PG 数据更全）
    const { rows } = await getPgPool().query(
      `SELECT DISTINCT unnest(tags) AS name FROM metadata_asset WHERE tags IS NOT NULL`,
    )
    const tags = rows
      .map((r) => String(r.name ?? '').trim())
      .filter(Boolean)

    const scored = tags
      .map((name) => ({
        id: `tag:${name}`,
        name,
        score: scoreTagMatch(text, name),
      }))
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return res.json({ tags: scored })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ontology] POST /match failed:', err)
    return res.status(500).json({ error: 'match_error', tags: [] })
  }
})
