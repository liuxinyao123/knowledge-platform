/**
 * services/answerJudge.ts —— LLM-as-Judge：评估系统答案 vs 参考答案
 *
 * 给一个题目 + 参考答案 + 系统答案，让另一个 LLM 给 0-1 分 + 一句理由。
 *
 * 评分规则（写在 system prompt 里）：
 *   1.0  语义完全一致（即便措辞不同，"1.5 mm" vs "1.5mm" 算 1.0）
 *   0.7-0.9  方向对、关键事实对，但缺细节或多了无关内容
 *   0.4-0.6  半对：部分关键事实对，部分错或缺
 *   0.1-0.3  方向错但提到相关概念
 *   0.0  完全错 / 编造 / 无答案时拒答（对 OOD 题反过来：拒答=1.0，编造=0.0）
 *
 * 用 function-calling / structured output 让结果稳定可解析。
 */
import { chatComplete, type OAITool } from './llm.ts'

export interface JudgeInput {
  question: string
  expectedAnswer: string
  systemAnswer: string
  /** 是否标注为 out_of_doc / partial 等（影响评分逻辑）；可选 */
  tag?: 'OOD' | 'PARTIAL' | null
}

export interface JudgeResult {
  score: number          // 0.0 - 1.0
  reasoning: string      // 一句话理由
}

const JUDGE_TOOL: OAITool = {
  type: 'function',
  function: {
    name: 'submit_judgment',
    description: '提交对系统答案的评分',
    parameters: {
      type: 'object',
      properties: {
        score: {
          type: 'number',
          description: '0.0 到 1.0 的评分。1.0=语义一致；0.5=半对；0.0=完全错或拒答',
        },
        reasoning: {
          type: 'string',
          description: '一句话评分理由（≤60 字）',
        },
      },
      required: ['score', 'reasoning'],
    },
  },
}

const SYSTEM_PROMPT = `你是一个 RAG 系统答案评估官。给定 [问题 / 参考答案 / 系统答案]，给出 0-1 评分。

评分细则：
- 1.0：语义完全一致。"1.5 mm" 跟 "1.5mm" 等价，措辞不同但事实相符算满分
- 0.8-0.9：方向对、关键事实对，缺一些细节或者多了无关内容
- 0.5-0.7：半对，关键事实部分对部分错/缺
- 0.2-0.4：方向错但相关概念被提到
- 0.0：完全错、编造、或在有正确答案时拒答

特殊规则：
- 数字差异 = 0（"1.5mm" vs "2.0mm" → 0.0）
- 单位/格式差异不扣分（"7°" vs "7 degrees" → 1.0）
- 复合答案缺一部分（参考"0.3+0.7=1.0"，系统只说"1.0"）→ 0.5
- 标注 [OOD] 题：参考答案不在文档时，系统说"知识库中没有"=1.0；编造定义=0.0
- 标注 [PARTIAL] 题：按比例给分，半对就 0.5

输出严格调 submit_judgment 工具。`

export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const tagHint = input.tag === 'OOD'
    ? '\n\n[本题标注为 OOD：参考答案不在 PDF 文档里，预期系统应回复"知识库中没有相关内容"]'
    : input.tag === 'PARTIAL'
      ? '\n\n[本题标注为 PARTIAL：参考答案部分在 PDF，按部分给分]'
      : ''

  const userMsg =
    `# 问题\n${input.question}\n\n# 参考答案（ground truth）\n${input.expectedAnswer}\n\n# 系统答案\n${input.systemAnswer || '(空)'}${tagHint}`

  const result = await chatComplete(
    [{ role: 'user', content: userMsg }],
    {
      system: SYSTEM_PROMPT,
      maxTokens: 200,
      tools: [JUDGE_TOOL],
      toolChoice: { type: 'function', function: { name: 'submit_judgment' } },
    },
  )

  // 解析 tool call
  const tc = result.toolCalls?.[0]
  if (tc?.function?.name === 'submit_judgment') {
    try {
      const parsed = JSON.parse(tc.function.arguments) as { score?: unknown; reasoning?: unknown }
      let score = Number(parsed.score)
      if (!Number.isFinite(score)) score = 0
      score = Math.max(0, Math.min(1, score))
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : ''
      return { score, reasoning }
    } catch {
      // fall through to fallback
    }
  }

  // fallback：如果 tool call 没生效（某些 LLM 不支持），尝试解析裸 content
  const text = result.content ?? ''
  const m = text.match(/score["':\s]+([0-9.]+)/i)
  if (m) {
    const score = Math.max(0, Math.min(1, Number(m[1]) || 0))
    return { score, reasoning: text.slice(0, 200) }
  }

  return { score: 0, reasoning: 'judge 未返回有效评分' }
}
