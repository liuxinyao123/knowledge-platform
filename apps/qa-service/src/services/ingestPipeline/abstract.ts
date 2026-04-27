/**
 * ingestPipeline/abstract.ts —— L0/L1 摘要生成
 *
 * ADR-32 候选 · ingest-l0-abstract change
 *
 * 职责：
 *   - 给 chunk 生成 L0（≤200 字一句话）+ L1（≤600 字结构化概览）
 *   - L0 embed 后落 chunk_abstract
 *   - 单 chunk 失败丢弃，不阻断 ingest 主流程
 *
 * 调用方：
 *   - ingestPipeline/pipeline.ts:runPipeline embed phase 之后（generateAbstractsForAsset）
 *   - lazy 回填：ingestWorker.ts kind='abstract' 路由
 *   - active 回填：scripts/backfill-l0.mjs
 *
 * 默认 enabled，关掉 L0_GENERATE_ENABLED=false 整段 no-op。
 */

import type pg from 'pg'
import { chatComplete, getLlmModel } from '../llm.ts'
import type { ChatMessage } from '../llm.ts'
import { embedTexts, isEmbeddingConfigured } from '../embeddings.ts'

// ── 配置 ────────────────────────────────────────────────────────────

// v2 (2026-04-26)：升级到 getLlmModel（默认 Qwen2.5-72B），加 response_format=json_object + few-shot
//   v1 用 7B + 纯 prompt 实测 not-json 100%（Qwen2.5-7B 不守 JSON 格式约束）
const GENERATOR_VERSION = 'v2'
const L0_MAX_CHARS = 200
const L1_MAX_CHARS = 600

const SYSTEM_PROMPT = `你是文档摘要助手。读完文档片段后，必须输出严格 JSON 对象（不是字符串、不是数组、不带任何 markdown 代码块包裹）。

JSON schema：
{"l0": <string ≤200 字>, "l1": <string ≤600 字>}

l0 写一句话核心摘要，不要前缀；l1 用三段：「结论」/「关键事实」/「适用场景」，每段一短行用 \\n 分隔。
中文文档保持中文输出。英文片段可英文。
绝对不要在 JSON 之外输出任何字符。`

// few-shot 锁住格式与长度
const FEWSHOT_USER_1 = `知识图谱是一种结构化语义网络，用三元组 (主语, 谓语, 宾语) 表达实体之间的关系。常用于搜索引擎、推荐系统、问答系统的语义增强。`
const FEWSHOT_ASST_1 = JSON.stringify({
  l0: '知识图谱用三元组结构化表达实体关系，常用于搜索、推荐、问答的语义增强。',
  l1: '结论：知识图谱是结构化的语义网络。\n关键事实：以 (主语, 谓语, 宾语) 三元组建模实体与关系。\n适用场景：搜索引擎、推荐系统、问答系统的语义增强。',
})

const FEWSHOT_USER_2 = `Permissions V2 引入三主体 (role/user/team) × allow|deny × TTL 的 ACL 模型；deny 优先级最高；通配 subject_id='*' 兼容老数据。`
const FEWSHOT_ASST_2 = JSON.stringify({
  l0: 'Permissions V2 用三主体 × 效果 × TTL 模型做 ACL，deny 优先；兼容老数据通配。',
  l1: '结论：Permissions V2 是企业级 ACL 模型。\n关键事实：subject_type ∈ {role,user,team}；effect ∈ {allow,deny}（deny 最高优）；expires_at TTL；subject_id="*" 兼容旧表。\n适用场景：多租户知识库的细粒度授权与审计。',
})

interface GenerateOpts {
  /** 单次批量内的并发上限。env L0_GENERATE_CONCURRENCY 覆盖 */
  concurrency?: number
  /** chunk 短于此跳过。env L0_GENERATE_MIN_CHARS 覆盖 */
  minChars?: number
  /** abort signal */
  signal?: AbortSignal
}

export interface AbstractCounters {
  generated: number
  failed: number
  skipped: number
}

function isEnabled(): boolean {
  const v = (process.env.L0_GENERATE_ENABLED ?? 'true').toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'on' || v === 'yes'
}

function readConcurrency(opt?: number): number {
  const n = Number(opt ?? process.env.L0_GENERATE_CONCURRENCY ?? 4)
  return Number.isFinite(n) && n >= 1 && n <= 16 ? Math.floor(n) : 4
}

function readMinChars(opt?: number): number {
  const n = Number(opt ?? process.env.L0_GENERATE_MIN_CHARS ?? 60)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60
}

// ── prompt parsing ──────────────────────────────────────────────────

interface ParsedAbstract { l0: string; l1: string | null }

/** 严格解析 LLM 返回的 JSON；失败/越界返回 null */
export function parseAbstractJson(raw: string): ParsedAbstract | null {
  const text = raw.trim()
  // 兼容 LLM 偶尔包裹的 ```json ... ```
  const stripped = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  let obj: unknown
  try {
    obj = JSON.parse(stripped)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const l0Raw = typeof o.l0 === 'string' ? o.l0.trim() : ''
  const l1Raw = typeof o.l1 === 'string' ? o.l1.trim() : ''
  if (!l0Raw) return null
  if (l0Raw.length > L0_MAX_CHARS) return null
  if (l1Raw && l1Raw.length > L1_MAX_CHARS) return null
  return { l0: l0Raw, l1: l1Raw || null }
}

// ── 单条生成 ────────────────────────────────────────────────────────

interface ChunkRow { id: number; asset_id: number; content: string }

async function runOneAbstract(
  chunk: ChunkRow,
  pool: pg.Pool,
): Promise<'generated' | 'failed'> {
  // chatComplete + parse
  const userMsg = chunk.content.length > 4000
    ? chunk.content.slice(0, 4000) + '\n\n…(已截断)'
    : chunk.content

  // few-shot 序列：把示例当历史轮次喂给模型，配合 response_format 锁 JSON 输出
  const messages: ChatMessage[] = [
    { role: 'user', content: FEWSHOT_USER_1 },
    { role: 'assistant', content: FEWSHOT_ASST_1 },
    { role: 'user', content: FEWSHOT_USER_2 },
    { role: 'assistant', content: FEWSHOT_ASST_2 },
    { role: 'user', content: userMsg },
  ]
  const { content } = await chatComplete(
    messages,
    {
      model: getLlmModel(),                // v2：升级到 72B；7B 在中文场景不守 JSON
      maxTokens: 800,
      system: SYSTEM_PROMPT,
      responseFormat: 'json_object',       // 强制 JSON 输出
      temperature: 0.2,                    // 摘要任务不需要发散
    },
  )
  if (!content) return 'failed'
  const parsed = parseAbstractJson(content)
  if (!parsed) return 'failed'

  // embed L0
  const [vec] = await embedTexts([parsed.l0])
  if (!vec || vec.length === 0) return 'failed'
  const vecStr = `[${vec.join(',')}]`

  // INSERT
  await pool.query(
    `INSERT INTO chunk_abstract (chunk_id, asset_id, l0_text, l0_embedding, l1_text, generator_version)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chunk_id) DO UPDATE SET
       l0_text = EXCLUDED.l0_text,
       l0_embedding = EXCLUDED.l0_embedding,
       l1_text = EXCLUDED.l1_text,
       generator_version = EXCLUDED.generator_version,
       generated_at = NOW()`,
    [chunk.id, chunk.asset_id, parsed.l0, vecStr, parsed.l1, GENERATOR_VERSION],
  )
  return 'generated'
}

// ── 批量并发 ────────────────────────────────────────────────────────

async function runBatched(
  chunks: ChunkRow[],
  pool: pg.Pool,
  concurrency: number,
  signal?: AbortSignal,
): Promise<AbstractCounters> {
  const counters: AbstractCounters = { generated: 0, failed: 0, skipped: 0 }
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < chunks.length) {
      if (signal?.aborted) return
      const idx = cursor++
      const chunk = chunks[idx]!
      try {
        const r = await runOneAbstract(chunk, pool)
        if (r === 'generated') counters.generated++
        else counters.failed++
      } catch {
        counters.failed++
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, worker)
  await Promise.all(workers)
  return counters
}

// ── 公共入口 ────────────────────────────────────────────────────────

/**
 * 给 asset 的所有未生成 L0 的 chunk 批量生成 L0/L1。
 * 默认 enabled，flag off 时整段 no-op 返回零计数。
 */
export async function generateAbstractsForAsset(
  assetId: number,
  pool: pg.Pool,
  opts?: GenerateOpts,
): Promise<AbstractCounters> {
  if (!isEnabled()) return { generated: 0, failed: 0, skipped: 0 }
  if (!isEmbeddingConfigured()) return { generated: 0, failed: 0, skipped: 0 }

  const minChars = readMinChars(opts?.minChars)
  const concurrency = readConcurrency(opts?.concurrency)

  // 拉本 asset 未生成 L0 的 chunk_level=3 chunk
  const { rows } = await pool.query(
    `SELECT mf.id, mf.asset_id, mf.content
     FROM metadata_field mf
     LEFT JOIN chunk_abstract ca ON ca.chunk_id = mf.id
     WHERE mf.asset_id = $1 AND mf.chunk_level = 3 AND ca.id IS NULL`,
    [assetId],
  )
  const all: ChunkRow[] = rows.map((r) => ({
    id: Number(r.id),
    asset_id: Number(r.asset_id),
    content: String(r.content ?? ''),
  }))

  // 先过滤掉短 chunk（直接计入 skipped）
  const skipped: ChunkRow[] = []
  const eligible: ChunkRow[] = []
  for (const c of all) {
    if (c.content.length < minChars) skipped.push(c)
    else eligible.push(c)
  }
  if (eligible.length === 0) {
    return { generated: 0, failed: 0, skipped: skipped.length }
  }

  const counters = await runBatched(eligible, pool, concurrency, opts?.signal)
  counters.skipped += skipped.length
  return counters
}

/**
 * 给指定 chunk_id 列表生成 L0/L1（lazy / active 回填用）。
 * 同 generateAbstractsForAsset：disabled / 无 key 时 no-op；单条失败不阻断。
 */
export async function generateAbstractsForChunks(
  chunkIds: number[],
  pool: pg.Pool,
  opts?: GenerateOpts,
): Promise<AbstractCounters> {
  if (!isEnabled()) return { generated: 0, failed: 0, skipped: 0 }
  if (!isEmbeddingConfigured()) return { generated: 0, failed: 0, skipped: 0 }
  if (chunkIds.length === 0) return { generated: 0, failed: 0, skipped: 0 }

  const minChars = readMinChars(opts?.minChars)
  const concurrency = readConcurrency(opts?.concurrency)

  const { rows } = await pool.query(
    `SELECT mf.id, mf.asset_id, mf.content
     FROM metadata_field mf
     LEFT JOIN chunk_abstract ca ON ca.chunk_id = mf.id
     WHERE mf.id = ANY($1::int[]) AND mf.chunk_level = 3 AND ca.id IS NULL`,
    [chunkIds],
  )
  const all: ChunkRow[] = rows.map((r) => ({
    id: Number(r.id),
    asset_id: Number(r.asset_id),
    content: String(r.content ?? ''),
  }))

  const skipped: ChunkRow[] = []
  const eligible: ChunkRow[] = []
  for (const c of all) {
    if (c.content.length < minChars) skipped.push(c)
    else eligible.push(c)
  }
  if (eligible.length === 0) {
    return { generated: 0, failed: 0, skipped: skipped.length }
  }

  const counters = await runBatched(eligible, pool, concurrency, opts?.signal)
  counters.skipped += skipped.length
  return counters
}

/** 测试辅助：暴露内部常量 */
export const __TEST__ = { GENERATOR_VERSION, L0_MAX_CHARS, L1_MAX_CHARS }
