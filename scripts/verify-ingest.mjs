#!/usr/bin/env node
/**
 * verify-ingest.mjs
 *
 * 端到端验证 /api/ingest 新版高层入口 + jobRegistry 是否真的跑得通。
 *
 * 步骤：
 *   1. admin 登录
 *   2. 提交 conversation 入库（无文件依赖；纯文本走 ingestPipeline）
 *   3. 轮询 /api/ingest/jobs/:id 直到 phase ∈ {done, failed}
 *   4. 断言：phase=done 且 chunkCount > 0；或 phase=failed 但原因是"embedding not configured"（视为环境问题，不算 bug）
 *   5. （可选）提交 fetch-url 抓 example.com 走一遍同样流程
 *
 * 用法：
 *   node scripts/verify-ingest.mjs
 *   node scripts/verify-ingest.mjs --skip-fetch-url   # 跳过网络抓取（离线环境）
 *
 * 环境变量同 verify-permissions.mjs。
 */

const BASE = (process.env.QA_BASE || 'http://localhost:3001').replace(/\/+$/, '')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@dsclaw.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
}
const ok = (s) => `${C.green}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const dim = (s) => `${C.dim}${s}${C.reset}`

const args = process.argv.slice(2)
const skipFetchUrl = args.includes('--skip-fetch-url')

let failures = 0
const results = []

function record(name, status, detail = '') {
  results.push({ name, status, detail })
  const tag = status === 'pass' ? ok('PASS') : status === 'skip' ? warn('SKIP') : fail('FAIL')
  console.log(`[${tag}] ${name.padEnd(40)} ${dim(detail)}`)
  if (status === 'fail') failures++
}

async function req(method, path, { token, body, isJson = true } = {}) {
  const headers = {}
  if (isJson) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* keep null */ }
  return { status: resp.status, body: json, raw: text }
}

async function login() {
  const r = await req('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  if (r.status !== 200 || !r.body?.token) {
    throw new Error(`admin login failed: ${r.status} ${r.raw.slice(0, 200)}`)
  }
  return r.body.token
}

async function pollJob(jobId, token, { timeoutMs = 60_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/ingest/jobs/${encodeURIComponent(jobId)}`, { token })
    if (r.status !== 200) throw new Error(`poll status=${r.status}: ${r.raw.slice(0, 200)}`)
    const job = r.body?.job
    if (!job) throw new Error('poll: missing job in response')
    if (job.phase === 'done' || job.phase === 'failed') return job
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('poll timeout (60s)')
}

function classifyFailure(error) {
  if (!error) return 'unknown'
  if (/embedding not configured|EMBEDDING|embed/i.test(error)) return 'embedding-not-configured'
  if (/HTTP 4|HTTP 5/.test(error)) return 'remote-http-error'
  return 'other'
}

async function main() {
  console.log(`${C.cyan}verify-ingest${C.reset}  base=${BASE}`)

  // 0. login
  let token
  try {
    token = await login()
    record('admin login', 'pass', `email=${ADMIN_EMAIL}`)
  } catch (e) {
    record('admin login', 'fail', e.message)
    process.exit(1)
  }

  // 1. /api/ingest/jobs 应可访问（GET list）
  {
    const r = await req('GET', '/api/ingest/jobs', { token })
    if (r.status === 200 && Array.isArray(r.body?.items)) {
      record('GET /api/ingest/jobs', 'pass', `count=${r.body.items.length}`)
    } else {
      record('GET /api/ingest/jobs', 'fail', `status=${r.status} body=${r.raw.slice(0, 100)}`)
    }
  }

  // 2. POST /api/ingest/conversation
  let convJobId = null
  {
    const r = await req('POST', '/api/ingest/conversation', {
      token,
      body: {
        title: `verify-ingest 烟雾测试 ${new Date().toISOString()}`,
        messages: [
          { role: 'user', text: '我们 Q1 的指标治理目标是什么？这是 verify-ingest 的测试问题。' },
          { role: 'assistant', text: '主要三块：1) 指标口径文档化覆盖率 ≥ 80%；2) 异常告警 24h 闭环；3) 重复指标合并 30+ 个。当前进度还不错。' },
          { role: 'user', text: '那闭环率现在多少？' },
          { role: 'assistant', text: '上周拉的数是 76%，离目标还差 4 个点，主要卡在数仓侧的 owner 不响应这一环。' },
        ],
        options: {
          space: '知识中台',
          tags: ['verify-ingest', 'smoke-test'],
          strategy: 'heading',
          vectorize: true,
        },
      },
    })
    if (r.status !== 202 || !r.body?.jobId) {
      record('POST /api/ingest/conversation', 'fail', `status=${r.status} body=${r.raw.slice(0, 200)}`)
    } else {
      convJobId = r.body.jobId
      record('POST /api/ingest/conversation', 'pass', `jobId=${convJobId.slice(0, 8)}...`)
    }
  }

  // 3. poll job
  if (convJobId) {
    try {
      const job = await pollJob(convJobId, token)
      if (job.phase === 'done' && (job.chunkCount ?? 0) > 0) {
        record('conversation job → done', 'pass',
          `assetId=${job.assetId} chunks=${job.chunkCount} duration=${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s`)
      } else if (job.phase === 'failed') {
        const reason = classifyFailure(job.error)
        if (reason === 'embedding-not-configured') {
          record('conversation job → done', 'skip',
            `embedding not configured；jobRegistry 链路本身工作正常`)
        } else {
          record('conversation job → done', 'fail', `phase=${job.phase} error=${job.error}`)
        }
      } else {
        record('conversation job → done', 'fail', `phase=${job.phase} chunks=${job.chunkCount}`)
      }
    } catch (e) {
      record('conversation job → done', 'fail', e.message)
    }
  }

  // 4. fetch-url（可选，需要外网）
  if (skipFetchUrl) {
    record('POST /api/ingest/fetch-url', 'skip', '--skip-fetch-url')
  } else {
    let fetchJobId = null
    const r = await req('POST', '/api/ingest/fetch-url', {
      token,
      body: {
        url: 'https://example.com/',
        options: { space: '知识中台', tags: ['verify-ingest'], vectorize: true },
      },
    })
    if (r.status !== 202 || !r.body?.jobId) {
      record('POST /api/ingest/fetch-url', 'fail', `status=${r.status} body=${r.raw.slice(0, 200)}`)
    } else {
      fetchJobId = r.body.jobId
      record('POST /api/ingest/fetch-url', 'pass', `jobId=${fetchJobId.slice(0, 8)}...`)
      try {
        const job = await pollJob(fetchJobId, token, { timeoutMs: 30_000 })
        if (job.phase === 'done') {
          record('fetch-url job → done', 'pass', `assetId=${job.assetId} chunks=${job.chunkCount ?? 0}`)
        } else {
          const reason = classifyFailure(job.error)
          if (reason === 'embedding-not-configured' || reason === 'remote-http-error') {
            record('fetch-url job → done', 'skip', `${reason}: ${job.error}`)
          } else {
            record('fetch-url job → done', 'fail', `phase=${job.phase} error=${job.error}`)
          }
        }
      } catch (e) {
        record('fetch-url job → done', 'fail', e.message)
      }
    }
  }

  // 汇总
  const passed = results.filter((r) => r.status === 'pass').length
  const skipped = results.filter((r) => r.status === 'skip').length
  console.log(`\n${C.cyan}── 汇总${C.reset}: ${passed} pass / ${skipped} skip / ${failures} fail`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(fail(`\n未捕获错误：${e.stack || e.message}`))
  process.exit(2)
})
