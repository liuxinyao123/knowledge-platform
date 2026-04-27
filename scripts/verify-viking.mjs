#!/usr/bin/env node
/**
 * scripts/verify-viking.mjs
 *
 * OpenViking sidecar 端到端烟测。
 * 跑：health → write → ls → find → read 五步，每步 PASS/FAIL。
 *
 * 用法：
 *   VIKING_BASE_URL=http://localhost:1933 node scripts/verify-viking.mjs
 *   VIKING_BASE_URL=http://localhost:1933 VIKING_ROOT_KEY=xxx node scripts/verify-viking.mjs
 *
 * 退出码：
 *   0 全部通过
 *   1 任一步失败
 *
 * 不依赖 qa-service 启动；不引入 npm 依赖（用 fetch）。
 */

const BASE = (process.env.VIKING_BASE_URL || 'http://localhost:1933').replace(/\/+$/, '')
const KEY = process.env.VIKING_ROOT_KEY || ''
const TIMEOUT = 5000

const headers = {
  'Content-Type': 'application/json',
  ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
}

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'

let passed = 0
let failed = 0

function log(color, sym, name, detail = '') {
  console.log(`  ${color}${sym}${RESET} ${name}${detail ? '  ' + YELLOW + detail + RESET : ''}`)
}

function pass(name, detail) { passed++; log(GREEN, '✓', name, detail) }
function fail(name, detail) { failed++; log(RED, '✗', name, detail) }

async function fetchJson(method, path, body) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
    return { status: res.status, json, text }
  } finally {
    clearTimeout(t)
  }
}

const PRINCIPAL = 'verify-' + Math.random().toString(36).slice(2, 8)
const SESSION = 'sess-' + Date.now()
const URI = `viking://user/${PRINCIPAL}/sessions/${SESSION}/${Date.now()}.md`
const PREFIX = `viking://user/${PRINCIPAL}/`
const CONTENT = `# Q\nWhat is OpenViking?\n\n# A\nA context db for AI agents.`

async function step1Health() {
  try {
    const r = await fetchJson('GET', '/healthz')
    if (r.status >= 200 && r.status < 300) {
      pass('health', `HTTP ${r.status} ${r.json?.version ? 'v' + r.json.version : ''}`)
      return true
    }
    fail('health', `HTTP ${r.status}`)
    return false
  } catch (e) {
    fail('health', e.message)
    return false
  }
}

async function step2Write() {
  try {
    const r = await fetchJson('POST', '/v1/write', {
      uri: URI,
      content: CONTENT,
      metadata: { kind: 'verify-script', principalId: PRINCIPAL, sessionId: SESSION },
    })
    if (r.status >= 200 && r.status < 300) {
      pass('write', `uri=${URI}`)
      return true
    }
    fail('write', `HTTP ${r.status} ${r.text?.slice(0, 100) ?? ''}`)
    return false
  } catch (e) {
    fail('write', e.message)
    return false
  }
}

async function step3Ls() {
  try {
    const r = await fetchJson('GET', `/v1/ls?path=${encodeURIComponent(PREFIX)}`)
    if (r.status >= 200 && r.status < 300) {
      const items = Array.isArray(r.json?.items) ? r.json.items : []
      pass('ls', `${items.length} items under ${PREFIX}`)
      return true
    }
    fail('ls', `HTTP ${r.status}`)
    return false
  } catch (e) {
    fail('ls', e.message)
    return false
  }
}

async function step4Find() {
  try {
    const r = await fetchJson('POST', '/v1/find', {
      query: 'OpenViking context db',
      path_prefix: PREFIX,
      top_k: 3,
      layer: 'l1',
    })
    if (r.status >= 200 && r.status < 300) {
      const hits = Array.isArray(r.json?.hits) ? r.json.hits : []
      const found = hits.some((h) => h.uri === URI)
      if (found) {
        pass('find', `${hits.length} hits, target uri matched`)
        return true
      }
      fail('find', `${hits.length} hits but target uri ${URI} NOT in results`)
      return false
    }
    fail('find', `HTTP ${r.status}`)
    return false
  } catch (e) {
    fail('find', e.message)
    return false
  }
}

async function step5Read() {
  try {
    const r = await fetchJson('GET', `/v1/read?uri=${encodeURIComponent(URI)}`)
    if (r.status >= 200 && r.status < 300) {
      const c = typeof r.json?.content === 'string' ? r.json.content : ''
      if (c.includes('OpenViking')) {
        pass('read', `${c.length} chars, content matches`)
        return true
      }
      fail('read', `content empty or unexpected (${c.length} chars)`)
      return false
    }
    fail('read', `HTTP ${r.status}`)
    return false
  } catch (e) {
    fail('read', e.message)
    return false
  }
}

async function main() {
  console.log(`${CYAN}=== OpenViking sidecar smoke test ===${RESET}`)
  console.log(`  base    ${BASE}`)
  console.log(`  api key ${KEY ? '(set)' : '(none)'}`)
  console.log(`  user    ${PRINCIPAL}`)
  console.log(`  session ${SESSION}`)
  console.log()

  const ok1 = await step1Health()
  if (!ok1) {
    console.log(`\n${RED}health failed — abort${RESET}`)
    process.exit(1)
  }
  await step2Write()
  await step3Ls()
  await step4Find()
  await step5Read()

  console.log()
  if (failed === 0) {
    console.log(`${GREEN}=== all ${passed} checks passed ===${RESET}`)
    process.exit(0)
  } else {
    console.log(`${RED}=== ${failed} failed / ${passed} passed ===${RESET}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`${RED}fatal:${RESET}`, e)
  process.exit(1)
})
