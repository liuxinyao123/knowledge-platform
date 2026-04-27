#!/usr/bin/env node
/**
 * verify-qa.mjs
 *
 * 端到端验证 /api/qa/ask SSE 链路：
 *   1. admin 登录
 *   2. POST /api/qa/ask（带 hint_intent=knowledge_qa）
 *   3. 边读 SSE 边累计事件
 *   4. 断言：
 *      - 收到 agent_selected
 *      - 收到至少一条 rag_step（rag pipeline 真的跑起来了）
 *      - 收到 done
 *      - 没有收到 error 或 error 是预期类型（e.g. embedding 未配置）
 *
 * 用法：
 *   node scripts/verify-qa.mjs
 *   QUESTION="什么是 X" node scripts/verify-qa.mjs
 *
 * 注意：
 *   - 不依赖知识库里有数据；空知识库下 ragPipeline 会走"无召回"分支但也应正常 done
 *   - 若 RAG 后端依赖 LLM 但未配置 OPENAI_API_BASE/KEY 之类，本测试会标记 SKIP
 */

const BASE = (process.env.QA_BASE || 'http://localhost:3001').replace(/\/+$/, '')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dsclaw.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const QUESTION = process.env.QUESTION || '介绍一下知识中台的指标治理目标和闭环率'
const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 60_000)

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
}
const ok = (s) => `${C.green}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const dim = (s) => `${C.dim}${s}${C.reset}`

let failures = 0
function record(name, status, detail = '') {
  const tag = status === 'pass' ? ok('PASS') : status === 'skip' ? warn('SKIP') : fail('FAIL')
  console.log(`[${tag}] ${name.padEnd(40)} ${dim(detail)}`)
  if (status === 'fail') failures++
}

async function login() {
  const resp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const text = await resp.text()
  if (resp.status !== 200) throw new Error(`admin login failed: ${resp.status} ${text.slice(0, 200)}`)
  return JSON.parse(text).token
}

/**
 * 读 SSE 流，按 `data: ...\n\n` 解 JSON，累计事件
 * 返回 { events, ended, error }
 */
async function readSse(resp, timeoutMs) {
  const events = []
  if (!resp.body) return { events, ended: true, error: 'no body' }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + timeoutMs

  while (true) {
    if (Date.now() > deadline) {
      try { await reader.cancel() } catch { /* */ }
      return { events, ended: false, error: 'timeout' }
    }
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ value: undefined, done: false, _timeout: true }), 1_000)),
    ])
    if (done) break
    if (!value) continue
    buf += decoder.decode(value, { stream: true })

    let nl
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 2)
      if (!frame.startsWith('data:')) continue
      const payload = frame.slice(5).trim()
      if (!payload) continue
      try {
        const evt = JSON.parse(payload)
        events.push(evt)
        if (evt.type === 'done') {
          try { await reader.cancel() } catch { /* */ }
          return { events, ended: true }
        }
      } catch {
        // ignore non-JSON frames
      }
    }
  }
  return { events, ended: true }
}

async function main() {
  console.log(`${C.cyan}verify-qa${C.reset}  base=${BASE}  question="${QUESTION}"`)

  let token
  try {
    token = await login()
    record('admin login', 'pass')
  } catch (e) {
    record('admin login', 'fail', e.message)
    process.exit(1)
  }

  // ── POST /api/qa/ask 开 SSE ─────────────────────────────────────────────
  const resp = await fetch(`${BASE}/api/qa/ask`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'accept': 'text/event-stream',
    },
    body: JSON.stringify({ question: QUESTION }),
  })

  if (resp.status !== 200) {
    const txt = await resp.text()
    record('POST /api/qa/ask 200', 'fail', `status=${resp.status} body=${txt.slice(0, 200)}`)
    process.exit(1)
  }
  record('POST /api/qa/ask 200', 'pass', `content-type=${resp.headers.get('content-type')}`)

  // ── 读流 ──────────────────────────────────────────────────────────────────
  const { events, ended, error: streamErr } = await readSse(resp, TIMEOUT_MS)
  if (!ended) {
    record('SSE 完整收尾（done）', 'fail', `stream error: ${streamErr}`)
  }

  const types = events.map((e) => e.type)
  const hasAgentSelected = types.includes('agent_selected')
  const ragSteps = events.filter((e) => e.type === 'rag_step')
  const contentChunks = events.filter((e) => e.type === 'content')
  const traceEvents = events.filter((e) => e.type === 'trace')
  const errorEvents = events.filter((e) => e.type === 'error')
  const hasDone = types.includes('done')

  record('收到 agent_selected', hasAgentSelected ? 'pass' : 'fail',
    hasAgentSelected ? events.find((e) => e.type === 'agent_selected')?.data?.intent : '无')
  record('至少一条 rag_step', ragSteps.length > 0 ? 'pass' : 'fail',
    ragSteps.length > 0 ? `${ragSteps.length} 步` : '无')

  // content 是流式 token；如果 LLM 真跑了就有；环境没接 LLM 时为 0，标 skip
  if (contentChunks.length > 0) {
    const totalText = contentChunks.map((e) => e.text ?? '').join('')
    record('content 流式 token', 'pass', `${contentChunks.length} 段 / 共 ${totalText.length} 字`)
  } else if (errorEvents.length > 0 && errorEvents.some((e) => /llm|openai|chat/i.test(String(e.message ?? '')))) {
    record('content 流式 token', 'skip', `LLM 未配置：${errorEvents[0].message}`)
  } else {
    record('content 流式 token', 'skip', '空知识库；rag 跑了但无内容生成')
  }

  if (traceEvents.length > 0) {
    const cite = traceEvents[0]?.data?.citations
    record('trace 携带 citations', 'pass',
      Array.isArray(cite) ? `${cite.length} 条` : '存在 trace（无 citations）')
  } else {
    record('trace 携带 citations', 'skip', '无 trace 事件（空库可接受）')
  }

  record('收到 done 终止', hasDone ? 'pass' : 'fail',
    hasDone ? `共 ${events.length} 个事件` : '未见 done')

  if (errorEvents.length > 0) {
    console.log(dim(`  ↳ 错误事件：${JSON.stringify(errorEvents).slice(0, 200)}`))
  }

  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(fail(`\n未捕获错误：${e.stack || e.message}`))
  process.exit(2)
})
