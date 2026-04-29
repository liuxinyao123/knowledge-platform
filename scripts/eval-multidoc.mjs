#!/usr/bin/env node
/**
 * eval-multidoc.mjs —— D-003 RAG 多文档类型多维度评估 runner
 *
 * 跟 eval-recall.mjs 互补：
 *   - eval-recall.mjs       仅算 recall@K 单一指标（资产级召回）
 *   - eval-multidoc.mjs     7 类断言（intent / pattern / keywords / forbidden /
 *                            recall / 透明度声明 / language_op 不应拒答）
 *
 * 跑法：
 *   node scripts/eval-multidoc.mjs                          # 默认 eval/multidoc-set.jsonl 全集
 *   node scripts/eval-multidoc.mjs --sample 5                # 随机抽 5 条 debug
 *   node scripts/eval-multidoc.mjs --doc-type classical_chinese
 *   node scripts/eval-multidoc.mjs --intent language_op
 *   node scripts/eval-multidoc.mjs --strict                  # must_pass 任一 fail 退 1
 *   node scripts/eval-multidoc.mjs --verbose                 # 每 case 打印详细 SSE 摘要
 *   node scripts/eval-multidoc.mjs eval/some-other.jsonl     # 自定数据集
 *
 * env：
 *   EVAL_API              默认 http://localhost:3001
 *   EVAL_ADMIN_EMAIL      默认 admin@dsclaw.local
 *   EVAL_ADMIN_PASSWORD   默认 admin123
 *   EVAL_TIMEOUT_MS       默认 60000
 *
 * 详细 spec：openspec/changes/rag-multidoc-eval-set/specs/{eval-runner-spec,
 *           intent-classifier-eval-spec, answer-quality-eval-spec}.md
 */

import { readFileSync } from 'node:fs'

// ── 配置 ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getFlag(name) {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? true) : null
}
function hasFlag(name) { return args.includes(name) }

const JSONL_PATH = (() => {
  const positional = args.filter((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
  return positional[0] || 'eval/multidoc-set.jsonl'
})()
const SAMPLE = Number(getFlag('--sample') || 0) || 0
const DOC_TYPE_FILTER = getFlag('--doc-type')
const INTENT_FILTER = getFlag('--intent')
const STRICT = hasFlag('--strict')
const VERBOSE = hasFlag('--verbose')

const BASE = (process.env.EVAL_API || 'http://localhost:3001').replace(/\/+$/, '')
const ADMIN_EMAIL = process.env.EVAL_ADMIN_EMAIL || 'admin@dsclaw.local'
const ADMIN_PASSWORD = process.env.EVAL_ADMIN_PASSWORD || 'admin123'
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 60_000)

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m' }
const ok = (s) => `${C.green}${s}${C.reset}`
const bad = (s) => `${C.red}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const dim = (s) => `${C.dim}${s}${C.reset}`

const ANSWER_INTENTS = ['factual_lookup', 'language_op', 'multi_doc_compare', 'kb_meta', 'out_of_scope']
const PATTERN_TYPES = ['verbatim', 'bilingual', 'list', 'refusal', 'asset_list']
const DOC_TYPES = ['classical_chinese', 'industrial_sop_en', 'cn_product_doc', 'table_xlsx', 'presentation_pptx', 'short_news_md']

// ── 解析 jsonl ───────────────────────────────────────────────────────────────

export function parseJsonl(text) {
  const cases = []
  const errors = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln || ln.startsWith('#') || ln.startsWith('//')) continue
    let obj
    try { obj = JSON.parse(ln) } catch (e) {
      errors.push(`第 ${i + 1} 行 JSON 解析失败: ${e.message}`)
      continue
    }
    if (!obj.id || !obj.doc_type || !obj.question) {
      errors.push(`Case 行 ${i + 1} 缺必填字段（id/doc_type/question）`)
      continue
    }
    if (!DOC_TYPES.includes(obj.doc_type)) {
      errors.push(`Case ${obj.id} doc_type 非法: ${obj.doc_type}`)
      continue
    }
    if (obj.expected_intent != null && !ANSWER_INTENTS.includes(obj.expected_intent)) {
      errors.push(`Case ${obj.id} expected_intent 非法: ${obj.expected_intent}`)
      continue
    }
    if (obj.expected_pattern_type != null && !PATTERN_TYPES.includes(obj.expected_pattern_type)) {
      errors.push(`Case ${obj.id} expected_pattern_type 非法: ${obj.expected_pattern_type}`)
      continue
    }
    cases.push(obj)
  }
  return { cases, errors }
}

// ── HTTP / SSE ───────────────────────────────────────────────────────────────

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

async function dispatchSse(question, history, token) {
  const resp = await fetch(`${BASE}/api/agent/dispatch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'accept': 'text/event-stream',
    },
    body: JSON.stringify({ question, history: history || [], session_id: `eval-d003-${Date.now()}` }),
  })
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`)
  if (!resp.body) throw new Error('no body')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const observed = {
    topIntent: null,
    answerIntent: null,
    rewriteByCondense: false,
    shortCircuited: false,
    citations: [],
    answer: '',
    rawSseLines: [],
  }
  let errorMsg = null
  const deadline = Date.now() + TIMEOUT_MS

  // 关键：pending 必须跨循环复用 —— 不能每次循环都新发 reader.read()。
  // 旧实现 `Promise.race([reader.read(), sleep])` 在 sleep 赢的时候会
  // 把 reader.read() 这条 pending promise "孤儿化"。下次循环再 reader.read()
  // 是一条新 promise；当下一个 chunk 到来时，会先填给旧 pending（FIFO），
  // 然后新 promise 拿到的是再下一个 chunk —— 第一段被吞掉。
  // 表现就是 LLM 流前几字消失（如 "道可道" 变 "道"、"LFTGATE" 变 "ATE"）。
  let pending = null
  const TICK = () => new Promise((res) => setTimeout(() => res({ _t: true }), 1000))

  while (true) {
    if (Date.now() > deadline) {
      try { await reader.cancel() } catch {}
      throw new Error('timeout')
    }
    if (!pending) pending = reader.read()
    const r = await Promise.race([pending, TICK()])
    if (r && r._t) continue                    // 1s 心跳，pending 保留到下轮
    pending = null                              // 真实结果到了，pending 复位
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
      observed.rawSseLines.push(payload)
      try {
        const evt = JSON.parse(payload)
        if (evt.type === 'agent_selected') {
          observed.topIntent = evt.data?.intent ?? null
        } else if (evt.type === 'rag_step') {
          if (evt.icon === '🪄') observed.rewriteByCondense = true
          if (evt.icon === '⛔') observed.shortCircuited = true
          if (evt.icon === '🎭') {
            const m = String(evt.label || '').match(/答案意图分类\s*→\s*(\w+)/)
            if (m) observed.answerIntent = m[1]
          }
        } else if (evt.type === 'trace' && Array.isArray(evt.data?.citations)) {
          observed.citations = evt.data.citations.map((c, i) => ({
            asset_id: Number(c.asset_id), rank: c.index ?? (i + 1),
          }))
        } else if (evt.type === 'content' && typeof evt.text === 'string') {
          observed.answer += evt.text
        } else if (evt.type === 'error') {
          errorMsg = evt.message ?? 'unknown error'
        } else if (evt.type === 'done') {
          try { await reader.cancel() } catch {}
          if (errorMsg) throw new Error(errorMsg)
          return observed
        }
      } catch (e) {
        if (e.message === errorMsg) throw e
      }
    }
  }
  if (errorMsg) throw new Error(errorMsg)
  return observed
}

// ── 7 类断言 ─────────────────────────────────────────────────────────────────

export function assertIntent(c, o) {
  if (c.expected_intent == null) return { pass: true, reason: 'skipped (no expected_intent)' }
  // short-circuit 特例：expected_intent 非 null 但走了 short-circuit → fail
  if (o.shortCircuited) {
    return { pass: false, reason: `expected ${c.expected_intent} but short-circuit fallback` }
  }
  // 顶层路由错（agent_selected != knowledge_qa 且 expected_intent 是档 B 5 类之一）
  if (o.topIntent && o.topIntent !== 'knowledge_qa') {
    return { pass: false, reason: `top-level routed to ${o.topIntent}, not knowledge_qa` }
  }
  // 档 B 没 emit 🎭（fallback factual_lookup）→ 当 factual_lookup 算
  const got = o.answerIntent || 'factual_lookup'
  if (got === c.expected_intent) return { pass: true, reason: `matched: ${got}` }
  return { pass: false, reason: `expected ${c.expected_intent} got ${got}` }
}

export function assertPatternType(c, o) {
  if (c.expected_pattern_type == null) return { pass: true, reason: 'skipped (no expected_pattern_type)' }
  const ans = o.answer || ''
  switch (c.expected_pattern_type) {
    case 'verbatim': {
      const has = /\d+(\.\d+)?\s*(mm|cm|m|°|deg|degrees?|%|kg|g|ms|s)\b/i.test(ans)
      return has ? { pass: true, reason: 'verbatim: matched numeric+unit' } : { pass: false, reason: 'verbatim: no numeric+unit' }
    }
    case 'bilingual': {
      // 放宽阈值：双语共存即可（cn/ascii 各 ≥ 10%），不强求 50/50 对照。
      // 实测：用户问"翻译核心要求"时 LLM 经常以原文（英文）为主 + 少量中文注释，
      // 这种"轻度双语"也是合理 bilingual 答案，不该被检测器一票否决。
      const cnCount = (ans.match(/[\u4e00-\u9fa5]/g) || []).length
      const asciiCount = (ans.match(/[\x21-\x7e]/g) || []).length
      const total = ans.length || 1
      const cnRatio = cnCount / total, asciiRatio = asciiCount / total
      const ok = cnRatio >= 0.1 && asciiRatio >= 0.1
      return ok ? { pass: true, reason: `bilingual: cn ${(cnRatio*100).toFixed(0)}% / ascii ${(asciiRatio*100).toFixed(0)}%` } : { pass: false, reason: `bilingual: cn ${(cnRatio*100).toFixed(0)}% ascii ${(asciiRatio*100).toFixed(0)}% 不达标（要求各 ≥10%）` }
    }
    case 'list': {
      // 三种"分项"形态都算 list：
      //   (1) 老规则：≥3 行 + ≥2 行 bullet/数字开头（标准 markdown 列表）
      //   (2) 顿号枚举：单行/段含 ≥3 个 `、` 分隔的项（"模块：A、B、C、D" 短答案模式）
      //   (3) 粗体冒号段落：≥2 个 `**X**：` 段（LLM 常用结构化分项写法）
      //   (4) 分号枚举：≥3 个 `；` 或 `;` 分隔（古文翻译多见）
      const lines = ans.split(/\r?\n/).filter((l) => l.trim())
      const numbered = lines.filter((l) => /^\s*[·\-\d]+\.?\s+/.test(l) || /^\s*\d+\./.test(l) || l.trim().startsWith('·'))
      const okClassic = lines.length >= 3 && numbered.length >= 2
      const dunCount = (ans.match(/、/g) || []).length
      const okDun = dunCount >= 3
      const boldSeg = (ans.match(/\*\*[^*]{1,30}\*\*\s*[:：]/g) || []).length
      const okBold = boldSeg >= 2
      const semiCount = (ans.match(/[;；]/g) || []).length
      const okSemi = semiCount >= 3
      const ok = okClassic || okDun || okBold || okSemi
      const reason = ok
        ? `list: classic=${okClassic} dun=${okDun}(${dunCount}) bold=${okBold}(${boldSeg}) semi=${okSemi}(${semiCount})`
        : `list: 4 模式都不达标 (bullet=${numbered.length} dun=${dunCount} bold=${boldSeg} semi=${semiCount})`
      return { pass: ok, reason }
    }
    case 'refusal': {
      const markers = ['知识库中没有', '暂时没有', '没有相关', 'not found in the knowledge', 'no relevant content']
      const has = markers.some((m) => ans.includes(m))
      return has ? { pass: true, reason: 'refusal: matched marker' } : { pass: false, reason: 'refusal: no refusal markers' }
    }
    case 'asset_list': {
      const exts = /\.(pdf|xlsx|md|pptx|docx)/i
      const guidance = ans.includes('找到以下') || ans.includes('以下文档') || ans.includes('建议查阅')
      const ok = exts.test(ans) || guidance
      return ok ? { pass: true, reason: 'asset_list: matched ext/guidance' } : { pass: false, reason: 'asset_list: no ext/guidance' }
    }
  }
  return { pass: false, reason: `unknown pattern type ${c.expected_pattern_type}` }
}

/**
 * NFKC normalize：把 ⽼（U+2F77 部首字符）/ ⼦（U+2F26）等异体字归一到常规
 * 老（U+8001）/ 子（U+5B50）。OCR / 部分字体渲染会产生这类字符，导致
 * keywords 直接 includes 失败。NFKC 也处理全/半角数字、罗马数字等。
 */
function nfkc(s) {
  return String(s ?? '').normalize('NFKC')
}

export function assertKeywords(c, o) {
  if (!c.expected_keywords || c.expected_keywords.length === 0) return { pass: true, reason: 'skipped (no keywords)' }
  const ansLow = nfkc(o.answer || '').toLowerCase()
  const missing = c.expected_keywords.filter((k) => !ansLow.includes(nfkc(k).toLowerCase()))
  return missing.length === 0
    ? { pass: true, reason: `all ${c.expected_keywords.length} keywords hit` }
    : { pass: false, reason: `missing: ${JSON.stringify(missing)}` }
}

export function assertMustNotContain(c, o) {
  if (!c.expected_must_not_contain || c.expected_must_not_contain.length === 0) return { pass: true, reason: 'skipped (no forbidden)' }
  const ans = nfkc(o.answer || '')
  const found = c.expected_must_not_contain.filter((w) => ans.includes(nfkc(w)))
  return found.length === 0
    ? { pass: true, reason: `0 forbidden words found` }
    : { pass: false, reason: `forbidden: ${JSON.stringify(found)}` }
}

export function assertRecallTopK(c, o) {
  if (!c.expected_asset_ids || c.expected_asset_ids.length === 0) return { pass: true, reason: 'skipped (no expected_asset_ids)' }
  const k = c.expected_recall_top_k || 3
  const topK = o.citations.slice(0, k).map((c) => c.asset_id)
  const expected = new Set(c.expected_asset_ids.map(Number))
  const hit = topK.some((id) => expected.has(id))
  return hit
    ? { pass: true, reason: `recall@${k}: hit ${topK.find((id) => expected.has(id))}` }
    : { pass: false, reason: `recall@${k}: top ${JSON.stringify(topK)} 不含期望 ${JSON.stringify([...expected])}` }
}

export function assertTransparencyDeclaration(c, o) {
  if (c.expected_intent !== 'language_op') return { pass: true, reason: 'skipped (not language_op)' }
  const tail = (o.answer || '').slice(-300)  // 末尾 300 字符宽松一点
  const markers = ['以上仅就', '未引入外部', 'based on the original', 'document only', '仅就文档']
  const has = markers.some((m) => tail.includes(m))
  return has
    ? { pass: true, reason: 'transparency declaration found' }
    : { pass: false, reason: 'missing transparency declaration in last 300 chars' }
}

export function assertNonRefusalForLangOp(c, o) {
  if (c.expected_intent !== 'language_op') return { pass: true, reason: 'skipped (not language_op)' }
  const refusalMarkers = ['知识库中没有', '暂时没有相关', 'not in the knowledge']
  const found = refusalMarkers.find((m) => (o.answer || '').includes(m))
  return found
    ? { pass: false, reason: `language_op refused (含 "${found}")` }
    : { pass: true, reason: 'no refusal markers' }
}

const ASSERTIONS = [
  ['intent', assertIntent],
  ['pattern_type', assertPatternType],
  ['keywords', assertKeywords],
  ['must_not_contain', assertMustNotContain],
  ['recall', assertRecallTopK],
  ['transparency', assertTransparencyDeclaration],
  ['non_refusal_lop', assertNonRefusalForLangOp],
]

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  // Phase 1: preflight
  console.log(`${C.bold}====== D-003 RAG Multi-doc Eval ======${C.reset}`)
  console.log(`${dim('Date:')} ${new Date().toISOString()}`)
  console.log(`${dim('Dataset:')} ${JSONL_PATH}`)
  console.log(`${dim('API:')} ${BASE}`)
  if (SAMPLE) console.log(`${dim('Sample:')} ${SAMPLE}`)
  if (DOC_TYPE_FILTER) console.log(`${dim('Filter doc_type:')} ${DOC_TYPE_FILTER}`)
  if (INTENT_FILTER) console.log(`${dim('Filter intent:')} ${INTENT_FILTER}`)
  if (STRICT) console.log(`${warn('Strict mode')}`)
  console.log()

  let text
  try { text = readFileSync(JSONL_PATH, 'utf8') }
  catch (e) {
    console.error(bad(`❌ 数据集文件不存在：${JSONL_PATH}`))
    process.exit(1)
  }
  const { cases: allCases, errors: parseErrors } = parseJsonl(text)
  if (parseErrors.length > 0) {
    for (const e of parseErrors) console.error(bad(`❌ ${e}`))
    process.exit(1)
  }
  if (allCases.length === 0) {
    console.error(bad('❌ 数据集为空'))
    process.exit(1)
  }
  console.log(`${dim('Loaded')} ${allCases.length} ${dim('cases')}`)

  // Filter
  let cases = allCases
  if (DOC_TYPE_FILTER) cases = cases.filter((c) => c.doc_type === DOC_TYPE_FILTER)
  if (INTENT_FILTER) cases = cases.filter((c) => c.expected_intent === INTENT_FILTER)
  if (SAMPLE && SAMPLE > 0) {
    cases = cases.sort(() => Math.random() - 0.5).slice(0, SAMPLE)
  }
  console.log(`${dim('Running')} ${cases.length} ${dim('cases after filter')}`)
  console.log()

  // Login
  let token
  try { token = await login() }
  catch (e) {
    console.error(bad(`❌ 登录失败：${e.message}`))
    process.exit(1)
  }

  // Phase 2-3: per case
  const results = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    process.stdout.write(`[${i + 1}/${cases.length}] ${C.cyan}${c.id}${C.reset} ${dim(`(${c.doc_type})`)} ... `)
    let observed, error = null
    try {
      observed = await dispatchSse(c.question, c.history || [], token)
    } catch (e) {
      error = e.message
    }
    const assertResults = {}
    if (error) {
      for (const [name] of ASSERTIONS) assertResults[name] = { pass: false, reason: `error: ${error}` }
      console.log(bad('ERROR'))
      if (VERBOSE) console.log(`    ${dim(error)}`)
    } else {
      let passCount = 0
      for (const [name, fn] of ASSERTIONS) {
        const r = fn(c, observed)
        assertResults[name] = r
        if (r.pass) passCount++
      }
      const totalAss = ASSERTIONS.length
      const status = passCount === totalAss ? ok('PASS') : passCount >= totalAss - 1 ? warn(`${passCount}/${totalAss}`) : bad(`${passCount}/${totalAss}`)
      console.log(`${status} ${dim(`(top=${observed.topIntent || '?'}/answer=${observed.answerIntent || 'fallback'})`)}`)
      if (VERBOSE) {
        for (const [name, r] of Object.entries(assertResults)) {
          if (!r.pass) console.log(`    ${bad('✗')} ${name}: ${r.reason}`)
        }
        console.log(`    ${dim('answer:')} ${(observed.answer || '').slice(0, 120).replace(/\n/g, ' ')}`)
      }
    }
    results.push({ case: c, observed, error, assertResults })
  }

  // Phase 4: aggregate
  console.log()
  console.log(`${C.bold}========== 报告 ==========${C.reset}`)

  // 按维度
  console.log(`\n${C.bold}按维度:${C.reset}`)
  for (const [name] of ASSERTIONS) {
    let p = 0, t = 0
    for (const r of results) {
      const ar = r.assertResults[name]
      if (!ar.reason.startsWith('skipped')) {
        t++; if (ar.pass) p++
      }
    }
    if (t === 0) continue
    const pct = ((p / t) * 100).toFixed(1)
    console.log(`  ${name.padEnd(20)} │ ${String(p).padStart(2)}/${String(t).padStart(2)}  ${pct}%`)
  }

  // 按 doc_type
  console.log(`\n${C.bold}按 doc_type:${C.reset}`)
  const byDocType = new Map()
  for (const r of results) {
    const k = r.case.doc_type
    if (!byDocType.has(k)) byDocType.set(k, { pass: 0, total: 0 })
    const allPass = !r.error && Object.values(r.assertResults).every((ar) => ar.pass)
    byDocType.get(k).total++
    if (allPass) byDocType.get(k).pass++
  }
  for (const [k, v] of [...byDocType.entries()].sort()) {
    const pct = ((v.pass / v.total) * 100).toFixed(1)
    console.log(`  ${k.padEnd(22)} │ ${String(v.pass).padStart(2)}/${String(v.total).padStart(2)}  ${pct}%`)
  }

  // 按 intent
  console.log(`\n${C.bold}按 expected_intent:${C.reset}`)
  const byIntent = new Map()
  for (const r of results) {
    const k = r.case.expected_intent || 'null'
    if (!byIntent.has(k)) byIntent.set(k, { pass: 0, total: 0 })
    const allPass = !r.error && Object.values(r.assertResults).every((ar) => ar.pass)
    byIntent.get(k).total++
    if (allPass) byIntent.get(k).pass++
  }
  for (const [k, v] of [...byIntent.entries()].sort()) {
    const pct = ((v.pass / v.total) * 100).toFixed(1)
    console.log(`  ${k.padEnd(22)} │ ${String(v.pass).padStart(2)}/${String(v.total).padStart(2)}  ${pct}%`)
  }

  // must_pass
  const mustPassResults = results.filter((r) => r.case.must_pass)
  if (mustPassResults.length > 0) {
    console.log(`\n${C.bold}must_pass cases:${C.reset}`)
    let mustFail = 0
    for (const r of mustPassResults) {
      const allPass = !r.error && Object.values(r.assertResults).every((ar) => ar.pass)
      if (allPass) console.log(`  ${ok('PASS')} ${r.case.id}`)
      else { console.log(`  ${bad('FAIL')} ${r.case.id}`); mustFail++ }
    }
    if (mustFail > 0 && STRICT) {
      console.log(`\n${bad('❌ Strict mode: ' + mustFail + ' must_pass case(s) failed')}`)
      process.exit(1)
    }
  }

  // failed cases 详情
  const failed = results.filter((r) => r.error || Object.values(r.assertResults).some((ar) => !ar.pass))
  if (failed.length > 0) {
    console.log(`\n${C.bold}Failed cases (${failed.length}):${C.reset}`)
    for (const r of failed) {
      console.log(`  ${bad('✗')} ${r.case.id} ${dim(r.case.doc_type)}`)
      if (r.error) {
        console.log(`      error: ${r.error}`)
        continue
      }
      for (const [name, ar] of Object.entries(r.assertResults)) {
        if (!ar.pass) console.log(`      ${name}: ${ar.reason}`)
      }
      const ansPrefix = (r.observed?.answer || '').slice(0, 200).replace(/\n/g, ' ')
      if (ansPrefix) console.log(`      ${dim('answer prefix: ' + ansPrefix)}`)
    }
  }

  console.log()
  process.exit(0)
}

// 仅在直接执行时跑（被 import 时不执行，便于单元测试）
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((e) => {
    console.error(bad(`Fatal: ${e.message}`))
    console.error(e.stack)
    process.exit(2)
  })
}
