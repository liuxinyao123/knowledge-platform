/**
 * agent/plan.ts —— 路由规划
 *
 * Phase 1：单步（steps.length === 1）；保留 plan() 给未来多 Agent DAG。
 */
import type { DispatchPlan, IntentVerdict } from './types.ts'

export function plan(verdict: IntentVerdict, question: string): DispatchPlan {
  return {
    steps: [{ intent: verdict.intent, question }],
  }
}
