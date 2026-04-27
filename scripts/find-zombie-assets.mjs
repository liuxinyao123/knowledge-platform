#!/usr/bin/env node
/**
 * find-zombie-assets.mjs
 *
 * 列出 metadata_asset 中 chunks=0 的"僵尸"资产 —— 通常来自重 ingest 后老 ID
 * 没有同步清理。这些 ID 在 RAG 召回里永远拿不回来，是 eval-recall 0 命中的
 * 常见根因（参见 ADR-36）。
 *
 * 用法：
 *   node scripts/find-zombie-assets.mjs              # 只列出
 *   node scripts/find-zombie-assets.mjs --delete     # 列出后逐个询问删除（走 ADR-30 的
 *                                                    # DELETE 端点带 audit；不直接 SQL）
 *   node scripts/find-zombie-assets.mjs --json       # 输出 JSON 给后续脚本消费
 *
 * 环境变量（沿用 qa-service 那套）：
 *   PG_HOST     默认 127.0.0.1
 *   PG_PORT     默认 5432
 *   PG_DB       默认 knowledge
 *   PG_USER     默认 knowledge
 *   PG_PASS     默认 knowledge_secret
 *   QA_BASE     默认 http://localhost:3001（仅 --delete 用）
 *   ADMIN_EMAIL / ADMIN_PASSWORD 默认 admin@dsclaw.local / admin123（仅 --delete 用）
 */

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// pnpm workspace 没把 `pg` 提升到仓库根，它只在 `apps/qa-service/node_modules/pg`
// （以及相应的 pnpm store 符号链接）下可见。直接 `import pg from 'pg'` 会 ERR_MODULE_NOT_FOUND。
// 解法：从 `apps/qa-service/package.json` 的位置 createRequire，让 Node 从 qa-service 的
// 上下文里解析 `pg`（会正确找到 pnpm 的符号链接）。
const __dirname = dirname(fileURLToPath(import.meta.url))
const requireFromQaService = createRequire(
  resolve(__dirname, '..', 'apps/qa-service/package.json'),
)
/** @type {typeof import('pg')} */
const pg = requireFromQaService('pg')

const argv = new Set(process.argv.slice(2))
const DO_DELETE = argv.has('--delete')
const AS_JSON = argv.has('--json')

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
}
const dim = (s) => `${C.dim}${s}${C.reset}`
const warn = (s) => `${C.yellow}${s}${C.reset}`
const ok = (s) => `${C.green}${s}${C.reset}`
const fail = (s) => `${C.red}${s}${C.reset}`

const pool = new pg.Pool({
  host: process.env.PG_HOST ?? '127.0.0.1',
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DB ?? 'knowledge',
  user: process.env.PG_USER ?? 'knowledge',
  password: process.env.PG_PASS ?? 'knowledge_secret',
  max: 2,
})

async function main() {
  const { rows: zombies } = await pool.query(`
    SELECT a.id,
           a.name,
           a.created_at,
           a.indexed_at,
           a.offline,
           a.source_id
      FROM metadata_asset a
     WHERE NOT EXISTS (SELECT 1 FROM metadata_field f WHERE f.asset_id = a.id)
     ORDER BY a.created_at DESC
  `)

  if (AS_JSON) {
    console.log(JSON.stringify(zombies, null, 2))
    await pool.end()
    return
  }

  if (zombies.length === 0) {
    console.log(ok('✓ 没有僵尸资产（所有 metadata_asset 行都有 chunks）'))
    await pool.end()
    return
  }

  console.log(warn(`⚠ 找到 ${zombies.length} 条僵尸资产（chunks=0）：`))
  console.log()
  console.log(
    `  ${'id'.padEnd(5)} ${'created_at'.padEnd(20)} ${'offline'.padEnd(8)} name`
  )
  console.log(`  ${''.padEnd(5, '─')} ${''.padEnd(20, '─')} ${''.padEnd(8, '─')} ${''.padEnd(60, '─')}`)
  for (const z of zombies) {
    const created = new Date(z.created_at).toISOString().slice(0, 19).replace('T', ' ')
    const off = z.offline ? 'true' : 'false'
    console.log(
      `  ${String(z.id).padEnd(5)} ${created.padEnd(20)} ${off.padEnd(8)} ${z.name}`
    )
  }
  console.log()
  console.log(dim('提示：'))
  console.log(dim('  - 这些 ID 在 RAG 召回里永远拿不回来；对照 eval/*.jsonl 的 expected_asset_ids 检查'))
  console.log(dim('  - 同名资产如果在更高 ID 下有 chunks，那是 re-ingest 后的真身（参见 ADR-36）'))
  console.log(dim('  - 删除：再跑 `node scripts/find-zombie-assets.mjs --delete`'))

  if (!DO_DELETE) {
    await pool.end()
    return
  }

  // ── --delete 路径：交互确认 + 走 ADR-30 的 HTTP DELETE 端点（带 audit）─────
  const baseUrl = (process.env.QA_BASE || 'http://localhost:3001').replace(/\/+$/, '')
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@dsclaw.local'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  console.log()
  console.log(warn('--delete 模式：将逐个询问，确认后调 ADR-30 的 DELETE 端点（带 audit）'))
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  if (!loginRes.ok) {
    console.error(fail(`登录失败 (${loginRes.status})；检查 ADMIN_EMAIL / ADMIN_PASSWORD`))
    await pool.end()
    process.exit(2)
  }
  const { token } = await loginRes.json()
  if (!token) {
    console.error(fail('登录响应缺少 token 字段；qa-service auth 响应格式可能变了'))
    await pool.end()
    process.exit(2)
  }

  const rl = readline.createInterface({ input, output })
  let deleted = 0
  let kept = 0
  for (const z of zombies) {
    const ans = (await rl.question(`删除 id=${z.id} (${z.name})? [y/N] `)).trim().toLowerCase()
    if (ans !== 'y' && ans !== 'yes') {
      kept++
      continue
    }
    const delRes = await fetch(`${baseUrl}/api/knowledge/documents/${z.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (delRes.ok) {
      console.log(ok(`  ✓ deleted id=${z.id}`))
      deleted++
    } else {
      console.log(fail(`  ✗ failed id=${z.id} (${delRes.status})`))
    }
  }
  rl.close()
  console.log()
  console.log(`  汇总：deleted=${deleted}, kept=${kept}, total=${zombies.length}`)
  await pool.end()
}

main().catch(async (e) => {
  console.error(fail(`脚本失败：${e.message}`))
  await pool.end().catch(() => {})
  process.exit(1)
})
