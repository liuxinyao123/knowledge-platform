/**
 * services/evalRunner.ts —— 资产级 recall@K 评测执行器
 *
 * 流程：
 *   1. 给定 dataset 拉所有 cases
 *   2. 为每条 case：直接调 runRagPipeline，emit 收集 trace.citations
 *   3. 算 recall@1/3/5 + first_hit_rank，写入 eval_case_result
 *   4. 全部跑完后聚合写入 eval_run（status=done）
 *
 * 直接调内部 RAG 函数（不走 HTTP 回环）：
 *   - 不需要 token / 不解析 SSE
 *   - 跟 /api/qa/ask 同源；citations[] 形态完全一致
 */
import { getPgPool } from './pgDb.ts'
import { runRagPipeline } from './ragPipeline.ts'
import type { SseEvent, RagTrace, Citation } from '../ragTypes.ts'
import { judgeAnswer } from './answerJudge.ts'

export interface EvalCaseInput {
  id: number
  ext_id: string | null
  question: string
  expected_asset_ids: number[]
  expected_answer?: string | null
}

export interface EvalCaseOutcome {
  caseId: number
  question: string
  expected: number[]
  retrieved: number[]
  recall_at_1: number
  recall_at_3: number
  recall_at_5: number
  first_hit_rank: number | null
  duration_ms: number
  error: string | null
  /** LLM Judge 相关字段（仅当 expected_answer 提供时填充） */
  expected_answer?: string | null
  system_answer?: string | null
  judge_score?: number | null      // 0-1
  judge_reasoning?: string | null
}

function recallAt(K: number, expected: number[], retrieved: number[]): number {
  if (expected.length === 0) return 1
  const topK = new Set(retrieved.slice(0, K))
  return expected.filter((id) => topK.has(id)).length / expected.length
}

function firstHitRank(expected: number[], retrieved: number[]): number | null {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) return i + 1
  }
  return null
}

/**
 * 跑单条 case：调 runRagPipeline、抽 trace.citations、算指标
 * 失败时 outcome.error 填异常消息，retrieved=[]，所有 recall=0
 */
/** 从 comment / 或专门字段里推断 OOD/PARTIAL 标签（用于 judge 提示） */
function inferTag(expected: string | null | undefined): 'OOD' | 'PARTIAL' | null {
  if (!expected) return null
  // 这里不读 comment；evalRunner 只看 expected_answer，标签通过 question 自身或外层带入
  // 默认无标签；如要支持可从 caller 透传
  return null
}

export async function runOneCase(c: EvalCaseInput, timeoutMs = 60_000): Promise<EvalCaseOutcome> {
  const start = Date.now()
  const events: SseEvent[] = []
  let systemAnswer = ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    await runRagPipeline(c.question, [], (evt: SseEvent) => {
      events.push(evt)
      // 收集流式答案 token
      if (evt.type === 'content' && typeof evt.text === 'string') {
        systemAnswer += evt.text
      }
    }, ac.signal)
  } catch (err) {
    return {
      caseId: c.id, question: c.question,
      expected: c.expected_asset_ids, retrieved: [],
      recall_at_1: 0, recall_at_3: 0, recall_at_5: 0,
      first_hit_rank: null,
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'unknown',
      expected_answer: c.expected_answer ?? null,
      system_answer: null,
      judge_score: null,
      judge_reasoning: null,
    }
  } finally {
    clearTimeout(timer)
  }

  const traceEvent = events.find((e): e is Extract<SseEvent, { type: 'trace' }> => e.type === 'trace')
  const trace = (traceEvent?.data ?? null) as RagTrace | null
  const citations: Citation[] = trace?.citations ?? []
  const retrieved = citations
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((x) => Number(x.asset_id))

  // ── LLM Judge：有 expected_answer 才跑 ──
  let judge_score: number | null = null
  let judge_reasoning: string | null = null
  if (c.expected_answer && c.expected_answer.trim()) {
    try {
      const j = await judgeAnswer({
        question: c.question,
        expectedAnswer: c.expected_answer,
        systemAnswer,
        tag: inferTag(c.expected_answer),
      })
      judge_score = j.score
      judge_reasoning = j.reasoning
    } catch (err) {
      // judge 失败不影响主流程
      judge_reasoning = `judge error: ${err instanceof Error ? err.message : 'unknown'}`
    }
  }

  return {
    caseId: c.id, question: c.question,
    expected: c.expected_asset_ids, retrieved,
    recall_at_1: recallAt(1, c.expected_asset_ids, retrieved),
    recall_at_3: recallAt(3, c.expected_asset_ids, retrieved),
    recall_at_5: recallAt(5, c.expected_asset_ids, retrieved),
    first_hit_rank: firstHitRank(c.expected_asset_ids, retrieved),
    duration_ms: Date.now() - start,
    error: null,
    expected_answer: c.expected_answer ?? null,
    system_answer: systemAnswer || null,
    judge_score,
    judge_reasoning,
  }
}

/**
 * 跑整个 dataset：异步执行；持续更新 eval_run.finished/errored；最后聚合写入 recall_at_*
 * 返回前立即更新 status=running，外层 routes 会先 INSERT row 拿 runId，再 fire-and-forget 调本函数
 */
export async function executeRun(runId: number, datasetId: number): Promise<void> {
  const pool = getPgPool()

  // 拉 cases 快照
  const { rows: caseRows } = await pool.query(
    `SELECT id, ext_id, question, expected_asset_ids, expected_answer
     FROM eval_case
     WHERE dataset_id = $1
     ORDER BY id ASC`,
    [datasetId],
  )
  const cases: EvalCaseInput[] = caseRows.map((r) => ({
    id: Number(r.id),
    ext_id: r.ext_id ? String(r.ext_id) : null,
    question: String(r.question),
    expected_asset_ids: Array.isArray(r.expected_asset_ids)
      ? r.expected_asset_ids.map(Number).filter(Number.isFinite)
      : [],
    expected_answer: r.expected_answer ? String(r.expected_answer) : null,
  }))

  await pool.query(
    `UPDATE eval_run SET status = 'running', total = $2 WHERE id = $1`,
    [runId, cases.length],
  )

  let finished = 0
  let errored = 0
  const outcomes: EvalCaseOutcome[] = []

  for (const c of cases) {
    const out = await runOneCase(c)
    outcomes.push(out)

    await pool.query(
      `INSERT INTO eval_case_result
         (run_id, case_id, ext_id, question, expected_asset_ids, retrieved_asset_ids,
          recall_at_1, recall_at_3, recall_at_5, first_hit_rank, duration_ms, error,
          expected_answer, system_answer, judge_score, judge_reasoning)
       VALUES ($1, $2, $3, $4, $5::int[], $6::int[], $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        runId, c.id, c.ext_id, out.question,
        out.expected, out.retrieved,
        out.recall_at_1, out.recall_at_3, out.recall_at_5,
        out.first_hit_rank, out.duration_ms, out.error,
        out.expected_answer ?? null,
        out.system_answer ?? null,
        out.judge_score ?? null,
        out.judge_reasoning ?? null,
      ],
    )
    finished++
    if (out.error) errored++

    await pool.query(
      `UPDATE eval_run SET finished = $2, errored = $3 WHERE id = $1`,
      [runId, finished, errored],
    )
  }

  // 聚合
  const valid = outcomes.filter((o) => !o.error)
  const avg = (key: 'recall_at_1' | 'recall_at_3' | 'recall_at_5'): number =>
    valid.length === 0 ? 0 : valid.reduce((s, o) => s + o[key], 0) / valid.length
  const ranks = valid.map((o) => o.first_hit_rank).filter((x): x is number => x != null)
  const avgRank = ranks.length === 0 ? null : ranks.reduce((s, n) => s + n, 0) / ranks.length
  const judged = valid.filter((o) => typeof o.judge_score === 'number')
  const avgJudge = judged.length === 0 ? null
    : judged.reduce((s, o) => s + (o.judge_score ?? 0), 0) / judged.length

  await pool.query(
    `UPDATE eval_run
     SET status = 'done',
         finished_at = NOW(),
         recall_at_1 = $2,
         recall_at_3 = $3,
         recall_at_5 = $4,
         avg_first_hit_rank = $5,
         avg_judge_score = $6,
         judged_count = $7
     WHERE id = $1`,
    [runId, avg('recall_at_1'), avg('recall_at_3'), avg('recall_at_5'), avgRank,
     avgJudge, judged.length],
  )
}
