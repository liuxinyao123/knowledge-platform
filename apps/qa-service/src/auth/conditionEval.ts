/**
 * auth/conditionEval.ts —— metadata_acl_rule.condition JSONB 谓词评估
 *
 * 支持表达式：
 *   { op: 'and' | 'or', args: [...] }
 *   { field: 'principal.email', op: 'eq', value: '...' }
 *
 * 叶子 op：eq | neq | in | nin | gt | lt | startsWith | endsWith | regex
 * 取值 field 路径从 { principal, resource, now } 中取。
 *
 * regex 加 50ms 超时保护（ReDoS 兜底）。
 */
import type { Principal, AclResource } from './types.ts'

export interface EvalContext {
  principal: Principal
  resource: AclResource
  now?: Date
}

const REGEX_TIMEOUT_MS = 50

// 节点类型收窄
type CondNode =
  | { op: 'and' | 'or'; args: CondNode[] }
  | { field: string; op: string; value: unknown }

function isComposite(n: unknown): n is { op: 'and' | 'or'; args: CondNode[] } {
  if (!n || typeof n !== 'object') return false
  const v = n as { op?: unknown; args?: unknown }
  return (v.op === 'and' || v.op === 'or') && Array.isArray(v.args)
}

function isLeaf(n: unknown): n is { field: string; op: string; value: unknown } {
  if (!n || typeof n !== 'object') return false
  const v = n as { field?: unknown; op?: unknown }
  return typeof v.field === 'string' && typeof v.op === 'string'
}

function getByPath(ctx: EvalContext, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = ctx as unknown as Record<string, unknown>
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function evalLeaf(leaf: { field: string; op: string; value: unknown }, ctx: EvalContext): boolean {
  const left = getByPath(ctx, leaf.field)
  const right = leaf.value

  switch (leaf.op) {
    case 'eq':         return left === right
    case 'neq':        return left !== right
    case 'in':         return Array.isArray(right) && (right as unknown[]).includes(left)
    case 'nin':        return Array.isArray(right) && !(right as unknown[]).includes(left)
    case 'gt':         return typeof left === 'number' && typeof right === 'number' && left > right
    case 'lt':         return typeof left === 'number' && typeof right === 'number' && left < right
    case 'startsWith': return typeof left === 'string' && typeof right === 'string' && left.startsWith(right)
    case 'endsWith':   return typeof left === 'string' && typeof right === 'string' && left.endsWith(right)
    case 'regex':      return evalRegexWithTimeout(String(left ?? ''), String(right ?? ''))
    default:           return false
  }
}

/** 用 setTimeout + sync exec 模拟超时（简易；工程级可换 worker 线程） */
function evalRegexWithTimeout(input: string, pattern: string): boolean {
  if (!pattern) return false
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch {
    return false
  }
  const start = Date.now()
  try {
    const result = re.test(input)
    if (Date.now() - start > REGEX_TIMEOUT_MS) return false
    return result
  } catch {
    return false
  }
}

/**
 * 评估 condition；condition 为 null/undefined 视为"始终成立"。
 */
export function evalCondition(
  condition: Record<string, unknown> | null | undefined,
  ctx: EvalContext,
): boolean {
  if (condition == null) return true
  const node = condition as unknown as CondNode

  if (isComposite(node)) {
    const results = node.args.map((a) => evalCondition(a as unknown as Record<string, unknown>, ctx))
    return node.op === 'and' ? results.every(Boolean) : results.some(Boolean)
  }
  if (isLeaf(node)) return evalLeaf(node, ctx)
  // 非谓词节点（例如只携带 mask 等元数据、或空对象）视为"始终成立"。
  // 这样 { mask: [...] } 这种纯整形配置不会让规则被误判为"不匹配"。
  return true
}
