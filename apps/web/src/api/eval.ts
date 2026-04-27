/**
 * api/eval.ts —— 评测 API client
 */
import axios from 'axios'

const client = axios.create({ baseURL: '/api/eval' })

// ── types ────────────────────────────────────────────────────────────────────

export interface EvalDatasetSummary {
  id: number
  name: string
  description: string | null
  created_by: string | null
  created_at_ms: number
  updated_at_ms: number
  case_count: number
  last_run_at_ms: number | null
}

export interface EvalCase {
  id: number
  ext_id: string | null
  question: string
  expected_asset_ids: number[]
  comment: string | null
  expected_answer: string | null
  created_at_ms: number
}

export interface EvalRunSummary {
  id: number
  dataset_id: number
  dataset_name: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  total: number
  finished: number
  errored: number
  recall_at_1: string | null     // numeric → string
  recall_at_3: string | null
  recall_at_5: string | null
  avg_first_hit_rank: string | null
  avg_judge_score: string | null     // 0-1，由 LLM Judge 评出
  judged_count: number               // 实际跑过 judge 的题数
  notes: string | null
  principal_email: string | null
  started_at_ms: number
  finished_at_ms: number | null
}

export interface EvalCaseResult {
  id: number
  case_id: number | null
  ext_id: string | null
  question: string
  expected_asset_ids: number[]
  retrieved_asset_ids: number[]
  recall_at_1: string | null
  recall_at_3: string | null
  recall_at_5: string | null
  first_hit_rank: number | null
  duration_ms: number | null
  error: string | null
  expected_answer: string | null
  system_answer: string | null
  judge_score: string | null      // 0-1
  judge_reasoning: string | null
  created_at_ms: number
}

// ── datasets ────────────────────────────────────────────────────────────────

export async function listDatasets(): Promise<EvalDatasetSummary[]> {
  const { data } = await client.get<{ items: EvalDatasetSummary[] }>('/datasets')
  return data.items
}

export async function createDataset(input: {
  name: string; description?: string
}): Promise<{ id: number; name: string }> {
  const { data } = await client.post('/datasets', input)
  return data
}

export async function getDataset(
  id: number,
): Promise<{ dataset: EvalDatasetSummary; cases: EvalCase[] }> {
  const { data } = await client.get(`/datasets/${id}`)
  return data
}

export async function deleteDataset(id: number): Promise<void> {
  await client.delete(`/datasets/${id}`)
}

// ── cases ──────────────────────────────────────────────────────────────────

export async function addCase(datasetId: number, input: {
  ext_id?: string; question: string; expected_asset_ids: number[]; comment?: string;
  expected_answer?: string
}): Promise<EvalCase> {
  const { data } = await client.post<EvalCase>(`/datasets/${datasetId}/cases`, input)
  return data
}

export async function patchCase(id: number, input: Partial<{
  ext_id: string; question: string; expected_asset_ids: number[]; comment: string
}>): Promise<void> {
  await client.patch(`/cases/${id}`, input)
}

export async function deleteCase(id: number): Promise<void> {
  await client.delete(`/cases/${id}`)
}

export async function importJsonl(datasetId: number, jsonl: string, replace = false): Promise<{
  inserted: number; parsed: number; errors: Array<{ line: number; error: string }>
}> {
  const { data } = await client.post(`/datasets/${datasetId}/import-jsonl`, { jsonl, replace })
  return data
}

// ── runs ───────────────────────────────────────────────────────────────────

export async function startRun(datasetId: number, notes?: string): Promise<{ runId: number; total: number }> {
  const { data } = await client.post(`/datasets/${datasetId}/run`, notes ? { notes } : {})
  return data
}

export async function listRuns(datasetId?: number): Promise<EvalRunSummary[]> {
  const { data } = await client.get<{ items: EvalRunSummary[] }>('/runs', {
    params: datasetId ? { dataset_id: datasetId } : {},
  })
  return data.items
}

export async function getRun(id: number): Promise<{
  run: EvalRunSummary; results: EvalCaseResult[]
}> {
  const { data } = await client.get(`/runs/${id}`)
  return data
}
