/**
 * graphInsights/deepResearchPrompt.ts —— 把洞察卡片转成"研究主题 + 查询提示"
 *
 * 设计（OQ-GI-3）：走 llmProviders 抽象（chatComplete），
 * 模型由 GRAPH_INSIGHTS_TOPIC_MODEL 决定，空则用 getLlmModel()（与 ragPipeline 同）。
 *
 * 兜底：LLM 超时/异常时返回拼接模板，WARN 一次。
 */
import { chatComplete, getLlmModel, isLlmConfigured, type ChatMessage } from '../llm.ts'

import { loadGraphInsightsConfig } from './config.ts'
import type { BridgeInsight } from './bridges.ts'
import type { SurpriseInsight } from './surprises.ts'
import type { SparseInsight } from './sparse.ts'
import type { IsolatedInsight } from './isolated.ts'

export interface DeepResearchTopic {
  topic: string
  /** 给 runRagPipeline / 搜索引擎的提示关键词，空字符串表示无 */
  query_hint: string
  /** 触发 RAG 时应该 scope 到的 assetId 列表 */
  seed_asset_ids: number[]
}

/**
 * 与 `index.ts` 的 `FoundInsight` 结构等价；这里独立定义避免循环依赖
 * （deepResearchPrompt 被 index.ts 引用，反过来 import 会成环）。
 */
export type InsightArg =
  | { kind: 'isolated'; data: IsolatedInsight }
  | { kind: 'bridge'; data: BridgeInsight }
  | { kind: 'surprise'; data: SurpriseInsight }
  | { kind: 'sparse'; data: SparseInsight }

function fallbackTopic(insight: InsightArg): DeepResearchTopic {
  switch (insight.kind) {
    case 'isolated': {
      const d = insight.data as IsolatedInsight
      return {
        topic: `扩展《${d.name}》的关联知识`,
        query_hint: '',
        seed_asset_ids: [d.asset_id],
      }
    }
    case 'bridge': {
      const d = insight.data as BridgeInsight
      return {
        topic: `《${d.name}》作为桥接节点的跨主题解析`,
        query_hint: '',
        seed_asset_ids: [d.asset_id],
      }
    }
    case 'surprise': {
      const d = insight.data as SurpriseInsight
      return {
        topic: `《${d.a.name}》与《${d.b.name}》之间的非显而易见关联`,
        query_hint: '',
        seed_asset_ids: [d.a.id, d.b.id],
      }
    }
    case 'sparse': {
      const d = insight.data as SparseInsight
      const coreNames = d.core_assets.map((c) => `《${c.name}》`).join('、')
      return {
        topic: `围绕 ${coreNames} 的知识聚类扩展研究`,
        query_hint: '',
        seed_asset_ids: d.core_assets.map((c) => c.id),
      }
    }
  }
}

function buildPrompt(insight: InsightArg): { system: string; user: string } {
  const system = [
    '你是一个知识库研究助理。收到一条"图谱洞察"后，用一句话生成清晰的研究主题，以便用户用来驱动深度检索。',
    '规则：',
    '1. 主题用一句陈述句，20–40 汉字；不要加"？"；不要用"我们""建议"这类口语。',
    '2. 同时给一个"查询提示"（可选，一行 8–20 字），用来喂给检索引擎。',
    '3. 输出 JSON，形如 {"topic":"...", "query_hint":"..."}。不要任何 JSON 外的文字。',
  ].join('\n')

  let user: string
  switch (insight.kind) {
    case 'isolated': {
      const d = insight.data as IsolatedInsight
      user = `洞察类型: 孤立页面\n资产: ${d.name} (${d.type})\n当前度: ${d.degree}\n创建时间: ${d.created_at ?? '未知'}`
      break
    }
    case 'bridge': {
      const d = insight.data as BridgeInsight
      const modeStr = d.mode === 'community' ? `跨 ${d.bridge_count} 个社区` : `跨 ${d.bridge_count} 个标签集群`
      user = `洞察类型: 桥接节点\n资产: ${d.name} (${d.type})\n识别口径: ${modeStr}`
      break
    }
    case 'surprise': {
      const d = insight.data as SurpriseInsight
      const flags: string[] = []
      if (d.cross_community) flags.push('跨社区')
      if (d.cross_type) flags.push('跨资产类型')
      user = `洞察类型: 惊奇连接\n资产 A: ${d.a.name} (${d.a.type})\n资产 B: ${d.b.name} (${d.b.type})\n特征: ${flags.join(' · ')}\n惊奇度: ${d.surprise_score}`
      break
    }
    case 'sparse': {
      const d = insight.data as SparseInsight
      const coreStr = d.core_assets.map((c) => `${c.name}`).join(', ')
      user = `洞察类型: 稀疏社区\n社区规模: ${d.size} 成员\n内聚度: ${d.cohesion}\n核心成员: ${coreStr}`
      break
    }
  }
  return { system, user }
}

function parseResponse(raw: string | null): { topic?: string; query_hint?: string } {
  if (!raw) return {}
  const trimmed = raw.trim()
  // 最常见的坏情况：LLM 包了 ```json ... ``` fence
  const stripped = trimmed.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const obj = JSON.parse(stripped) as { topic?: string; query_hint?: string }
    return {
      topic: typeof obj.topic === 'string' ? obj.topic.trim() : undefined,
      query_hint: typeof obj.query_hint === 'string' ? obj.query_hint.trim() : undefined,
    }
  } catch {
    return {}
  }
}

export async function generateDeepResearchTopic(
  insight: InsightArg,
): Promise<DeepResearchTopic> {
  const fallback = fallbackTopic(insight)
  if (!isLlmConfigured()) return fallback

  const cfg = loadGraphInsightsConfig()
  const model = cfg.topicModel || getLlmModel()

  const { system, user } = buildPrompt(insight)
  const messages: ChatMessage[] = [{ role: 'user', content: user }]

  try {
    const { content } = await chatComplete(messages, {
      model,
      system,
      maxTokens: 256,
    })
    const parsed = parseResponse(content)
    if (!parsed.topic) {
      // eslint-disable-next-line no-console
      console.warn(
        `graph_insights_topic_fallback ${JSON.stringify({
          reason: 'llm_bad_json',
          kind: insight.kind,
        })}`,
      )
      return fallback
    }
    return {
      topic: parsed.topic,
      query_hint: parsed.query_hint ?? '',
      seed_asset_ids: fallback.seed_asset_ids,
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `graph_insights_topic_fallback ${JSON.stringify({
        reason: 'llm_exception',
        kind: insight.kind,
        err: (err as Error).message,
      })}`,
    )
    return fallback
  }
}
