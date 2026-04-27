/**
 * OpenViking sidecar - 业务封装：recall / save 给 KnowledgeQaAgent 用。
 *
 * 这一层负责：
 *   1. 把 principal / session 翻译成 viking:// 路径
 *   2. recall 失败时返回空 hits（永不阻塞）
 *   3. save 改写成 fire-and-forget Promise（caller 不必 await）
 *   4. 提供精简的 ts 接口，KnowledgeQaAgent 不需要直接接触 client.ts
 */

import * as client from './client.ts'
import type { VikingFindHit } from './types.ts'

/** 用户级路径前缀，所有写读都强制限定在这下面 */
function userPrefix(principalId: string | number): string {
  const seg = client.principalToPathSeg(principalId)
  return `viking://user/${seg}/`
}

/** 单次会话子路径 */
function sessionPrefix(principalId: string | number, sessionId: string): string {
  const seg = client.principalToPathSeg(principalId)
  // sessionId 可能含特殊字符，做最小转义
  const sid = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown'
  return `${userPrefix(principalId)}sessions/${sid}/`
}

export interface RecallParams {
  question: string
  principalId: string | number
  sessionId?: string
  topK?: number
}

export interface RecallResult {
  hits: VikingFindHit[]
  /** 给 emit 用的简短摘要 */
  count: number
}

/**
 * 在用户的 viking://user/<id>/ 范围里检索记忆。
 * 失败/disabled 都返回 { hits: [], count: 0 }。
 */
export async function recallMemory(p: RecallParams): Promise<RecallResult> {
  if (!client.isEnabled()) return { hits: [], count: 0 }
  const hits = await client.find({
    query: p.question,
    pathPrefix: userPrefix(p.principalId),
    topK: p.topK ?? 5,
    layer: 'l1',
  })
  return { hits, count: hits.length }
}

export interface SaveParams {
  principalId: string | number
  sessionId: string
  question: string
  answer: string
  /** 命中的 chunk uri / page id，留给后面做 cross-link */
  citations?: Array<{ chunkId?: string | number; pageId?: string | number; title?: string }>
}

export interface SaveResult {
  ok: boolean
  uri?: string
}

/**
 * 把 QA 对写到 viking://user/<id>/sessions/<sid>/<ts>.md。
 * fire-and-forget caller 不需要 await，软超时由 client 控制。
 */
export async function saveMemory(p: SaveParams): Promise<SaveResult> {
  if (!client.isEnabled()) return { ok: false }
  const prefix = sessionPrefix(p.principalId, p.sessionId)
  const ts = Date.now()
  const uri = `${prefix}${ts}.md`
  const content = [
    `# Q\n${p.question.trim()}`,
    `\n# A\n${p.answer.trim()}`,
    p.citations?.length
      ? `\n# Citations\n${p.citations.map((c, i) => `- [${i + 1}] ${c.title ?? c.pageId ?? c.chunkId ?? '?'}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const ok = await client.write(
    {
      uri,
      content,
      metadata: {
        principalId: String(p.principalId),
        sessionId: p.sessionId,
        ts,
        kind: 'qa-pair',
      },
    },
    userPrefix(p.principalId), // 强制前缀
  )
  return { ok, uri: ok ? uri : undefined }
}

/**
 * 把 recall 结果格式化成给 LLM 注入的 context block。
 * 调用方已经决定要不要注入；这里只负责拼字符串。
 */
export function formatRecallAsContext(hits: VikingFindHit[]): string {
  if (!hits.length) return ''
  const lines = hits.map((h, i) => {
    const body = h.l1 || h.l0 || ''
    return `[mem-${i + 1}] ${body}`
  })
  return `[Long-term memory recalled from previous sessions]\n${lines.join('\n')}\n[/memory]`
}
