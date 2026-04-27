#!/usr/bin/env node
/**
 * scripts/backfill-l0.mjs
 *
 * ingest-l0-abstract change · 主动批量回填脚本
 *
 * 顺序扫 metadata_field（chunk_level=3）里没有对应 chunk_abstract 的 chunk，
 * 调 generateAbstractsForChunks 生成 L0/L1。
 *
 * 用法：
 *   node scripts/backfill-l0.mjs                      # 默认 dry-run，不写库
 *   node scripts/backfill-l0.mjs --commit             # 实跑
 *   node scripts/backfill-l0.mjs --commit --limit 100
 *   node scripts/backfill-l0.mjs --commit --resume-from 5000 --rate-per-min 30
 *
 * 选项：
 *   --commit              实跑（不带这个就只 SELECT 出预计行数）
 *   --limit N             最多处理 N 个 chunk（默认无上限）
 *   --resume-from ID      从 chunk_id > ID 开始（覆盖 .backfill-l0.cursor）
 *   --concurrency N       单批并发（默认 4）
 *   --rate-per-min N      硬上限每分钟处理 N 个 chunk（默认 60）
 *   --batch-size N        每批从 DB 拉多少 chunk（默认 50）
 *
 * 断点续跑：
 *   每完成一批 cursor 写到 .backfill-l0.cursor；进程崩了再跑同命令自动续。
 *   --resume-from 显式覆盖。
 *
 * 退出码：
 *   0 全部完成
 *   1 致命错误（DB 不通 / LLM key 没配）
 *   130 SIGINT 中断（cursor 已存）
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CURSOR_FILE = join(REPO_ROOT, '.backfill-l0.cursor')

// ── 参数解析（无外部依赖） ──────────────────────────────────────
function parseArgs(argv) {
  const out = {
    commit: false,
    limit: Infinity,
    resumeFrom: null,
    concurrency: 4,
    ratePerMin: 60,
    batchSize: 50,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--commit': out.commit = true; break
      case '--limit': out.limit = Number(argv[++i]); break
      case '--resume-from': out.resumeFrom = Number(argv[++i]); break
      case '--concurrency': out.concurrency = Number(argv[++i]); break
      case '--rate-per-min': out.ratePerMin = Number(argv[++i]); break
      case '--batch-size': out.batchSize = Number(argv[++i]); break
      case '-h':
      case '--help':
        printHelp(); process.exit(0)
        break
      default:
        console.error(`unknown option: ${a}`)
        printHelp(); process.exit(1)
    }
  }
  if (!Number.isFinite(out.concurrency) || out.concurrency < 1) out.concurrency = 4
  if (!Number.isFinite(out.batchSize) || out.batchSize < 1) out.batchSize = 50
  return out
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-l0.mjs [options]

Options:
  --commit              actually write (default: dry-run)
  --limit N             max chunks to process
  --resume-from ID      start at chunk_id > ID
  --concurrency N       per-batch concurrency (default 4)
  --rate-per-min N      hard rate limit (default 60)
  --batch-size N        DB batch size (default 50)
  -h, --help            this`)
}

// ── 颜色 / 日志 ────────────────────────────────────────────────
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'

const log = {
  info: (m) => console.log(`${CYAN}info${RESET} ${m}`),
  ok: (m) => console.log(`${GREEN}ok${RESET}   ${m}`),
  warn: (m) => console.log(`${YELLOW}warn${RESET} ${m}`),
  err: (m) => console.error(`${RED}err${RESET}  ${m}`),
  prog: (m) => process.stderr.write(`${DIM}${m}${RESET}\r`),
}

// ── 简易速率限制器 ─────────────────────────────────────────────
class RateLimiter {
  constructor(perMin) {
    this.windowMs = 60_000
    this.perWindow = Math.max(1, perMin)
    this.timestamps = []
  }
  async wait() {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
    if (this.timestamps.length < this.perWindow) {
      this.timestamps.push(now)
      return
    }
    const oldest = this.timestamps[0]
    const sleepMs = this.windowMs - (now - oldest) + 50
    await new Promise((r) => setTimeout(r, sleepMs))
    return this.wait()
  }
}

// ── cursor 文件 ────────────────────────────────────────────────
async function readCursor() {
  try {
    const txt = await fs.readFile(CURSOR_FILE, 'utf8')
    const n = Number(txt.trim())
    return Number.isInteger(n) ? n : 0
  } catch {
    return 0
  }
}
async function writeCursor(n) {
  try {
    await fs.writeFile(CURSOR_FILE, String(n))
  } catch (err) {
    log.warn(`cursor write failed: ${err.message}`)
  }
}

// ── 主逻辑 ─────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv)

  // 直接 import qa-service 的 abstract.ts（pnpm workspace 链接到 node_modules，运行时也能 require）
  // 走 file:// 路径以便 ts-node 风格的 .ts 也能被 Node 22 --experimental-strip-types 解析
  const abstractTs = pathToFileURL(
    join(REPO_ROOT, 'apps/qa-service/src/services/ingestPipeline/abstract.ts'),
  ).href
  const pgDbTs = pathToFileURL(
    join(REPO_ROOT, 'apps/qa-service/src/services/pgDb.ts'),
  ).href

  let generateAbstractsForChunks
  let getPgPool
  try {
    ;({ generateAbstractsForChunks } = await import(abstractTs))
    ;({ getPgPool } = await import(pgDbTs))
  } catch (err) {
    log.err(`无法加载 qa-service 模块。请用 'node --experimental-strip-types' 运行：\n` +
            `  node --experimental-strip-types scripts/backfill-l0.mjs ${process.argv.slice(2).join(' ')}\n` +
            `底层错误：${err.message}`)
    process.exit(1)
  }

  // 读 .env：qa-service 进程通常是 dotenv 自动读 apps/qa-service/.env；脚本这里手动读一份
  await loadDotEnv(join(REPO_ROOT, 'apps/qa-service/.env')).catch(() => {})
  await loadDotEnv(join(REPO_ROOT, 'infra/.env')).catch(() => {})

  const pool = getPgPool()
  const rate = new RateLimiter(args.ratePerMin)

  // 起点
  const cursor0 = args.resumeFrom != null && Number.isFinite(args.resumeFrom)
    ? args.resumeFrom
    : await readCursor()
  let cursor = cursor0
  let processed = 0
  let generated = 0
  let failed = 0
  let skipped = 0

  log.info(`mode=${args.commit ? 'COMMIT' : 'DRY-RUN'}  cursor=${cursor0}  limit=${args.limit}  concurrency=${args.concurrency}  rate=${args.ratePerMin}/min`)

  // SIGINT：保 cursor 后再退
  let stopRequested = false
  process.on('SIGINT', () => { stopRequested = true })

  while (!stopRequested && processed < args.limit) {
    const batchSize = Math.min(args.batchSize, args.limit - processed)
    const { rows } = await pool.query(
      `SELECT mf.id
         FROM metadata_field mf
         LEFT JOIN chunk_abstract ca ON ca.chunk_id = mf.id
        WHERE mf.id > $1 AND mf.chunk_level = 3 AND ca.id IS NULL
        ORDER BY mf.id ASC
        LIMIT $2`,
      [cursor, batchSize],
    )
    if (rows.length === 0) break

    const ids = rows.map((r) => Number(r.id))
    if (!args.commit) {
      processed += ids.length
      cursor = ids[ids.length - 1]
      log.prog(`[dry-run] 已扫 ${processed} 个 chunk，最后 id=${cursor}`)
      continue
    }

    // commit 模式：限流后调用
    for (const id of ids) await rate.wait()
    const c = await generateAbstractsForChunks(ids, pool, { concurrency: args.concurrency })
    generated += c.generated
    failed += c.failed
    skipped += c.skipped
    processed += ids.length
    cursor = ids[ids.length - 1]
    await writeCursor(cursor)
    log.prog(`[commit] processed=${processed} generated=${generated} failed=${failed} cursor=${cursor}`)
  }

  process.stderr.write('\n')
  if (stopRequested) {
    log.warn(`SIGINT received, cursor saved at ${cursor}; rerun the same command to resume`)
    process.exit(130)
  }
  log.ok(`done. processed=${processed} generated=${generated} failed=${failed} skipped=${skipped} cursor=${cursor}`)
  await pool.end().catch(() => {})
}

// 极简 dotenv 读取，不引入依赖
async function loadDotEnv(path) {
  const txt = await fs.readFile(path, 'utf8')
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i)
    if (!m) continue
    const k = m[1]
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}

main().catch((err) => {
  log.err(err.stack || err.message)
  process.exit(1)
})
