/**
 * agent/intentFallback.ts —— 关键字启发式兜底
 * LLM 不可用 / 置信度不足时走这套规则。
 */
import type { AgentIntent, IntentVerdict } from './types.ts'

interface Rule {
  intent: AgentIntent
  match: (q: string) => boolean
  confidence: number                      // 关键字命中时给的置信度
  reason: string
}

const RULES: Rule[] = [
  {
    intent: 'metadata_ops',
    match: (q) => /(新建|创建|修改|更新|删除|下线).{0,8}(资产|数据源|元数据|字段|规则|acl)/i.test(q),
    confidence: 0.7,
    reason: 'keyword matched CRUD + metadata terms',
  },
  {
    intent: 'data_admin',
    match: (q) => /(统计|总共|多少|报表|审计|增长|趋势|占比|监控).*(用户|文档|问答|空间|资产|近[\u4e00-\u9fa5\d]+(天|周|月))/.test(q)
      || /^@数据管理员(?:\s|$)/.test(q)   // CJK 后 \b 不触发，改用空格/结束锚
      || q.includes('#资产'),
    confidence: 0.7,
    reason: 'keyword matched data-admin analytics verbs',
  },
  {
    intent: 'structured_query',
    match: (q) => /(SELECT|FROM|WHERE|GROUP BY|ORDER BY)\b/i.test(q)
      || /(表结构|schema|字段.{0,6}类型|查询.{0,4}表)/i.test(q),
    confidence: 0.7,
    reason: 'keyword matched SQL / schema',
  },
]

export function classifyByKeyword(question: string): IntentVerdict {
  for (const r of RULES) {
    if (r.match(question)) {
      return {
        intent: r.intent,
        confidence: r.confidence,
        reason: r.reason,
        fallback: true,
      }
    }
  }
  return {
    intent: 'knowledge_qa',
    confidence: 0.5,
    reason: 'default to knowledge_qa',
    fallback: true,
  }
}
