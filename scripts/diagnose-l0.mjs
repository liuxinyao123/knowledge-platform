#!/usr/bin/env node
/**
 * scripts/diagnose-l0.mjs
 *
 * 诊断脚本：逐 chunk 跑 L0 生成并暴露每一步的成败原因。
 * 不动数据库，只读 metadata_field + 调 LLM/embedding 看哪一步崩。
 *
 * 用法：
 *   node --experimental-strip-types scripts/diagnose-l0.mjs
 *   node --experimental-strip-types scripts/diagnose-l0.mjs --limit 5 --offset 0
 *
 * 输出：每 chunk 一行：[id] STEP RESULT detail
 *   STEP ∈ skip-short / llm-call / llm-throw / parse-fail / l0-too-long / embed-fail / ok
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

function parseArgs() {
  const out = { limit: 10, offset: 0 }
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--limit') out.limit = Number(process.argv[++i])
    else if (a === '--offset') out.offset = Number(process.argv[++i])
  }
  return out
}

const args = parseArgs()

// 读 env
async function loadDotEnv(p) {
  try {
    const txt = await fs.readFile(p, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(m[1] in process.env)) process.env[m[1]] = v
    }
  } catch {}
}
await loadDotEnv(join(REPO_ROOT, 'apps/qa-service/.env'))
await loadDotEnv(join(REPO_ROOT, 'infra/.env'))

const { getPgPool } = await import(pathToFileURL(join(REPO_ROOT, 'apps/qa-service/src/services/pgDb.ts')).href)
const { chatComplete, getLlmModel } = await import(pathToFileURL(join(REPO_ROOT, 'apps/qa-service/src/services/llm.ts')).href)
const { embedTexts, isEmbeddingConfigured } = await import(pathToFileURL(join(REPO_ROOT, 'apps/qa-service/src/services/embeddings.ts')).href)
const { parseAbstractJson } = await import(pathToFileURL(join(REPO_ROOT, 'apps/qa-service/src/services/ingestPipeline/abstract.ts')).href)

// 与 abstract.ts v2 保持一致
const SYSTEM_PROMPT = `你是文档摘要助手。读完文档片段后，必须输出严格 JSON 对象（不是字符串、不是数组、不带任何 markdown 代码块包裹）。

JSON schema：
{"l0": <string ≤200 字>, "l1": <string ≤600 字>}

l0 写一句话核心摘要，不要前缀；l1 用三段：「结论」/「关键事实」/「适用场景」，每段一短行用 \\n 分隔。
中文文档保持中文输出。英文片段可英文。
绝对不要在 JSON 之外输出任何字符。`

const FEWSHOT = [
  { role: 'user', content: '知识图谱是一种结构化语义网络，用三元组 (主语, 谓语, 宾语) 表达实体之间的关系。常用于搜索引擎、推荐系统、问答系统的语义增强。' },
  { role: 'assistant', content: JSON.stringify({ l0: '知识图谱用三元组结构化表达实体关系，常用于搜索、推荐、问答的语义增强。', l1: '结论：知识图谱是结构化的语义网络。\n关键事实：以 (主语, 谓语, 宾语) 三元组建模实体与关系。\n适用场景：搜索引擎、推荐系统、问答系统的语义增强。' }) },
  { role: 'user', content: 'Permissions V2 引入三主体 (role/user/team) × allow|deny × TTL 的 ACL 模型；deny 优先级最高；通配 subject_id="*" 兼容老数据。' },
  { role: 'assistant', content: JSON.stringify({ l0: 'Permissions V2 用三主体 × 效果 × TTL 模型做 ACL，deny 优先；兼容老数据通配。', l1: '结论：Permissions V2 是企业级 ACL 模型。\n关键事实：subject_type ∈ {role,user,team}；effect ∈ {allow,deny}（deny 最高优）；expires_at TTL；subject_id="*" 兼容旧表。\n适用场景：多租户知识库的细粒度授权与审计。' }) },
]

const MIN_CHARS = Number(process.env.L0_GENERATE_MIN_CHARS || 60)
const MODEL = getLlmModel()

console.log(`[diag] model=${MODEL} min_chars=${MIN_CHARS} embedding_ok=${isEmbeddingConfigured()}`)
console.log(`[diag] LLM_BASE_URL=${process.env.LLM_BASE_URL || process.env.EMBEDDING_BASE_URL || 'default'}`)
console.log(`[diag] limit=${args.limit} offset=${args.offset}`)

const pool = getPgPool()
const { rows } = await pool.query(
  `SELECT mf.id, mf.asset_id, mf.content, length(mf.content) AS len
     FROM metadata_field mf
     LEFT JOIN chunk_abstract ca ON ca.chunk_id = mf.id
    WHERE mf.chunk_level = 3 AND ca.id IS NULL
    ORDER BY mf.id
    OFFSET $1 LIMIT $2`,
  [args.offset, args.limit],
)

const stats = { ok: 0, skip: 0, fail: 0 }
const reasons = {}

for (const r of rows) {
  const id = Number(r.id)
  const len = Number(r.len)
  const content = String(r.content || '')

  if (len < MIN_CHARS) {
    console.log(`[${id}] skip-short len=${len}`)
    stats.skip++; continue
  }

  // LLM
  let llmContent
  try {
    const userMsg = content.length > 4000 ? content.slice(0, 4000) + '\n\n…(已截断)' : content
    const t0 = Date.now()
    const res = await chatComplete(
      [...FEWSHOT, { role: 'user', content: userMsg }],
      { model: MODEL, maxTokens: 800, system: SYSTEM_PROMPT, responseFormat: 'json_object', temperature: 0.2 },
    )
    llmContent = res.content
    console.log(`[${id}] llm-ok len=${len} ms=${Date.now() - t0} content_len=${(llmContent || '').length}`)
  } catch (err) {
    const msg = (err.message || '').slice(0, 200)
    console.log(`[${id}] llm-throw ${msg}`)
    stats.fail++
    reasons.llm_throw = (reasons.llm_throw || 0) + 1
    continue
  }

  if (!llmContent) {
    console.log(`[${id}] llm-empty`)
    stats.fail++; reasons.llm_empty = (reasons.llm_empty || 0) + 1; continue
  }

  // Parse
  const parsed = parseAbstractJson(llmContent)
  if (!parsed) {
    const preview = llmContent.replace(/\s+/g, ' ').slice(0, 120)
    // 区分原因
    let why = 'parse-fail'
    try {
      const stripped = llmContent.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
      const o = JSON.parse(stripped)
      if (typeof o?.l0 === 'string' && o.l0.length > 200) why = 'l0-too-long-' + o.l0.length
      else if (typeof o?.l1 === 'string' && o.l1.length > 600) why = 'l1-too-long-' + o.l1.length
      else if (!o?.l0) why = 'no-l0'
    } catch { why = 'not-json' }
    console.log(`[${id}] ${why} preview="${preview}"`)
    stats.fail++; reasons[why.split('-').slice(0, 2).join('-')] = (reasons[why.split('-').slice(0, 2).join('-')] || 0) + 1
    continue
  }

  // Embed
  try {
    const [vec] = await embedTexts([parsed.l0])
    if (!vec || vec.length === 0) throw new Error('empty vector')
    console.log(`[${id}] ok l0_len=${parsed.l0.length} l1_len=${(parsed.l1 || '').length} vec_dim=${vec.length}`)
    stats.ok++
  } catch (err) {
    console.log(`[${id}] embed-fail ${(err.message || '').slice(0, 200)}`)
    stats.fail++; reasons.embed_fail = (reasons.embed_fail || 0) + 1
  }
}

console.log('\n=== 汇总 ===')
console.log(`ok=${stats.ok} skip=${stats.skip} fail=${stats.fail}`)
console.log('原因分布:', reasons)
await pool.end().catch(() => {})
