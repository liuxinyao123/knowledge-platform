#!/usr/bin/env node
/**
 * scripts/cleanup-bad-chunks-ocr.mjs
 *
 * rag-relevance-hygiene · D 姐妹脚本
 * 抓 OCR 碎片类 chunk（PG regex 搞不定的模式）：
 *   - 含 emoji
 *   - 含裸引号（"/'/`/"/"/'/）
 *   - 全 ASCII 且 token 平均长度 < 2（"g g g"）
 *   - 全 ASCII 且 单字符 token ≥ 3 个（"G G G D"）
 *
 * 复用 apps/qa-service/src/services/textHygiene.ts::isBadChunk
 * 保证和 ingest gate + bash 脚本判定逻辑一致。
 *
 * 用法：
 *   node scripts/cleanup-bad-chunks-ocr.mjs               # dry-run，只打印命中列表
 *   node scripts/cleanup-bad-chunks-ocr.mjs --confirm     # 真实 DELETE
 *
 * 环境变量（默认值适配仓库 docker-compose）：
 *   PG_HOST       默认 127.0.0.1
 *   PG_PORT       默认 5432
 *   PG_USER       默认 knowledge
 *   PG_PASSWORD   默认空；优先读 PGPASSWORD
 *   PG_DB         默认 knowledge
 *
 * 退出码：0 = OK；1 = 脚本异常
 *
 * Node ≥ 20（脚本运行时）。依赖：`pg`（qa-service 已装）。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  isBadChunk, looksLikeOcrFragment,
} from '../apps/qa-service/src/services/textHygiene.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
void __dirname   // 未使用但保留供后续扩展

const CONFIRM = process.argv.includes('--confirm')

// ── PG 连接 ────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  host:     process.env.PG_HOST     ?? '127.0.0.1',
  port:     Number(process.env.PG_PORT ?? 5432),
  user:     process.env.PG_USER     ?? 'knowledge',
  password: process.env.PGPASSWORD ?? process.env.PG_PASSWORD ?? '',
  database: process.env.PG_DB       ?? 'knowledge',
})

function color(s, c) { return `\x1b[${c}m${s}\x1b[0m` }
const C = { cyan: (s) => color(s, 36), green: (s) => color(s, 32), yellow: (s) => color(s, 33), red: (s) => color(s, 31) }

async function main() {
  console.log(C.cyan('================================================================'))
  console.log(C.cyan(' Cleanup bad chunks — OCR 碎片专属（复用 textHygiene.isBadChunk）'))
  console.log(C.cyan('================================================================'))
  console.log(` MODE: ${CONFIRM ? 'delete' : 'dry-run'}`)
  console.log()

  // 1) 扫所有 L3 chunk
  const { rows } = await pool.query(
    'SELECT id, asset_id, content FROM metadata_field WHERE chunk_level = 3',
  )
  console.log(C.cyan(`▸ scanning ${rows.length} L3 chunks ...`))

  const hits = []  // { id, asset_id, reason, preview }
  for (const r of rows) {
    const v = isBadChunk(r.content)
    // bash 脚本已处理 too_short + error_json_blob；这里只管 OCR 碎片
    if (v.bad && v.reason === 'ocr_fragment') {
      hits.push({
        id: Number(r.id),
        asset_id: Number(r.asset_id),
        reason: v.reason,
        preview: String(r.content).slice(0, 60),
      })
    }
  }

  if (hits.length === 0) {
    console.log(C.green('✓ 没发现 OCR 碎片 chunk'))
    await pool.end()
    return
  }

  // 2) 统计 + 前 10 条预览
  const byAsset = new Map()
  for (const h of hits) byAsset.set(h.asset_id, (byAsset.get(h.asset_id) ?? 0) + 1)
  console.log(C.yellow(`⚠ 命中 ${hits.length} 条（涉及 ${byAsset.size} 个 asset）`))
  console.log(C.cyan('前 10 条预览：'))
  for (const h of hits.slice(0, 10)) {
    console.log(`  id=${h.id} asset=${h.asset_id}  ${JSON.stringify(h.preview)}`)
  }

  if (!CONFIRM) {
    console.log()
    console.log(C.yellow('(dry-run 模式；追加 --confirm 实际 DELETE)'))
    await pool.end()
    return
  }

  // 3) 真实 DELETE（分批，避免一次性太大）
  const BATCH = 500
  let deleted = 0
  for (let i = 0; i < hits.length; i += BATCH) {
    const slice = hits.slice(i, i + BATCH).map((h) => h.id)
    const r = await pool.query('DELETE FROM metadata_field WHERE id = ANY($1::int[])', [slice])
    deleted += r.rowCount ?? 0
  }
  console.log()
  console.log(C.green(`✓ deleted ${deleted} rows`))
  console.log(C.yellow('提示：被删 chunk 的 embedding 同步消失。受影响 asset 需手动重跑 ingest。'))

  await pool.end()
}

main().catch(async (e) => {
  console.error(C.red(`✗ error: ${e?.message ?? e}`))
  try { await pool.end() } catch { /* noop */ }
  process.exit(1)
})

// silence unused import warning
void looksLikeOcrFragment
