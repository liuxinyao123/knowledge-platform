#!/usr/bin/env node
/**
 * analyse-qa-multihop.mjs
 *
 * 统计近 N 天问答（`Question` 节点）的跨文档分布，为 OQ-AGENT-1 /
 * agent-react-loop change 提供"多跳需求占比"判据（参见
 * `.superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md`
 * 与 `docs/superpowers/specs/agent-react-loop/explore.md`）。
 *
 * 数据源：Apache AGE sidecar（ADR-27）。`knowledgeGraph.writeCitations()`
 * 在每次问答后 fire-and-forget 写入：
 *   (:Question {hash, first_seen, last_seen})-[:CITED {score, rank, at}]->(:Asset)
 *   (:Asset)-[:CO_CITED {weight}]-(:Asset)
 *
 * 用法：
 *   node scripts/analyse-qa-multihop.mjs              # 默认近 7 天
 *   node scripts/analyse-qa-multihop.mjs --since 30   # 近 30 天
 *   node scripts/analyse-qa-multihop.mjs --json       # 结构化输出
 *   node scripts/analyse-qa-multihop.mjs --top-pairs  # 额外列 top 10 CO_CITED asset 对
 *
 * 判据（OQ-AGENT-1 启动门槛）：
 *   样本量足够  total_questions  >= 50
 *   多跳占比    multihop_ratio   >= 0.20
 *   两者同时满足 → "启动 ReACT change"
 *   任一不满足 → "搁置"
 *
 * 环境变量：
 *   KG_HOST   默认 127.0.0.1
 *   KG_PORT   默认 5433
 *   KG_DB     默认 kg
 *   KG_USER   默认 kg
 *   KG_PASS   默认 kg_secret
 *   KG_GRAPH  默认 knowledge
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// pnpm workspace 不提升 pg 到根，通过 apps/qa-service/package.json 解析
// （同 scripts/find-zombie-assets.mjs）
const __dirname = dirname(fileURLToPath(import.meta.url))
const requireFromQaService = createRequire(
  resolve(__dirname, '..', 'apps/qa-service/package.json'),
)
/** @type {typeof import('pg')} */
const pg = requireFromQaService('pg')

// ── CLI 参数 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const AS_JSON = args.includes('--json')
const TOP_PAIRS = args.includes('--top-pairs')
const sinceIdx = args.indexOf('--since')
const SINCE_DAYS = sinceIdx >= 0 ? Math.max(1, Number(args[sinceIdx + 1] || 7)) : 7

// 判据
const MIN_SAMPLE = Number(process.env.REACT_MIN_SAMPLE ?? 50)
const MIN_MULTIHOP_RATIO = Number(process.env.REACT_MIN_MULTIHOP_RATIO ?? 0.2)

// ── 颜色（沿用 find-zombie-assets.mjs 风格）──────────────────────────────────
const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
}
const dim = (s) => `${C.dim}${s}${C.reset}`
const bold = (s) => `${C.bold}${s}${C.reset}`
const cyan = (s) => `${C.cyan}${s}${C.reset}`
const ok = (s) => `${C.green}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`

// ── AGE 连接 ─────────────────────────────────────────────────────────────────
const GRAPH = process.env.KG_GRAPH || 'knowledge'
const pool = new pg.Pool({
  host:     process.env.KG_HOST ?? '127.0.0.1',
  port:     Number(process.env.KG_PORT ?? 5433),
  database: process.env.KG_DB   ?? 'kg',
  user:     process.env.KG_USER ?? 'kg',
  password: process.env.KG_PASS ?? 'kg_secret',
  max: 2,
  connectionTimeoutMillis: 3000,
})

/** 每条 AGE 连接都要先 LOAD 'age' + 设 search_path（graphDb.ts 一致）
 *  AGE 强制：`SELECT * FROM cypher(...) AS (col agtype, ...)` —— 括号 + 列 spec 必须写全，
 *  按 RETURN 里的字段数量一一声明。否则报 "a column definition list is required ...".
 */
async function runCypher(client, cypher, params = {}, columnSpec = 'v agtype') {
  // 参数以 Cypher 字面量注入（graphDb.cypherLiteral 的简化版；脚本只传 number）
  let interpolated = cypher
  for (const [k, v] of Object.entries(params)) {
    const re = new RegExp(`\\$${k}(?=\\b)`, 'g')
    const lit = typeof v === 'number'
      ? String(v)
      : typeof v === 'string'
        ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
        : JSON.stringify(v)
    interpolated = interpolated.replace(re, lit)
  }
  const wrapped = `SELECT * FROM cypher('${GRAPH}', $$${interpolated}$$) AS (${columnSpec})`
  const { rows } = await client.query(wrapped)
  return rows
}

/** agtype → JS 值：数字直接 parse；带引号的字符串用 JSON.parse；其它原样 */
function agToJs(raw) {
  if (raw == null) return null
  const s = String(raw).replace(/::.*$/, '') // 去掉 "::numeric" / "::vertex" 之类后缀
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s) } catch { return s.slice(1, -1) }
  }
  try { return JSON.parse(s) } catch { return s }
}

async function withAgeClient(fn) {
  const client = await pool.connect()
  try {
    await client.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`)
    return await fn(client)
  } finally {
    client.release()
  }
}

/** agtype -> JS number（AGE 会把数字返回成 "3" / "3.14" / "3::numeric"）*/
function toNumber(raw) {
  if (raw == null) return 0
  const s = String(raw).replace(/::.*$/, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// ── 核心查询 ─────────────────────────────────────────────────────────────────
/**
 * 主统计：按 question 聚合 distinct asset_count，分桶
 * 不带 since 过滤版本的 Cypher（AGE 的时间过滤在 agtype::numeric 对比时较脆，
 * 我们在外层用 CITED 边的 at 属性做 ms 级比较）
 */
async function analyze() {
  const sinceMs = Date.now() - SINCE_DAYS * 86400_000

  const summary = await withAgeClient(async (client) => {
    // 1) 每问 distinct asset 数：返回 hash + asset_count 两列，所以列 spec 也要两个
    const perQuestion = await runCypher(
      client,
      `MATCH (q:Question)-[r:CITED]->(a:Asset)
       WHERE r.at >= $since
       WITH q, count(DISTINCT a) AS asset_count
       RETURN q.hash, asset_count`,
      { since: sinceMs },
      'hash agtype, asset_count agtype',
    )

    let total = 0
    let singleDoc = 0       // asset_count == 1
    let multihop = 0        // asset_count >= 2
    let deepMultihop = 0    // asset_count >= 3
    const distribution = {} // asset_count -> questions

    for (const row of perQuestion) {
      const count = toNumber(agToJs(row.asset_count))
      if (count === 0) continue
      total++
      distribution[count] = (distribution[count] || 0) + 1
      if (count === 1) singleDoc++
      if (count >= 2) multihop++
      if (count >= 3) deepMultihop++
    }

    return { total, singleDoc, multihop, deepMultihop, distribution }
  })

  // 2) Top CO_CITED 对（可选，二次信号）：返回 a_id / b_id / w 三列
  let topPairs = []
  if (TOP_PAIRS) {
    topPairs = await withAgeClient(async (client) => {
      const rows = await runCypher(
        client,
        `MATCH (a:Asset)-[r:CO_CITED]-(b:Asset)
         WHERE id(a) < id(b)
         RETURN a.id, b.id, r.weight
         ORDER BY r.weight DESC
         LIMIT 10`,
        {},
        'a_id agtype, b_id agtype, w agtype',
      )
      return rows.map((r) => ({
        a_id:   toNumber(agToJs(r.a_id)),
        b_id:   toNumber(agToJs(r.b_id)),
        weight: toNumber(agToJs(r.w)),
      }))
    })
  }

  // 3) 诊断（无论 total 是否 > 0 都收集，便于 0 数据时给用户线索）
  const diagnostic = await withAgeClient(async (client) => {
    try {
      const qRows = await runCypher(
        client,
        `MATCH (q:Question) RETURN count(q)`,
        {},
        'n agtype',
      )
      const cRows = await runCypher(
        client,
        `MATCH ()-[r:CITED]->() RETURN count(r), min(r.at), max(r.at)`,
        {},
        'n agtype, min_at agtype, max_at agtype',
      )
      const toIso = (ms) => {
        const v = toNumber(agToJs(ms))
        return v > 0 ? new Date(v).toISOString() : null
      }
      return {
        age_ok: true,
        questions_total:   toNumber(agToJs(qRows[0]?.n)),
        citations_total:   toNumber(agToJs(cRows[0]?.n)),
        earliest_citation: toIso(cRows[0]?.min_at),
        latest_citation:   toIso(cRows[0]?.max_at),
      }
    } catch (err) {
      return { age_ok: false, error: err.message }
    }
  })

  return { summary, topPairs, diagnostic }
}

// ── 渲染 ─────────────────────────────────────────────────────────────────────
function verdict(total, multihopRatio) {
  const sampleOk = total >= MIN_SAMPLE
  const ratioOk = multihopRatio >= MIN_MULTIHOP_RATIO
  if (sampleOk && ratioOk) return { decision: 'START', reason: '样本量与多跳占比均达标' }
  const reasons = []
  if (!sampleOk) reasons.push(`样本量 ${total} < ${MIN_SAMPLE}（建议扩大窗口或等数据）`)
  if (!ratioOk) reasons.push(`多跳占比 ${(multihopRatio * 100).toFixed(1)}% < ${(MIN_MULTIHOP_RATIO * 100).toFixed(0)}%`)
  return { decision: 'DEFER', reason: reasons.join('；') }
}

function renderText(data) {
  const { summary, topPairs } = data
  const { total, singleDoc, multihop, deepMultihop, distribution } = summary

  console.log()
  console.log(bold('== QA 多跳分析 =='))
  console.log(dim(`窗口：近 ${SINCE_DAYS} 天（${new Date(Date.now() - SINCE_DAYS * 86400_000).toISOString().slice(0, 10)} 至今）`))
  console.log(dim(`数据源：Apache AGE · graph=${GRAPH} · kg_db=${process.env.KG_HOST ?? '127.0.0.1'}:${process.env.KG_PORT ?? 5433}`))
  console.log()

  if (total === 0) {
    console.log(warn('⚠ 窗口内无 QA 数据；执行扩展诊断 …'))
    console.log()
    // 打印诊断结果（由 main 流程提前取好）
    const diag = data.diagnostic || {}
    console.log(bold('诊断'))
    console.log(`  AGE 连接         : ${diag.age_ok ? ok('可达') : fail('不可达')}`)
    console.log(`  Question 节点总数: ${diag.questions_total ?? '查询失败'}`)
    console.log(`  CITED 边总数     : ${diag.citations_total ?? '查询失败'}`)
    console.log(`  最早 CITED at    : ${diag.earliest_citation ?? 'N/A'}`)
    console.log(`  最晚 CITED at    : ${diag.latest_citation ?? 'N/A'}`)
    console.log()
    console.log(bold('下一步建议'))
    if ((diag.questions_total ?? 0) === 0) {
      console.log('  → AGE 里还没有任何 QA 记录。可能原因：')
      console.log('    a) 从没跑过真实 QA（项目还在前期；没人从 Web /qa 页问过问题）')
      console.log('    b) KG_ENABLED=0 导致 writeCitations 一直 no-op')
      console.log('    c) eval-recall 只写 pgvector 不写 AGE（可能；待核对）')
      console.log('  → 检查：grep KG_ENABLED infra/.env apps/qa-service/.env')
      console.log('  → 生产数据：在 Web /qa 页发 10+ 问题，再跑本脚本')
    } else if (diag.latest_citation && Date.parse(diag.latest_citation) < Date.now() - 30 * 86400_000) {
      console.log(`  → AGE 有历史数据但都在 ${SINCE_DAYS} 天前。拉大窗口：`)
      console.log('    node scripts/analyse-qa-multihop.mjs --since 365')
    } else {
      console.log('  → 有数据但落在 since 边界之外；稍微拉大窗口或检查时间字段格式')
    }
    console.log()
    return
  }

  const multihopRatio = multihop / total
  const deepRatio = deepMultihop / total

  // 总览表
  console.log(bold('总览'))
  console.log(`  总问答数                 : ${cyan(String(total))}`)
  console.log(`  单文档命中 (asset==1)    : ${singleDoc}  (${((singleDoc / total) * 100).toFixed(1)}%)`)
  console.log(`  多跳 (asset>=2)          : ${cyan(String(multihop))}  (${cyan(((multihopRatio) * 100).toFixed(1) + '%')})`)
  console.log(`  深度多跳 (asset>=3)      : ${deepMultihop}  (${(deepRatio * 100).toFixed(1)}%)`)
  console.log()

  // 分布
  console.log(bold('引用 asset 数分布'))
  const counts = Object.keys(distribution).map(Number).sort((a, b) => a - b)
  for (const c of counts) {
    const n = distribution[c]
    const pct = (n / total) * 100
    const bar = '█'.repeat(Math.round(pct / 2))
    console.log(`  ${String(c).padStart(2)} asset  ${String(n).padStart(4)}  ${bar} ${pct.toFixed(1)}%`)
  }
  console.log()

  // Top pairs
  if (TOP_PAIRS && topPairs.length) {
    console.log(bold('Top 10 CO_CITED asset 对'))
    for (const p of topPairs) {
      console.log(`  #${p.a_id} × #${p.b_id}   weight=${p.weight}`)
    }
    console.log()
  }

  // 判据
  const v = verdict(total, multihopRatio)
  const head = v.decision === 'START' ? ok('✓ 启动 ReACT change') : warn('✗ 搁置 ReACT change')
  console.log(bold('判据'))
  console.log(`  样本量门槛   >= ${MIN_SAMPLE}      实际 ${total}`)
  console.log(`  多跳占比门槛 >= ${(MIN_MULTIHOP_RATIO * 100).toFixed(0)}%   实际 ${(multihopRatio * 100).toFixed(1)}%`)
  console.log(`  结论: ${head}`)
  console.log(`  理由: ${v.reason}`)
  console.log()
}

function renderJson(data) {
  const { summary } = data
  const { total, multihop } = summary
  const multihopRatio = total > 0 ? multihop / total : 0
  const v = verdict(total, multihopRatio)
  console.log(JSON.stringify({
    window_days: SINCE_DAYS,
    generated_at: new Date().toISOString(),
    thresholds: { min_sample: MIN_SAMPLE, min_multihop_ratio: MIN_MULTIHOP_RATIO },
    summary: {
      total_questions: total,
      single_doc: summary.singleDoc,
      multihop_ge2: summary.multihop,
      multihop_ge3: summary.deepMultihop,
      multihop_ratio: multihopRatio,
      distribution: summary.distribution,
    },
    top_co_cited_pairs: data.topPairs ?? [],
    verdict: v,
  }, null, 2))
}

// ── 入口 ─────────────────────────────────────────────────────────────────────
async function main() {
  let data
  try {
    data = await analyze()
  } catch (err) {
    console.error(fail(`分析失败: ${err.message}`))
    if (err.code === 'ECONNREFUSED') {
      console.error(dim('提示：kg_db 容器未启动？检查 pnpm dev:up / docker ps'))
    }
    process.exitCode = 2
    await pool.end().catch(() => {})
    return
  }

  if (AS_JSON) renderJson(data)
  else renderText(data)

  // exit code：STARTED=0；DEFERRED=1；让 CI 能分流
  const total = data.summary.total
  const ratio = total > 0 ? data.summary.multihop / total : 0
  const v = verdict(total, ratio)
  process.exitCode = v.decision === 'START' ? 0 : 1

  await pool.end()
}

main().catch((err) => {
  console.error(fail(`unhandled: ${err.stack || err.message}`))
  process.exitCode = 2
})
