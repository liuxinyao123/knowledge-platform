/**
 * services/relevanceFormat.ts —— 相关性分数显示格式化
 *
 * 背景：reranker 给出的分数跨度可达 6 个数量级（0.9996 vs 1.66e-5）；
 * 用 `toFixed(2)` 会把任何 < 0.005 的分数都显示成 "0.00"，让用户以为 reranker 坏了。
 * 本模块按分数量级分桶，既保留"高相关两位小数"直觉，又让"极低相关"不丢精度。
 *
 * 对应 spec: openspec/changes/rag-relevance-hygiene/specs/relevance-score-display-spec.md
 */

/** 三档分桶：≥0.5 两位小数；≥0.01 三位小数；else 科学记数；非数字 → '—' */
export function formatRelevanceScore(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s as number)) return '—'
  const n = Number(s)
  if (n >= 0.5)  return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(3)
  return n.toExponential(2)
}

/** 同一套分桶规则的前端友好标签（A-FE 复用） */
export type RelevanceBucket = 'high' | 'medium' | 'weak' | 'none'

export function relevanceBucket(s: number | null | undefined): RelevanceBucket {
  if (s == null || !Number.isFinite(s as number)) return 'none'
  const n = Number(s)
  if (n >= 0.5)  return 'high'
  if (n >= 0.1)  return 'medium'
  if (n >= 0.01) return 'weak'
  return 'none'
}
