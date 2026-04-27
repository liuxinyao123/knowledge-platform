/**
 * services/graphDb.ts —— Apache AGE 知识图谱连接 + Cypher 执行封装
 *
 * ADR 2026-04-23-27：KG 跑在独立 sidecar PG 实例（compose 里的 `kg_db`），
 * 与主 pg_db（pgvector）隔离，方便单独下架 / 回退。
 *
 * 约束：
 *   - AGE 的 Cypher 必须包在 `SELECT * FROM cypher('graph', $$...$$) AS (col agtype)`
 *   - 每个连接要 `LOAD 'age'; SET search_path = ag_catalog, "$user", public;`
 *   - 未启用或连接失败时，所有 write API fire-and-forget 降级为 no-op，不阻塞主路径
 *
 * 设计：
 *   - runCypher(query, params, columns?) —— 低层入口
 *   - isGraphEnabled() —— 业务层决定是否跳过写入
 *   - bootstrapGraph() —— 启动时一次性建 extension / create_graph（幂等）
 */
import pg from 'pg'

let _pool: pg.Pool | null = null
let _bootstrapped = false
let _disabled = false
let _lastWarnAt = 0

function flagEnabled(): boolean {
  const v = process.env.KG_ENABLED
  if (v == null) return true
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase())
}

export function graphName(): string {
  // ⚠ AGE 的 create_graph 对 1-2 字符的名字有未文档化的下限（报 "graph name is invalid"），
  // 必须 ≥ 3 字符。见 https://www.mail-archive.com/dev@age.apache.org/msg07882.html
  // 这里默认 'knowledge'，若环境变量 KG_GRAPH 被设成 2 字符以内也会 bootstrap 失败。
  return process.env.KG_GRAPH || 'knowledge'
}

export function getGraphPool(): pg.Pool | null {
  if (_disabled || !flagEnabled()) return null
  if (!_pool) {
    _pool = new pg.Pool({
      host:     process.env.KG_HOST     ?? '127.0.0.1',
      port:     Number(process.env.KG_PORT ?? 5433),
      database: process.env.KG_DB       ?? 'kg',
      user:     process.env.KG_USER     ?? 'kg',
      password: process.env.KG_PASS     ?? 'kg_secret',
      max: 3,
      // 短超时避免拖累上游 (QA 流式响应等)
      connectionTimeoutMillis: 1500,
    })
    _pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[graphDb] pool error: ${err.message}`)
    })
  }
  return _pool
}

function warnOnce(msg: string): void {
  const now = Date.now()
  if (now - _lastWarnAt < 60_000) return
  _lastWarnAt = now
  // eslint-disable-next-line no-console
  console.warn(`[graphDb] ${msg}`)
}

/** 是否已经完成 bootstrap，业务写入前快速判定 */
export function isGraphEnabled(): boolean {
  return _bootstrapped && !_disabled
}

/**
 * 启动时调用：CREATE EXTENSION age + create_graph(graph_name) 幂等执行。
 * 失败不抛错，设 _disabled=true，后续调用一律 no-op。
 */
export async function bootstrapGraph(): Promise<void> {
  if (!flagEnabled()) {
    _disabled = true
    // eslint-disable-next-line no-console
    console.log('[graphDb] KG_ENABLED=0；跳过知识图谱 bootstrap')
    return
  }
  const pool = getGraphPool()
  if (!pool) { _disabled = true; return }
  // 关键：必须在同一个 pinned connection 上跑完 CREATE EXTENSION → LOAD → search_path → create_graph
  // 否则 create_graph 在 ag_catalog schema 下找不到（"function create_graph(unknown) does not exist"）
  let client
  try {
    client = await pool.connect()
    await client.query(`CREATE EXTENSION IF NOT EXISTS age`)
    await client.query(`LOAD 'age'`)
    await client.query(`SET search_path = ag_catalog, "$user", public`)
    try {
      await client.query(`SELECT create_graph('${graphName()}')`)
    } catch (err) {
      const msg = (err as Error).message
      // 图已存在是正常情况，其它错抛上去
      if (!/already exists/i.test(msg)) throw err
    }
    _bootstrapped = true
    // eslint-disable-next-line no-console
    console.log(`✓ Apache AGE graph ready: ${graphName()}`)
  } catch (err) {
    _disabled = true
    _bootstrapped = false
    warnOnce(`bootstrap failed: ${(err as Error).message}；后续写入 no-op`)
  } finally {
    client?.release()
  }
}

/**
 * 执行 Cypher。入参：
 *   query      —— Cypher 语句字符串（不含外层 SELECT ... cypher(...)）
 *   params     —— Cypher 参数字典；内部以 JSON 注入（AGE 没有参数绑定，只能字符串插值）
 *   columnSpec —— 返回列 spec，默认 'v agtype'（单列）
 *
 * 注意：参数值会转成 JSON 字面量塞进 Cypher；所以 params 里任何用户可控字符串
 *       必须已经过严格白名单清理（我们业务侧只传 id / hash / enum，都是安全值）。
 *
 * 返回：pg 原生 rows（每个字段是 agtype string，由调用方按需解析）
 */
export async function runCypher(
  query: string,
  params: Record<string, unknown> = {},
  columnSpec: string = 'v agtype',
): Promise<Array<Record<string, unknown>>> {
  if (!isGraphEnabled()) return []
  const pool = getGraphPool()
  if (!pool) return []
  try {
    const client = await pool.connect()
    try {
      await client.query(`LOAD 'age'`)
      await client.query(`SET search_path = ag_catalog, "$user", public`)
      // Cypher 参数注入：把 $x 替换成 JSON 字面量
      let cypher = query
      for (const [k, v] of Object.entries(params)) {
        const literal = cypherLiteral(v)
        cypher = cypher.replace(new RegExp(`\\$${k}\\b`, 'g'), literal)
      }
      const sql = `SELECT * FROM cypher('${graphName()}', $$${cypher}$$) AS (${columnSpec})`
      const { rows } = await client.query(sql)
      return rows
    } finally {
      client.release()
    }
  } catch (err) {
    warnOnce(`runCypher failed: ${(err as Error).message.slice(0, 200)}`)
    return []
  }
}

/** 把 JS 值安全转成 Cypher 字面量（AGE 不支持真正的参数绑定） */
function cypherLiteral(v: unknown): string {
  if (v == null) return 'NULL'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') {
    // 转义反斜杠、单引号、换行
    const escaped = v
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
    return `'${escaped}'`
  }
  if (Array.isArray(v)) {
    return `[${v.map(cypherLiteral).join(',')}]`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${cypherLiteral(val)}`)
    return `{${entries.join(', ')}}`
  }
  return 'NULL'
}

/** 测试辅助：强制禁用（不真的连 DB） */
export function __disableGraphForTest(): void {
  _disabled = true
  _bootstrapped = false
}
