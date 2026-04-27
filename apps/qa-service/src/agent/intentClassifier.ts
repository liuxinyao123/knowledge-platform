/**
 * agent/intentClassifier.ts —— LLM 结构化意图分类
 * 返回 null 表示 LLM 调用失败或没拿到有效输出（交给 fallback）。
 */
import {
  chatComplete, getLlmFastModel, isLlmConfigured,
  type OAITool,
} from '../services/llm.ts'
import { AGENT_INTENTS, isAgentIntent, type IntentVerdict } from './types.ts'

const INTENT_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'classify_intent',
    description: 'Classify user question into one agent intent',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: [...AGENT_INTENTS] },
        confidence: { type: 'number', description: '0..1 把握程度' },
        reason: { type: 'string', description: 'One sentence explanation' },
      },
      required: ['intent', 'confidence', 'reason'],
    },
  },
}

const SYSTEM_PROMPT = `你是意图分类器。根据用户问题判断最合适的 intent：
- knowledge_qa：查询知识库中的文档、概念、操作指南
- data_admin：统计/报表/审计/增长/监控类问题（基于平台自身数据）
- structured_query：需要按条件从结构化表/字段检索（SQL / schema / 表结构等）
- metadata_ops：对 metadata_source / asset / field / acl_rule 做新增/修改/删除

输出 confidence（你的把握程度）和 reason（一句话解释）。`

/**
 * 调 LLM 做分类；失败/无效返回 null。
 * signal 支持 abort。
 */
export async function classifyByLlm(
  question: string,
  signal?: AbortSignal,
): Promise<IntentVerdict | null> {
  if (!isLlmConfigured()) return null
  if (signal?.aborted) return null

  try {
    const { toolCalls } = await chatComplete(
      [{ role: 'user', content: question }],
      {
        model: getLlmFastModel(),
        maxTokens: 200,
        system: SYSTEM_PROMPT,
        tools: [INTENT_TOOL],
        toolChoice: { type: 'function', function: { name: 'classify_intent' } },
      },
    )

    const args = toolCalls[0]?.function?.arguments
    if (!args) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(args)
    } catch {
      return null
    }

    const obj = parsed as { intent?: unknown; confidence?: unknown; reason?: unknown }
    if (!isAgentIntent(obj.intent)) return null
    const confidence = typeof obj.confidence === 'number'
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0
    const reason = typeof obj.reason === 'string' ? obj.reason : ''

    return {
      intent: obj.intent,
      confidence,
      reason,
      fallback: false,
    }
  } catch {
    return null
  }
}
