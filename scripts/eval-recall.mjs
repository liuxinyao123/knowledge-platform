#!/usr/bin/env node
/**
 * eval-recall.mjs
 *
 * 资产级召回率评测：对每个问题调 /api/qa/ask 拉 trace.citations[]，
 * 看 golden set 里 expected_asset_ids 是否出现在 top-K 引用里。
 *
 * 用法：
 *   node scripts/eval-recall.mjs                        # 默认 eval/golden-set.jsonl
 *   node scripts/eval-recall.mjs eval/my-set.jsonl
 *   GOLDEN=eval/foo.jsonl node scripts/eval-recall.mjs
 *
 * Golden set 格式（JSONL，一行一条）：
 *   {"id":"Q01","question":"...","expected_asset_ids":[27,28],"comment":"任意备注"}
 *
 * 输出：
 *   - 每条问题的 hit@1 / hit@3 / hit@5 表格 + 召回到的前 5 个 asset_id
 *   - 末尾汇总 平均 recall@1/3/5、平均首命中 rank
 *   - 任一 expected_asset_ids 在 top-5 都没出现 → 退出码非 0
 *
 * 环境变量：
 *   QA_BASE         默认 http://localhost:3001
 *   ADMIN_EMAIL     默认 admin@dsclaw.local
 *   ADMIN_PASSWORD  默认 admin123
 *   QA_TIMEOUT_MS   单题超时（默认 60000）
 */

const BASE = (process.env.QA_BASE || 'http://localhost:3001').replace(/\/+$/, '')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dsclaw.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 60_000)

const GOLDEN_PATH = process.argv[2] || process.env.GOLDEN || 'eval/golden-set.jsonl'

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
}
const ok = (s) => `${C.green}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const dim = (s) => `${C.dim}${s}${C.reset}`

import { readFileSync } from 'node:fs'

// ── load golden set ──────────────────────────────────────────────────────────

let lines
try {
  lines = readFileSync(GOLDEN_PATH, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
} catch (e) {
  console.error(fail(`读 golden set 失败：${e.message}`))
  console.error(`  路径：${GOLDEN_PATH}`)
  console.error(`  参考：eval/golden-set.template.jsonl`)
  process.exit(2)
}

const cases = []
for (const [i, ln] of lines.entries()) {
  try {
    const obj = JSON.parse(ln)
    if (!obj.question || !Array.isArray(obj.expected_asset_ids)) {
      console.error(fail(`第 ${i + 1} 行格式错：缺 question 或 expected_asset_ids[]`))
      process.exit(2)
    }
    cases.push({
      id: obj.id || `Q${String(i + 1).padStart(2, '0')}`,
      question: String(obj.question),
      expected: obj.expected_asset_ids.map(Number).filter(Number.isFinite),
      comment: obj.comment ? String(obj.comment) : '',
    })
  } catch (e) {
    console.error(fail(`第 ${i + 1} 行 JSON 解析失败：${e.message}`))
    process.exit(2)
  }
}

if (cases.length === 0) {
  console.error(fail('golden set 为空'))
  process.exit(2)
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function login() {
  const resp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const text = await resp.text()
  if (resp.status !== 200) throw new Error(`login failed: ${resp.status} ${text.slice(0, 200)}`)
  return JSON.parse(text).token
}

/**
 * 发问题、读 SSE、抽 citations
 * 返回 [{asset_id, asset_name, score, index}, ...] 按 index 升序
 */
async function askAndGetCitations(question, token) {
  const resp = await fetch(`${BASE}/api/qa/ask`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'accept': 'text/event-stream',
    },
    body: JSON.stringify({ question }),
  })
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`)
  if (!resp.body) throw new Error('no body')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let citations = []
  let errorMsg = null
  const deadline = Date.now() + TIMEOUT_MS

  while (true) {
    if (Date.now() > deadline) {
      try { await reader.cancel() } catch { /* */ }
      throw new Error('timeout')
    }
    const r = await Promise.race([
      reader.read(),
      new Promise((res) => setTimeout(() => res({ value: undefined, done: false, _t: true }), 1000)),
    ])
    if (r.done) break
    if (!r.value) continue
    buf += decoder.decode(r.value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 2)
      if (!frame.startsWith('data:')) continue
      const payload = frame.slice(5).trim()
      if (!payload) continue
      try {
        const evt = JSON.parse(payload)
        if (evt.type === 'trace' && Array.isArray(evt.data?.citations)) {
          citations = evt.data.citations
        } else if (evt.type === 'error') {
          errorMsg = evt.message ?? 'unknown error'
        } else if (evt.type === 'done') {
          try { await reader.cancel() } catch { /* */ }
          if (errorMsg) throw new Error(errorMsg)
          return citations
        }
      } catch (e) {
        if (e.message?.startsWith('Unexpected') || e instanceof SyntaxError) continue
        throw e
      }
    }
  }
  if (errorMsg) throw new Error(errorMsg)
  return citations
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

function recallAt(K, expected, retrievedAssetIds) {
  if (expected.length === 0) return 1
  const topK = new Set(retrievedAssetIds.slice(0, K))
  const hits = expected.filter((id) => topK.has(id)).length
  return hits / expected.length
}

/**
 * asset_hit@K —— 严格覆盖度（`eval-multihop-expansion` 2026-04-24 加）：
 *   1  IFF  所有 expected_asset_ids ⊆ top-K(retrieved)
 *   0  otherwise
 * 对 expected.length == 1 的单跳题，asset_hit@K 等于 recall@K == 1；对多跳题（>=2）
 * 比 recall@K 严（要求全部命中而非部分）。
 */
function assetHitAt(K, expected, retrievedAssetIds) {
  if (expected.length === 0) return 1
  const topK = new Set(retrievedAssetIds.slice(0, K))
  return expected.every((id) => topK.has(id)) ? 1 : 0
}

function firstHitRank(expected, retrievedAssetIds) {
  for (let i = 0; i < retrievedAssetIds.length; i++) {
    if (expected.includes(retrievedAssetIds[i])) return i + 1
  }
  return null
}

async function main() {
  console.log(`${C.cyan}eval-recall${C.reset}  base=${BASE}  golden=${GOLDEN_PATH}  cases=${cases.length}`)

  let token
  try {
    token = await login()
  } catch (e) {
    console.error(fail(`登录失败：${e.message}`))
    process.exit(1)
  }

  // 表头
  const padId = 5
  const padR = 8
  console.log(
    '\n' + dim('  ID    R@1     R@3     R@5     首命中  召回前 5 (asset_id)        问题').padEnd(120),
  )
  console.log(dim('  ' + '─'.repeat(118)))

  const results = []
  for (const c of cases) {
    let citations = []
    let errMsg = null
    try {
      citations = await askAndGetCitations(c.question, token)
    } catch (e) {
      errMsg = e.message || 'unknown'
    }
    const retrieved = citations.map((x) => Number(x.asset_id))
    const r1 = recallAt(1, c.expected, retrieved)
    const r3 = recallAt(3, c.expected, retrieved)
    const r5 = recallAt(5, c.expected, retrieved)
    const h1 = assetHitAt(1, c.expected, retrieved)
    const h3 = assetHitAt(3, c.expected, retrieved)
    const h5 = assetHitAt(5, c.expected, retrieved)
    const rank = firstHitRank(c.expected, retrieved)
    const isMulti = c.expected.length >= 2
    results.push({ id: c.id, question: c.question, expected: c.expected, retrieved, r1, r3, r5, h1, h3, h5, rank, isMulti, err: errMsg })

    const colR = (v) => {
      const s = v.toFixed(2)
      return v >= 0.999 ? ok(s) : v >= 0.5 ? warn(s) : fail(s)
    }
    const top5Str = retrieved.slice(0, 5).join(',') || dim('(空)')
    const rankStr = rank == null ? fail('—'.padEnd(6)) : (rank <= 3 ? ok(`#${rank}`) : warn(`#${rank}`))
    const qShort = c.question.length > 40 ? c.question.slice(0, 38) + '…' : c.question
    if (errMsg) {
      console.log(`  ${c.id.padEnd(padId)} ${fail('ERR')} ${dim(errMsg.slice(0, 80))}`)
    } else {
      console.log(
        `  ${c.id.padEnd(padId)} ${colR(r1).padEnd(padR + 9)} ${colR(r3).padEnd(padR + 9)} ${colR(r5).padEnd(padR + 9)} ${rankStr.padEnd(padR)} ${top5Str.padEnd(28)} ${dim(qShort)}`
      )
    }
  }

  // 汇总
  const valid = results.filter((r) => !r.err)
  const avg = (key) => valid.reduce((s, r) => s + r[key], 0) / Math.max(1, valid.length)
  const ranks = valid.map((r) => r.rank).filter((x) => x != null)
  const avgRank = ranks.length ? (ranks.reduce((s, n) => s + n, 0) / ranks.length).toFixed(1) : '—'
  const allMissed = valid.filter((r) => r.r5 === 0).length
  const errored = results.length - valid.length

  console.log(dim('  ' + '─'.repeat(118)))
  console.log('')
  console.log(`${C.bold}汇总${C.reset}  ${valid.length}/${results.length} 有效${errored ? ` · ${fail(`${errored} 错误`)}` : ''}`)
  console.log(`  平均 recall@1: ${avg('r1').toFixed(3)}`)
  console.log(`  平均 recall@3: ${avg('r3').toFixed(3)}`)
  console.log(`  平均 recall@5: ${avg('r5').toFixed(3)}`)
  console.log(`  平均首命中 rank: ${avgRank}（仅算命中过的题）`)
  console.log(`  top-5 没命中: ${allMissed} 题${allMissed > 0 ? '  ' + warn('← 这些题需要排查') : ''}`)

  // 多跳子集汇总（expected_asset_ids.length >= 2）—— eval-multihop-expansion 2026-04-24
  const multi = valid.filter((r) => r.isMulti)
  if (multi.length > 0) {
    const avgMulti = (key) => multi.reduce((s, r) => s + r[key], 0) / multi.length
    console.log('')
    console.log(`${C.bold}多跳子集${C.reset}  ${multi.length}/${valid.length} 题（expected_asset_ids.length >= 2）`)
    console.log(`  平均 recall@5      : ${avgMulti('r5').toFixed(3)}  ${dim('(部分命中给分)')}`)
    console.log(`  平均 asset_hit@1   : ${avgMulti('h1').toFixed(3)}  ${dim('(所有 expected 都在 top-1)')}`)
    console.log(`  平均 asset_hit@3   : ${avgMulti('h3').toFixed(3)}  ${dim('(所有 expected 都在 top-3)')}`)
    console.log(`  平均 asset_hit@5   : ${avgMulti('h5').toFixed(3)}  ${dim('(所有 expected 都在 top-5)')}`)
    const gapPct = ((avgMulti('r5') - avgMulti('h5')) * 100).toFixed(1)
    console.log(`  recall@5 − asset_hit@5 = ${gapPct}%  ${dim('(越大 = 越多部分命中；KG Phase 2 的潜在收益区)')}`)

    // 判据（见 docs/superpowers/specs/eval-multihop-expansion-design.md §判据）
    const h5Val = avgMulti('h5')
    const r5Val = avgMulti('r5')
    let verdict
    if (h5Val >= 0.8) verdict = ok('DEFER_BOTH · 召回覆盖已足够；若 groundedness ≥ 70% 则 OQ-AGENT-1 / OAG Phase 2 可搁置')
    else if (h5Val < 0.7) verdict = warn('START_OAG_PHASE_2 · 多跳文档召回缺失，KG 三路召回有潜在收益')
    else if (r5Val >= 0.7) verdict = warn('MAYBE_START_REACT · 召回够但覆盖严不够；结合 groundedness 看 ReACT 是否值得')
    else verdict = fail('BOTH · 召回 + 综合都弱；先 OAG Phase 2 后 ReACT')
    console.log(`  ${C.bold}判据${C.reset}: ${verdict}`)
  }

  if (allMissed > 0) {
    console.log(`\n${warn('未命中的题：')}`)
    for (const r of valid.filter((x) => x.r5 === 0)) {
      console.log(`  ${r.id}  期望=${r.expected.join(',')} 实际=${r.retrieved.slice(0, 5).join(',') || '(空)'}  ${dim(r.question.slice(0, 60))}`)
    }
    process.exit(1)
  }
  if (errored > 0) process.exit(2)
}

main().catch((e) => {
  console.error(fail(`\n未捕获错误：${e.stack || e.message}`))
  process.exit(2)
})
