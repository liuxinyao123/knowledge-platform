/**
 * services/condenseQuestion.ts —— follow-up question condensation
 *
 * 背景：retrieval 阶段只用当前 turn 的 question 做 embedding，"那你把原文发我"
 * 这种指代型 follow-up 会被当成全新问题，rerank top-1 直接掉到 0.027 < 0.05，
 * 触发 ragPipeline 的 short-circuit 兜底（"知识库里暂时没有与该问题直接相关的内容"）。
 *
 * 本模块在 retrieval 之前用 fast LLM 把"短/指代型问题 + 最近若干历史"改写成一个
 * 自洽的独立问句。改写后的问句只用于 retrieval / grade / step_back 这些"找文档"
 * 的环节；最终 generateAnswer 仍然喂用户原话 + 完整 history，让 LLM 看到真实输入。
 *
 * 设计原则：
 *   - 默认 on，env `RAG_CONDENSE_QUESTION_ENABLED=false` 关闭
 *   - 只在 history 非空 + 问题"看起来像 follow-up"时调一次 fast LLM
 *   - 任何异常 / 改写结果异常 → 返回原 question，不阻塞主流程
 *   - 跑了改写就 emit 一个 rag_step，便于前端调试看见
 */
import { chatComplete, getLlmFastModel } from './llm.ts'
import type { EmitFn, HistoryMessage } from '../ragTypes.ts'

/** 触发改写的 follow-up 信号词（中英都覆盖；与 ragPipeline 的 compositeMarkers 解耦） */
const PRONOUN_MARKERS = [
  '它', '他', '她', '它们', '他们', '她们',
  '这', '那', '此',
  '这个', '那个', '这些', '那些', '这本', '那本', '这部', '那部',
  'it', 'this', 'that', 'these', 'those',
] as const

const META_MARKERS = [
  '原文', '全文', '继续', '再', '还', '也', '又', '接着', '然后', '那么',
  '解释', '翻译', '总结', '详细', '具体', '展开', '举例', '另外', '其他', '别的',
  'continue', 'explain', 'translate', 'summary', 'summarize', 'detail', 'more',
] as const

const FOLLOWUP_LEN_THRESHOLD = 12
const HISTORY_TAKE = 4
const HISTORY_PER_MSG_CHAR_CAP = 400
const REWRITTEN_MAX_CHAR = 200

export function isCondenseEnabled(): boolean {
  const v = (process.env.RAG_CONDENSE_QUESTION_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/**
 * 判定 question 是否"看起来像 follow-up"：
 *   ① 长度 ≤ 12 字符（中英文混合按 char.length）
 *   ② 含代词（它/这/那/this/that 等）
 *   ③ 含承接/元指令词（原文/继续/解释一下/再说说 等）
 * 命中任一返回 true。导出供单测断言。
 */
export function looksLikeFollowUp(question: string): boolean {
  const q = question.trim()
  if (q.length === 0) return false
  if (q.length <= FOLLOWUP_LEN_THRESHOLD) return true
  const lower = q.toLowerCase()
  if (PRONOUN_MARKERS.some((p) => lower.includes(p))) return true
  if (META_MARKERS.some((m) => lower.includes(m))) return true
  return false
}

function buildPrompt(question: string, history: HistoryMessage[]): string {
  const recent = history.slice(-HISTORY_TAKE)
  const historyText = recent
    .map((h) => {
      const who = h.role === 'user' ? '用户' : '助手'
      const text = h.content.length > HISTORY_PER_MSG_CHAR_CAP
        ? h.content.slice(0, HISTORY_PER_MSG_CHAR_CAP) + '…'
        : h.content
      return `${who}：${text}`
    })
    .join('\n')

  return `根据下面的对话历史，把用户最新的提问改写成一个**自洽的、可以独立检索的中文问句**。

【硬性规则】
1. 把代词和省略指代（它/这/那/原文/继续/解释一下）替换成历史里出现过的具体实体名
2. 不要增加历史中没有的信息，不要回答问题
3. 只输出改写后的问句一行，不要解释，不要加引号、不要加 Markdown
4. 如果当前提问已经自洽（不需要历史就能理解），直接原样输出

【对话历史】
${historyText}

【用户最新提问】
${question}

【改写后的独立问句】`
}

/**
 * 把"短/指代型问题"改写成自洽的独立问句。
 * - 不该改写时返回原 question（不调 LLM）
 * - 改写失败 / 结果异常返回原 question（不抛）
 * - 改写成功且与原句不同时 emit 一次 rag_step
 */
export async function condenseQuestion(
  question: string,
  history: HistoryMessage[],
  emit: EmitFn,
): Promise<string> {
  if (!isCondenseEnabled()) return question
  if (!history || history.length === 0) return question
  if (!looksLikeFollowUp(question)) return question

  try {
    const { content } = await chatComplete(
      [{ role: 'user', content: buildPrompt(question, history) }],
      {
        model: getLlmFastModel(),
        maxTokens: 80,
        temperature: 0.2,
      },
    )
    const raw = (content ?? '').trim()
    // 清理顺序：先剥常见前缀（"改写后：" / "独立问句：" / 行首破折号·）
    // 再剥首尾引号 / 全角括号；最终 trim。先剥前缀是因为 LLM 经常输出
    // "改写后：「xxx」" 这种组合，先剥引号反而留下前缀 + 不完整引号。
    const cleaned = raw
      .replace(/^改写[后过]?[：:]\s*/, '')
      .replace(/^独立问句[：:]\s*/, '')
      .replace(/^[\-—•·\s]+/, '')
      .replace(/^["「『'【]+/, '')
      .replace(/["」』'】]+$/, '')
      .trim()

    if (!cleaned) return question
    if (cleaned.length > REWRITTEN_MAX_CHAR) return question
    if (cleaned === question.trim()) return question

    emit({
      type: 'rag_step',
      icon: '🪄',
      label: `指代改写：「${question}」→「${cleaned}」`,
    })
    return cleaned
  } catch {
    // fast LLM 故障不阻塞 retrieval；保持原句
    return question
  }
}
