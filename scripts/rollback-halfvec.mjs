#!/usr/bin/env node
/**
 * scripts/rollback-halfvec.mjs
 *
 * asset-vector-coloc change · 紧急回滚脚本
 *
 * 把 metadata_field.embedding 与 chunk_abstract.l0_embedding 从 halfvec(4096)
 * 还原成 vector(4096)，索引同步从 halfvec_cosine_ops 重建到 vector_cosine_ops。
 *
 * 触发条件（满足任一即可考虑回滚）：
 *   - 实测 recall@5 < 1.000
 *   - 业务报告"答案越来越离谱"
 *   - 某些自定义 SQL 工具不支持 halfvec 算子
 *
 * 用法（pnpm workspace 跑根目录脚本，pg 走 qa-service 的 node_modules）：
 *   node --experimental-strip-types scripts/rollback-halfvec.mjs
 *   node --experimental-strip-types scripts/rollback-halfvec.mjs --commit
 *
 * 选项：
 *   --commit              实跑（不带就只 SELECT 当前列类型并打印将会执行的 SQL）
 *
 * 退出码：
 *   0 全部完成 / 已是 vector(4096)
 *   1 致命错误（DB 不通 / qa-service 模块加载失败）
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ── 参数解析 ────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2)
const COMMIT = ARGS.includes('--commit')
const HELP = ARGS.includes('-h') || ARGS.includes('--help')

if (HELP) {
  console.log(`Usage: node --experimental-strip-types scripts/rollback-halfvec.mjs [--commit]

Without --commit (default): dry-run, prints the SQL that would execute.
With --commit:               actually runs the rollback SQL.

Reads PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASS from apps/qa-service/.env or infra/.env
（through qa-service 的 getPgPool；和 qa-service 进程同源）。`)
  process.exit(0)
}

const TARGETS = [
  {
    table: 'metadata_field',
    column: 'embedding',
    indexName: 'idx_field_embedding',
  },
  {
    table: 'chunk_abstract',
    column: 'l0_embedding',
    indexName: 'idx_chunk_abstract_l0_embedding',
  },
]

// ── 极简 .env 加载（与 backfill-l0.mjs 同款，无 dotenv 依赖） ───────────────
async function loadDotEnv(file) {
  let buf
  try { buf = await fs.readFile(file, 'utf8') } catch { return }
  for (const raw of buf.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

async function main() {
  // 先吃 .env，再加载 qa-service 的 pgDb.ts（getPgPool 内部用 process.env.PG_*）
  await loadDotEnv(join(REPO_ROOT, 'apps/qa-service/.env')).catch(() => {})
  await loadDotEnv(join(REPO_ROOT, 'infra/.env')).catch(() => {})

  const pgDbTs = pathToFileURL(
    join(REPO_ROOT, 'apps/qa-service/src/services/pgDb.ts'),
  ).href

  let getPgPool
  try {
    ;({ getPgPool } = await import(pgDbTs))
  } catch (err) {
    console.error(
      `无法加载 qa-service 模块。请用 --experimental-strip-types 运行：\n` +
      `  node --experimental-strip-types scripts/rollback-halfvec.mjs ${ARGS.join(' ')}\n` +
      `底层错误：${err?.message ?? err}`,
    )
    process.exit(1)
  }

  const pool = getPgPool()

  try {
    // 探测列当前类型
    const probe = await pool.query(
      `SELECT c.relname AS table_name,
              a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS type_text
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND ((c.relname = 'metadata_field' AND a.attname = 'embedding')
           OR (c.relname = 'chunk_abstract' AND a.attname = 'l0_embedding'))
         AND a.attnum > 0`,
    )
    const status = new Map()
    for (const r of probe.rows) {
      status.set(`${r.table_name}.${r.column_name}`, String(r.type_text))
    }

    console.log('当前列类型探测：')
    for (const t of TARGETS) {
      const key = `${t.table}.${t.column}`
      console.log(`  ${key} → ${status.get(key) ?? '<未找到>'}`)
    }

    let needWork = false
    for (const t of TARGETS) {
      const cur = status.get(`${t.table}.${t.column}`) ?? ''
      if (cur.startsWith('halfvec')) needWork = true
    }
    if (!needWork) {
      console.log('\n所有目标列已是 vector(4096) 或不存在 → 无需回滚。')
      return 0
    }

    console.log(COMMIT ? '\n→ 实跑模式（--commit）' : '\n→ dry-run（不带 --commit）')

    for (const t of TARGETS) {
      const key = `${t.table}.${t.column}`
      const cur = status.get(key) ?? ''
      if (!cur.startsWith('halfvec')) {
        console.log(`  跳过 ${key}（当前 ${cur || '不存在'}）`)
        continue
      }

      const alterSql = `ALTER TABLE ${t.table}
  ALTER COLUMN ${t.column} TYPE vector(4096)
  USING ${t.column}::vector(4096)`
      const dropIdxSql = `DROP INDEX IF EXISTS ${t.indexName}`
      const createIdxSql = `CREATE INDEX IF NOT EXISTS ${t.indexName}
  ON ${t.table} USING ivfflat (${t.column} vector_cosine_ops)
  WITH (lists = 100)`

      console.log(`\n-- ${key} 回滚 SQL：`)
      console.log(alterSql + ';')
      console.log(dropIdxSql + ';')
      console.log(createIdxSql + ';')

      if (COMMIT) {
        console.log(`  执行中 ${key} ...`)
        await pool.query(alterSql)
        await pool.query(dropIdxSql)
        await pool.query(createIdxSql)
        console.log(`  ✓ ${key} 回滚完成`)
      }
    }

    if (!COMMIT) {
      console.log('\n（dry-run，未执行任何 SQL）加 --commit 实跑。')
    } else {
      console.log(
        '\n✓ 全部回滚完成。\n' +
        '  代码侧 ADR-44 已把 PGVECTOR_HALF_PRECISION 默认翻为 false，\n' +
        '  下次 pnpm dev:restart 时 runPgMigrations() 会跳过 halfvec 段，不会又迁回去。',
      )
    }
    return 0
  } finally {
    await pool.end()
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error('rollback-halfvec failed:', err)
    process.exit(1)
  },
)
