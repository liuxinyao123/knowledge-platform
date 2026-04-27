#!/usr/bin/env node
/**
 * verify-permissions.mjs
 *
 * 端到端 RBAC / permission 验证脚本。
 * 覆盖 docs/verification/e2e-permissions-matrix.md 里的所有断言。
 *
 * 用法：
 *   node scripts/verify-permissions.mjs --seed            # 创 editor + viewer 用户（幂等）
 *   node scripts/verify-permissions.mjs                   # 跑全部断言
 *   node scripts/verify-permissions.mjs --only required-perm    # 只跑 /api/auth + /api/acl
 *   node scripts/verify-permissions.mjs --only acl-resource     # 只跑 action+resource 门（要求表已 seed）
 *   node scripts/verify-permissions.mjs --only frontend-hints   # 打印前端手动验证清单
 *
 * 环境变量：
 *   QA_BASE         默认 http://localhost:3001
 *   ADMIN_EMAIL     默认 admin@dsclaw.local
 *   ADMIN_PASSWORD  默认 admin123
 *   EDITOR_EMAIL    默认 editor@dsclaw.local
 *   EDITOR_PASSWORD 默认 editor1234
 *   VIEWER_EMAIL    默认 viewer@dsclaw.local
 *   VIEWER_PASSWORD 默认 viewer1234
 *
 * 退出码：
 *   0 = 全 PASS；非 0 = 至少一条 FAIL
 *
 * Node 版本要求：>= 18（用 global fetch）
 */

// ── 配置 ─────────────────────────────────────────────────────────────────────

const BASE = (process.env.QA_BASE || 'http://localhost:3001').replace(/\/+$/, '')
const USERS = {
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@dsclaw.local',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  editor: {
    email: process.env.EDITOR_EMAIL || 'editor@dsclaw.local',
    password: process.env.EDITOR_PASSWORD || 'editor1234',
  },
  viewer: {
    email: process.env.VIEWER_EMAIL || 'viewer@dsclaw.local',
    password: process.env.VIEWER_PASSWORD || 'viewer1234',
  },
}

const args = process.argv.slice(2)
const flagSeed = args.includes('--seed')
const onlyIdx = args.indexOf('--only')
const onlyFilter = onlyIdx >= 0 ? (args[onlyIdx + 1] || '') : ''

// ── 颜色 ─────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
}
const ok = (s) => `${C.green}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const dim = (s) => `${C.dim}${s}${C.reset}`

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function req(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  const text = await resp.text()
  try { json = text ? JSON.parse(text) : null } catch { /* keep null */ }
  return { status: resp.status, body: json, raw: text }
}

async function login(email, password) {
  const { status, body } = await req('POST', '/api/auth/login', { body: { email, password } })
  if (status !== 200 || !body?.token) {
    throw new Error(`login ${email} failed: ${status} ${JSON.stringify(body)}`)
  }
  return body.token
}

// ── 断言收集器 ───────────────────────────────────────────────────────────────

const results = []
function assertStatus({ method, path, as, expected, actual, detail }) {
  const pass = Array.isArray(expected) ? expected.includes(actual) : actual === expected
  results.push({ method, path, as, expected, actual, pass, detail })
  const tag = pass ? ok('PASS') : fail('FAIL')
  const expStr = Array.isArray(expected) ? expected.join('|') : String(expected)
  const line = `[${tag}] ${method.padEnd(6)} ${path.padEnd(44)} as=${as.padEnd(6)} expected=${expStr} actual=${actual}`
  console.log(detail ? `${line} ${dim(detail)}` : line)
}

// ── seed 子命令：创 editor + viewer ──────────────────────────────────────────

async function runSeed() {
  console.log(`${C.cyan}→ seed: 登录 admin 并尝试创建 editor + viewer${C.reset}`)
  const adminToken = await login(USERS.admin.email, USERS.admin.password)

  for (const role of ['editor', 'viewer']) {
    const u = USERS[role]
    const r = await req('POST', '/api/auth/register', {
      token: adminToken,
      body: { email: u.email, password: u.password, roles: [role] },
    })
    if (r.status === 201) {
      console.log(`  ${ok('created')} ${role} ${u.email} id=${r.body?.id}`)
    } else if (r.status === 409) {
      console.log(`  ${warn('exists ')} ${role} ${u.email}`)
    } else {
      console.log(`  ${fail('error  ')} ${role} ${u.email} status=${r.status} ${JSON.stringify(r.body)}`)
      process.exitCode = 1
    }
  }
}

// ── 断言组：`requiredPermission` 门（不依赖 metadata_acl_rule） ──────────────

async function runRequiredPermGroup(tokens) {
  console.log(`\n${C.cyan}── Group 1: requiredPermission 门（/api/auth/*, /api/acl/*）${C.reset}`)

  // /api/auth/me —— 所有登录用户都 200
  for (const as of ['admin', 'editor', 'viewer']) {
    const r = await req('GET', '/api/auth/me', { token: tokens[as] })
    assertStatus({ method: 'GET', path: '/api/auth/me', as, expected: 200, actual: r.status })
  }
  // 未带 token
  {
    const r = await req('GET', '/api/auth/me')
    assertStatus({ method: 'GET', path: '/api/auth/me', as: 'anon', expected: 401, actual: r.status })
  }

  // /api/auth/register —— admin 200/201/400/409，其它 403
  for (const as of ['editor', 'viewer']) {
    const r = await req('POST', '/api/auth/register', {
      token: tokens[as],
      body: { email: `probe-${as}-${Date.now()}@dsclaw.local`, password: 'probe1234', roles: ['viewer'] },
    })
    assertStatus({ method: 'POST', path: '/api/auth/register', as, expected: 403, actual: r.status })
  }

  // /api/auth/users/:id PATCH / DELETE / reset-password —— editor / viewer 应 403
  // 用 id=999999 触发，403 应该比 404 更先返回
  for (const [method, path] of [
    ['PATCH', '/api/auth/users/999999'],
    ['DELETE', '/api/auth/users/999999'],
    ['POST', '/api/auth/users/999999/reset-password'],
  ]) {
    for (const as of ['editor', 'viewer']) {
      const body = method === 'PATCH' ? { email: 'noop@x.y' }
        : method === 'POST' ? { newPassword: 'something1234' }
        : undefined
      const r = await req(method, path, { token: tokens[as], body })
      assertStatus({ method, path, as, expected: 403, actual: r.status })
    }
  }

  // /api/acl/* —— 选 4 个代表性端点验
  const aclEndpoints = [
    ['GET', '/api/acl/rules'],
    ['GET', '/api/acl/users'],
    ['GET', '/api/acl/role-matrix'],
    ['GET', '/api/acl/permissions'],
  ]
  for (const [method, path] of aclEndpoints) {
    // admin 应 200
    {
      const r = await req(method, path, { token: tokens.admin })
      assertStatus({ method, path, as: 'admin', expected: 200, actual: r.status })
    }
    // editor / viewer 应 403
    for (const as of ['editor', 'viewer']) {
      const r = await req(method, path, { token: tokens[as] })
      assertStatus({ method, path, as, expected: 403, actual: r.status })
    }
    // 未带 token 应 401
    {
      const r = await req(method, path)
      assertStatus({ method, path, as: 'anon', expected: 401, actual: r.status })
    }
  }

  // simulate 是 POST
  {
    const path = '/api/acl/rules/simulate'
    const body = { principal: { user_id: 1, email: 'x', roles: ['viewer'] }, action: 'READ', resource: {} }
    for (const as of ['editor', 'viewer']) {
      const r = await req('POST', path, { token: tokens[as], body })
      assertStatus({ method: 'POST', path, as, expected: 403, actual: r.status })
    }
    // admin 走得通（即便 evaluateAcl 返 deny 也是 200，只要没被 enforceAcl 拦住）
    const r = await req('POST', path, { token: tokens.admin, body })
    assertStatus({ method: 'POST', path, as: 'admin', expected: [200, 400], actual: r.status,
                  detail: '200 = simulate 运行；400 = body 校验不通过' })
  }
}

// ── 断言组：`action+resource` 门（需要 metadata_acl_rule 已 seed） ───────────

async function runAclResourceGroup(tokens) {
  console.log(`\n${C.cyan}── Group 2: action+resource 门（前提：metadata_acl_rule 已 seed）${C.reset}`)
  console.log(dim('  如果 admin 的 READ 端点也 403，说明表里没匹配规则；看 docs/verification/e2e-permissions-matrix.md §4.3'))

  // 抽 3 个代表：governance tags (READ)、quality (READ)、tags merge (WRITE)
  const readEndpoints = [
    ['GET', '/api/governance/tags'],
    ['GET', '/api/governance/quality'],
    ['GET', '/api/governance/duplicates'],
    ['GET', '/api/governance/audit-log'],
  ]
  for (const [method, path] of readEndpoints) {
    for (const as of ['admin', 'editor', 'viewer']) {
      const r = await req(method, path, { token: tokens[as] })
      // READ 期望 200（如果 deny-by-default 规则表空，这里会看到 403）
      assertStatus({ method, path, as, expected: [200], actual: r.status })
    }
  }

  // WRITE 类：在没规则时全部 403；有 editor/admin WRITE 规则时前两个 200，viewer 仍 403
  const writeEndpoints = [
    ['POST', '/api/governance/tags/merge', { srcs: ['__nonexistent__'], dst: '__nonexistent_dst__' }],
    ['POST', '/api/governance/duplicates/dismiss', { a: -1, b: -2 }],
  ]
  for (const [method, path, body] of writeEndpoints) {
    // viewer 应 403
    const rv = await req(method, path, { token: tokens.viewer, body })
    assertStatus({ method, path, as: 'viewer', expected: 403, actual: rv.status })
    // editor / admin：只要走过 ACL 门就算 pass；业务上可能 200/400/404
    for (const as of ['editor', 'admin']) {
      const r = await req(method, path, { token: tokens[as], body })
      assertStatus({ method, path, as, expected: [200, 201, 400, 404], actual: r.status,
                    detail: '通过 ACL 门即可；业务层返值不约束' })
    }
  }
}

// ── 断言组：仅 requireAuth（mcp / graph / ingest recent） ────────────────────

async function runAuthOnlyGroup(tokens) {
  console.log(`\n${C.cyan}── Group 3: 仅 requireAuth（无 enforceAcl 门）${C.reset}`)

  const endpoints = [
    ['GET', '/api/mcp/stats'],
    ['GET', '/api/ingest/recent'],
  ]
  for (const [method, path] of endpoints) {
    for (const as of ['admin', 'editor', 'viewer']) {
      const r = await req(method, path, { token: tokens[as] })
      assertStatus({ method, path, as, expected: 200, actual: r.status })
    }
    const r = await req(method, path)
    assertStatus({ method, path, as: 'anon', expected: 401, actual: r.status })
  }
}

// ── 前端手动验证提示（不跑代码，只打印 checklist） ──────────────────────────

function printFrontendHints() {
  console.log(`\n${C.cyan}── 前端 RequirePermission 手动验证清单${C.reset}`)
  console.log(`
  用 3 个无痕窗口分别登 admin / editor / viewer，逐条过：

  [ ] 1. 侧栏「管理」分组 + 「IAM · 权限」入口
          admin: 可见
          editor/viewer: 不可见

  [ ] 2. 直接敲 URL /iam
          admin: 看到 3 个 Tab（规则 / 用户 / 权限矩阵）
          editor/viewer: 看到锁屏 fallback「🔒 需要 permission:manage 权限」

  [ ] 3. /governance 页切到「数据权限」Tab
          admin: 看到 DataPermTab 列表
          editor/viewer: 看到锁屏 fallback

  [ ] 4. 顶栏 UserArea 的「修改密码」
          三人都应能弹窗并成功改（/api/auth/password 不要 admin 权限）

  [ ] 5. /iam → 用户 Tab
          admin: 看到 alice/bob/carol seed（users 表空时）或真实 users 列表
          editor/viewer: 整页被锁屏，看不到用户列表

  [ ] 6. 浏览器直接 fetch /api/auth/register
          editor/viewer 触发 → 看到 403 响应且界面没报错闪回
`)
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.cyan}verify-permissions${C.reset}  base=${BASE}`)

  if (flagSeed) {
    await runSeed()
    console.log(dim('  seed 完成；如需跑断言，再跑一次：node scripts/verify-permissions.mjs\n'))
    return
  }

  if (onlyFilter === 'frontend-hints') {
    printFrontendHints()
    return
  }

  // 先登录三人拿 token
  console.log(dim('  登录 admin / editor / viewer ...'))
  let tokens
  try {
    tokens = {
      admin: await login(USERS.admin.email, USERS.admin.password),
      editor: await login(USERS.editor.email, USERS.editor.password),
      viewer: await login(USERS.viewer.email, USERS.viewer.password),
    }
  } catch (e) {
    console.error(fail(`登录失败：${e.message}`))
    console.error(warn('  → 先跑一次 `node scripts/verify-permissions.mjs --seed` 创 editor + viewer'))
    console.error(warn('  → 或检查 AUTH_HS256_SECRET 是否配置（未配置时 /api/auth/login 返 500）'))
    process.exit(1)
  }

  const runAll = !onlyFilter || onlyFilter === 'all'
  if (runAll || onlyFilter === 'required-perm')  await runRequiredPermGroup(tokens)
  if (runAll || onlyFilter === 'acl-resource')   await runAclResourceGroup(tokens)
  if (runAll || onlyFilter === 'auth-only')      await runAuthOnlyGroup(tokens)
  if (runAll) printFrontendHints()

  // 汇总
  const total = results.length
  const passed = results.filter((r) => r.pass).length
  const failed = total - passed
  console.log(`\n${C.cyan}── 汇总${C.reset}: ${passed}/${total} passed${failed ? `, ${fail(`${failed} failed`)}` : ''}`)
  if (failed > 0) {
    console.log(fail('\n失败列表：'))
    for (const r of results.filter((x) => !x.pass)) {
      const expStr = Array.isArray(r.expected) ? r.expected.join('|') : r.expected
      console.log(`  ${r.method} ${r.path} as=${r.as} expected=${expStr} actual=${r.actual}`)
    }
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(fail(`\n未捕获错误：${e.stack || e.message}`))
  process.exit(2)
})
