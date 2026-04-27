/**
 * graphInsights/loader.ts —— 从 AGE 拉 Space 级子图 + 元数据富化
 *
 * 设计 D-002：仅消费 CO_CITED 边；HAS_TAG 单独返回供 bridges 回退路径使用。
 *
 * 输出：
 *   - assets[]       —— 资产元数据（id/name/type/created_at/indexed_at）
 *   - coCitedEdges[] —— 规范化无向边（a<b），权重来自 AGE :CO_CITED.weight
 *   - tagLinks[]     —— {asset_id, tag}（仅 bridges 回退识别时使用）
 *   - signature      —— `a=N,e=M,t=K,m=<ISO>` 供缓存比对
 */
import { runCypher } from '../graphDb.ts'
import { getPgPool } from '../pgDb.ts'

export interface SubgraphAsset {
  id: number
  name: string
  type: string
  created_at: string | null
  indexed_at: string | null
}

export interface SubgraphEdge {
  /** 规范化：始终 a < b */
  a: number
  b: number
  weight: number
}

export interface SubgraphTagLink {
  asset_id: number
  tag: string
}

export interface SpaceSubgraph {
  assets: SubgraphAsset[]
  coCitedEdges: SubgraphEdge[]
  tagLinks: SubgraphTagLink[]
  signature: string
  maxIndexedAt: string | null
}

/**
 * AGE agtype 原始值（字符串包裹 + 类型后缀）解析为裸字符串。
 * 与 knowledgeGraph.ts 的 parseAgtypeString 同源，此处重复避免跨文件耦合。
 */
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

/**
 * 加载一个 Space 下的全部资产 + 内部 CO_CITED 边 + HAS_TAG 链接。
 *
 * 注意：CO_CITED 是跨资产的，一个 Space 内资产可能 co-cited 到另一 Space 的资产。
 * 本函数 WHERE 子句保证**两端均在 Space 内**，避免 ACL 横向越权（R8）。
 */
export async function loadSpaceSubgraph(spaceId: number): Promise<SpaceSubgraph> {
  // 1. Space 内全部 Asset
  const assetRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)
     RETURN DISTINCT a.id AS id, a.name AS name, a.type AS type`,
    { spid: spaceId },
    'id agtype, name agtype, type agtype',
  )

  const baseAssets = new Map<number, { id: number; name: string; type: string }>()
  for (const r of assetRows) {
    const id = toNum(r.id)
    if (id == null) continue
    baseAssets.set(id, {
      id,
      name: parseAgtypeScalar(r.name) ?? String(id),
      type: parseAgtypeScalar(r.type) ?? 'unknown',
    })
  }

  if (baseAssets.size === 0) {
    return {
      assets: [],
      coCitedEdges: [],
      tagLinks: [],
      signature: 'a=0,e=0,t=0,m=',
      maxIndexedAt: null,
    }
  }

  // 2. CO_CITED 边（两端均在 Space 内）
  const edgeRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)-[r:CO_CITED]-(b:Asset)
     WHERE (sp)-[:SCOPES]->(:Source)-[:CONTAINS]->(b)
     RETURN a.id AS aid, b.id AS bid, r.weight AS w`,
    { spid: spaceId },
    'aid agtype, bid agtype, w agtype',
  )
  const seen = new Set<string>()
  const coCitedEdges: SubgraphEdge[] = []
  for (const r of edgeRows) {
    const aid = toNum(r.aid)
    const bid = toNum(r.bid)
    const w = toNum(r.w) ?? 1
    if (aid == null || bid == null || aid === bid) continue
    const a = Math.min(aid, bid)
    const b = Math.max(aid, bid)
    const k = `${a}-${b}`
    if (seen.has(k)) continue
    seen.add(k)
    coCitedEdges.push({ a, b, weight: w })
  }

  // 3. HAS_TAG
  const tagRows = await runCypher(
    `MATCH (sp:Space {id: $spid})-[:SCOPES]->(:Source)-[:CONTAINS]->(a:Asset)-[:HAS_TAG]->(t:Tag)
     RETURN a.id AS aid, t.name AS name`,
    { spid: spaceId },
    'aid agtype, name agtype',
  )
  const tagLinks: SubgraphTagLink[] = []
  for (const r of tagRows) {
    const aid = toNum(r.aid)
    const name = parseAgtypeScalar(r.name)
    if (aid == null || !name) continue
    tagLinks.push({ asset_id: aid, tag: name })
  }

  // 4. 主 PG 富化 created_at / indexed_at
  const pool = getPgPool()
  const ids = Array.from(baseAssets.keys())
  const { rows: metaRows } = await pool.query(
    `SELECT id, created_at, indexed_at FROM metadata_asset WHERE id = ANY($1::int[])`,
    [ids],
  )
  const metaById = new Map<number, { created_at: Date | null; indexed_at: Date | null }>()
  for (const m of metaRows) {
    metaById.set(m.id, { created_at: m.created_at, indexed_at: m.indexed_at })
  }

  const assets: SubgraphAsset[] = []
  let maxIndexedAt: string | null = null
  for (const [id, base] of baseAssets) {
    const m = metaById.get(id)
    const createdAt = m?.created_at ? new Date(m.created_at).toISOString() : null
    const indexedAt = m?.indexed_at ? new Date(m.indexed_at).toISOString() : null
    if (indexedAt && (maxIndexedAt === null || indexedAt > maxIndexedAt)) {
      maxIndexedAt = indexedAt
    }
    assets.push({ ...base, created_at: createdAt, indexed_at: indexedAt })
  }

  const signature = `a=${assets.length},e=${coCitedEdges.length},t=${tagLinks.length},m=${maxIndexedAt ?? ''}`

  return { assets, coCitedEdges, tagLinks, signature, maxIndexedAt }
}
