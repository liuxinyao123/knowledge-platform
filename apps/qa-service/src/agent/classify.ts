/**
 * agent/classify.ts —— 组合 LLM + 关键字兜底
 */
import { classifyByLlm } from './intentClassifier.ts'
import { classifyByKeyword } from './intentFallback.ts'
import type { IntentVerdict } from './types.ts'

function envThreshold(): number {
  const raw = Number(process.env.AGENT_INTENT_THRESHOLD)
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return 0.6
  return raw
}

/**
 * 若 LLM 返回置信度 >= 阈值采纳；否则走关键字兜底。
 * LLM 失败/空也走兜底。
 */
export async function classify(
  question: string,
  signal?: AbortSignal,
): Promise<IntentVerdict> {
  const threshold = envThreshold()
  const llmVerdict = await classifyByLlm(question, signal)
  if (llmVerdict && llmVerdict.confidence >= threshold) return llmVerdict
  return classifyByKeyword(question)
}
