/**
 * services/knowledgeGraph.ts —— 业务事件 → 图谱写入 高层封装
 *
 * ADR 2026-04-23-27 · Apache AGE sidecar 集成
 *
 * 图谱 schema（最小闭环）：
 *   节点
 *     (:Asset    {id, name, type})
 *     (:Source   {id, name})
 *     (:Space    {id, name})
 *     (:Tag      {name})
 *     (:Question {hash, first_seen})
 *   边
 *     (Source)-[:CONTAINS]->(Asset)
 *     (Space)-[:SCOPES]->(Source)
 *     (Asset)-[:HAS_TAG]->(Tag)
 *     (Question)-[:CITED {score, rank, at}]->(Asset)
 *     (Asset)-[:CO_CITED {weight}]->(Asset)     —— 由 CITED 投影而来，单次问题内对称写入
 *
 * 原则：
 *   - 所有函数 fire-and-forget（await 内部 try/catch，不外抛）
 *   - KG 不可用时静默跳过；主业务路径零感知
 *   - 参数只传 id / 可控字符串；用户可控长文本先 hash
 */
import { createHash } from 'node:crypto'
import { runCypher, isGraphEnabled } from './graphDb.ts'

// ── 基础节点 / 边 upsert ─────────────────────────────────────────────────────

export async function upsertAsset(
  asset: { id: number; name: string; type?: string | null },
): Promise<void> {
  if (!isGraphEnabled()) return
  await runCypher(
    `MERGE (a:Asset {id: $id})
     SET a.name = $name, a.type = $type
     RETURN a`,
    { id: asset.id, name: truncate(asset.name, 256), type: asset.type ?? 'unknown' },
  )
}

export async function upsertSource(
  source: { id: number; name: string },
): Promise<void> {
  if (!isGraphEnabled()) return
  await runCypher(
    `MERGE (s:Source {id: $id})
     SET s.name = $name
     RETURN s`,
    { id: source.id, name: truncate(source.name, 256) },
  )
}

export async function upsertSpace(
  space: { id: number; name: string },
): Promise<void> {
  if (!isGraphEnabled()) return
  await runCypher(
    `MERGE (sp:Space {id: $id})
     SET sp.name = $name
     RETURN sp`,
    { id: space.id, name: truncate(space.name, 256) },
  )
}

export async function linkSourceAsset(sourceId: number, assetId: number): Promise<void> {
  if (!isGraphEnabled()) return
  await runCypher(
    `MERGE (s:Source {id: $sid})
     MERGE (a:Asset  {id: $aid})
     MERGE (s)-[:CONTAINS]->(a)`,
    { sid: sourceId, aid: assetId },
  )
}

export async function linkSpaceSource(spaceId: number, sourceId: number): Promise<void> {
  if (!isGraphEnabled()) return
  await runCypher(
    `MERGE (sp:Space  {id: $spid})
     MERGE (s:Source  {id: $sid})
     MERGE (sp)-[:SCOPES]->(s)`,
    { spid: spaceId, sid: sourceId },
  )
}

export async function setAssetTags(assetId: number, tags: string[]): Promise<void> {
  if (!isGraphEnabled()) return
  if (tags.length === 0) return
  // 幂等：先清旧 HAS_TAG 再重建（同一资产的标签集作为真相）
  await runCypher(
    `MATCH (a:Asset {id: $aid})-[r:HAS_TAG]->(:Tag) DELETE r`,
    { aid: assetId },
  )
  for (const t of tags.slice(0, 50)) {
    const trimmed = truncate(t.trim(), 64)
    if (!trimmed) continue
    await runCypher(
      `MERGE (a:Asset {id: $aid})
       MERGE (t:Tag   {name: $name})
       MERGE (a)-[:HAS_TAG]->(t)`,
      { aid: assetId, name: trimmed },
    )
  }
}

// ── Citation / Co-citation（QA trace 写回） ─────────────────────────────────

export interface CitationRecord {
  asset_id: number
  score: number
  rank: number
}

/**
 * 记录一次 QA 的引用：
 *   - MERGE Question 节点（以 question 文本 sha1 为 key，不存原文）
 *   - 对每条 citation MERGE (q)-[:CITED]->(a)
 *   - 相互 MERGE (a)-[:CO_CITED]->(b)，权重累加（weight += 1）
 *
 * TOP_CITATION_LIMIT = 5：避免低分 citation 污染 CO_CITED 权重
 */
const TOP_CITATION_LIMIT = 5

export async function recordCitations(
  question: string,
  citations: CitationRecord[],
): Promise<void> {
  if (!isGraphEnabled()) return
  if (!question.trim() || citations.length === 0) return

  const hash = sha1(question.trim())
  const top = citations
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, TOP_CITATION_LIMIT)
  const now = Date.now()

  // 1. Question 节点 + CITED 边
  await runCypher(
    `MERGE (q:Question {hash: $hash})
     ON CREATE SET q.first_seen = $now
     SET q.last_seen = $now
     RETURN q`,
    { hash, now },
  )
  for (const c of top) {
    await runCypher(
      `MATCH (q:Question {hash: $hash})
       MERGE (a:Asset    {id: $aid})
       MERGE (q)-[r:CITED]->(a)
       SET r.score = $score, r.rank = $rank, r.at = $now`,
      { hash, aid: c.asset_id, score: c.score ?? 0, rank: c.rank ?? 0, now },
    )
  }

  // 2. CO_CITED：同一次问题内任意两两资产累加 weight
  //    放最后一条 runCypher 里一次性 query 完，O(n²/2) 次 MERGE，n<=5 所以 ≤10 次
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i].asset_id
      const b = top[j].asset_id
      await runCypher(
        `MATCH (a:Asset {id: $aid}), (b:Asset {id: $bid})
         MERGE (a)-[r:CO_CITED]-(b)
         ON CREATE SET r.weight = 1
         ON MATCH  SET r.weight = r.weight + 1`,
        { aid: a, bid: b },
      )
    }
  }
}

// ── 读端（DetailGraph 消费）─────────────────────────────────────────────────

export interface GraphNeighborhood {
  nodes: Array<{ id: string; label: string; kind: 'asset' | 'source' | 'space' | 'tag' | 'question'; count?: number }>
  edges: Array<{ from: string; to: string; kind: string; weight?: number }>
}

/**
 * 查某个 asset 的 N 跳邻域（默认 1 跳）：
 * - 收集 HAS_TAG / CONTAINS / CITED / CO_CITED 的相邻节点
 * - 返回的节点 id 用类型前缀避免碰撞（如 "asset:42" / "tag:治理"）
 *
 * depth > 1 暂不实现，先保持简单；DetailGraph 用 1 跳够了
 */
export async function getAssetNeighborhood(assetId: number): Promise<GraphNeighborhood> {
  if (!isGraphEnabled()) return { nodes: [], edges: [] }

  const nodes = new Map<string, GraphNeighborhood['nodes'][number]>()
  const edges: GraphNeighborhood['edges'] = []
  const selfId = `asset:${assetId}`
  nodes.set(selfId, { id: selfId, label: `#${assetId}`, kind: 'asset' })

  // 1. HAS_TAG
  const tagRows = await runCypher(
    `MATCH (a:Asset {id: $aid})-[:HAS_TAG]->(t:Tag)
     RETURN t.name AS name`,
    { aid: assetId },
    'name agtype',
  )
  for (const r of tagRows) {
    const name = parseAgtypeString(r.name)
    if (!name) continue
    const id = `tag:${name}`
    if (!nodes.has(id)) nodes.set(id, { id, label: name, kind: 'tag' })
    edges.push({ from: selfId, to: id, kind: 'HAS_TAG' })
  }

  // 2. CONTAINS（所属 source）
  const srcRows = await runCypher(
    `MATCH (s:Source)-[:CONTAINS]->(a:Asset {id: $aid})
     RETURN s.id AS id, s.name AS name`,
    { aid: assetId },
    'id agtype, name agtype',
  )
  for (const r of srcRows) {
    const sid = Number(parseAgtypeString(r.id))
    const sname = parseAgtypeString(r.name) ?? String(sid)
    if (!Number.isFinite(sid)) continue
    const id = `source:${sid}`
    if (!nodes.has(id)) nodes.set(id, { id, label: sname, kind: 'source' })
    edges.push({ from: id, to: selfId, kind: 'CONTAINS' })
  }

  // 3. CO_CITED（高权重相关资产）
  const coRows = await runCypher(
    `MATCH (a:Asset {id: $aid})-[r:CO_CITED]-(b:Asset)
     RETURN b.id AS id, b.name AS name, r.weight AS weight
     ORDER BY r.weight DESC LIMIT 10`,
    { aid: assetId },
    'id agtype, name agtype, weight agtype',
  )
  for (const r of coRows) {
    const bid = Number(parseAgtypeString(r.id))
    const bname = parseAgtypeString(r.name) ?? String(bid)
    const w = Number(parseAgtypeString(r.weight)) || 1
    if (!Number.isFinite(bid) || bid === assetId) continue
    const id = `asset:${bid}`
    if (!nodes.has(id)) nodes.set(id, { id, label: bname, kind: 'asset', count: w })
    edges.push({ from: selfId, to: id, kind: 'CO_CITED', weight: w })
  }

  // 4. CITED 次数（Question 节点不展开，只统计）
  const qRows = await runCypher(
    `MATCH (q:Question)-[:CITED]->(a:Asset {id: $aid})
     RETURN count(q) AS c`,
    { aid: assetId },
    'c agtype',
  )
  if (qRows.length) {
    const cnt = Number(parseAgtypeString(qRows[0].c)) || 0
    if (cnt > 0) {
      const self = nodes.get(selfId)!
      self.count = cnt
    }
  }

  return { nodes: Array.from(nodes.values()), edges }
}

// ── 工具 ────────────────────────────────────────────────────────────────────

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 32)
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) : s
}

/**
 * AGE 返回的 agtype 值是字符串，像 `"hello"` 或 `42` 或 `"tag_name"`。
 * 这里做极简解析：拆引号 / 转数字。复杂对象 / 数组暂不处理。
 */
function parseAgtypeString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return null
  let s = v.trim()
  // 去掉 AGE 类型后缀（有的版本会返回 "value"::agtype）
  s = s.replace(/::agtype$/, '').trim()
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s) as string } catch { return s.slice(1, -1) }
  }
  return s
}
