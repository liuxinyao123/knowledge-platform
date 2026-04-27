/**
 * auth/evaluateAcl.ts —— ACL 规则引擎
 *
 * 输入：principal + action + resource
 * 算法：
 *   1. 从 metadata_acl_rule 拉出候选规则集（只在应用启动时加载一次，可手动 reload）
 *   2. 按"具体度"+"角色匹配"+"condition 评估"逐条过滤
 *   3. 命中集合的 union 形成 allow；派生 filter；汇总 mask
 *
 * D-003：多规则 union；deny by default
 * D-004：Decision 走 aclCache（在 enforceAcl 里加的缓存，这里是纯函数）
 */
import { getPgPool } from '../services/pgDb.ts'
import type {
  AclAction, AclResource, AclRuleRow, Decision, FieldMask, Principal,
} from './types.ts'
import { evalCondition } from './conditionEval.ts'
import { deriveFilter } from './filterDerive.ts'
import { resolveSpaceOf } from './resolveSpace.ts'

// ── 规则缓存（启动时加载） ────────────────────────────────────────────────────

let _rules: AclRuleRow[] | null = null

export async function loadRules(force = false): Promise<AclRuleRow[]> {
  if (!force && _rules) return _rules
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, source_id, asset_id, role, permission, condition, permission_required,
            subject_type, subject_id, effect, expires_at, space_id
     FROM metadata_acl_rule`,
  )
  _rules = rows.map((r) => ({
    id: Number(r.id),
    source_id: r.source_id == null ? null : Number(r.source_id),
    asset_id: r.asset_id == null ? null : Number(r.asset_id),
    space_id: r.space_id == null ? null : Number(r.space_id),
    field_id: null,
    role: r.role == null ? null : String(r.role),
    permission: String(r.permission),
    condition: (r.condition as Record<string, unknown>) ?? null,
    permission_required: r.permission_required == null ? null : String(r.permission_required),
    // V2 字段
    subject_type: r.subject_type == null ? null : String(r.subject_type),
    subject_id:   r.subject_id   == null ? null : String(r.subject_id),
    effect:       r.effect       == null ? 'allow' : String(r.effect),
    expires_at:   r.expires_at   == null ? null : new Date(r.expires_at),
  }))
  return _rules
}

export function reloadRules(): Promise<AclRuleRow[]> {
  _rules = null
  return loadRules(true)
}

/** 测试辅助：直接注入规则集 */
export function __setRulesForTest(rules: AclRuleRow[] | null): void {
  _rules = rules
}

// ── 规则过滤 ────────────────────────────────────────────────────────────────

/**
 * V2 主体匹配：rule.subject_type + rule.subject_id 对照 principal
 *   role:* / role:admin / role:editor / ...
 *   user:<email>
 *   team:<id>
 *
 * 旧规则（subject_type=NULL）回退到老逻辑：rule.role NULL=全员，否则按 role 比对
 */
function subjectMatches(rule: AclRuleRow, principal: Principal): boolean {
  // V2 路径
  if (rule.subject_type) {
    const sid = rule.subject_id
    if (rule.subject_type === 'role') {
      if (sid === '*' || sid == null) return true
      return principal.roles.includes(sid)
    }
    if (rule.subject_type === 'user') {
      return !!sid && sid === principal.email
    }
    if (rule.subject_type === 'team') {
      return !!sid && (principal.team_ids ?? []).includes(sid)
    }
    return false
  }
  // 旧规则回退
  if (rule.role == null) return true
  return principal.roles.includes(rule.role)
}

function notExpired(rule: AclRuleRow): boolean {
  if (!rule.expires_at) return true
  return rule.expires_at.getTime() > Date.now()
}

function permissionMatches(rule: AclRuleRow, action: AclAction): boolean {
  if (rule.permission === 'ADMIN') return true            // ADMIN 超集
  return rule.permission === action
}

function resourceMatches(rule: AclRuleRow, resource: AclResource): boolean {
  // 规则限制了 asset_id：resource 显式指定时必须相等；未指定则视为"待 filter 收敛"
  if (rule.asset_id != null && resource.asset_id != null
      && resource.asset_id !== rule.asset_id) {
    return false
  }
  // 规则限制了 source_id：同上
  if (rule.source_id != null && resource.source_id != null
      && resource.source_id !== rule.source_id) {
    return false
  }
  // space-permissions：rule.space_id 有值时，resource 必须落在该空间内
  //   - resource.space_ids 已由上游 resolve 好：包含 rule.space_id 才命中
  //   - 若 resource.space_ids 未提供（nil/undef），保守放行（上游没查表 = 走 org 级）
  //   - rule.space_id = NULL → 不约束空间维度（org 级规则）
  if (rule.space_id != null) {
    const ids = resource.space_ids
    if (Array.isArray(ids) && ids.length > 0 && !ids.includes(rule.space_id)) {
      return false
    }
    if (Array.isArray(ids) && ids.length === 0) {
      // 明确空集 → 资源没归属任何空间 → space-scoped 规则一律不参评
      return false
    }
  }
  return true
}

// ── condition.mask 派生 ──────────────────────────────────────────────────────

function extractMask(rule: AclRuleRow): FieldMask[] | null {
  const cond = rule.condition
  if (!cond || typeof cond !== 'object') return null
  const m = (cond as { mask?: unknown }).mask
  if (!Array.isArray(m)) return null
  const out: FieldMask[] = []
  for (const entry of m) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { field?: unknown; mode?: unknown }
    if (typeof e.field !== 'string') continue
    if (e.mode === 'hide' || e.mode === 'star' || e.mode === 'hash' || e.mode === 'truncate') {
      out.push({ field: e.field, mode: e.mode })
    }
  }
  return out.length ? out : null
}

// ── 入口 ────────────────────────────────────────────────────────────────────

export async function evaluateAcl(
  principal: Principal,
  action: AclAction,
  resource: AclResource,
): Promise<Decision> {
  const rules = await loadRules()
  if (rules.length === 0) {
    return { allow: false, reason: 'no matching rule' }
  }

  // space-permissions: 若 resource 未带 space_ids，按 source/asset 解析一次
  //   - flag 关 / 解析失败 / 空集 → resource.space_ids = [] 明确空集，
  //     space-scoped rule 一律不参评（resourceMatches 已处理）
  //   - 命中任意空间 → 交给 resourceMatches 按 rule.space_id 过滤
  if (!Array.isArray(resource.space_ids)) {
    resource = { ...resource, space_ids: await resolveSpaceOf(resource) }
  }

  const matched: AclRuleRow[] = []
  const denyMatched: AclRuleRow[] = []
  const masks: FieldMask[] = []

  for (const rule of rules) {
    if (!notExpired(rule)) continue
    if (!subjectMatches(rule, principal)) continue
    if (!permissionMatches(rule, action)) continue
    if (!resourceMatches(rule, resource)) continue
    if (!evalCondition(rule.condition, { principal, resource })) continue
    // PRD §2 升级：rule 设了 permission_required 时，principal 必须有该 permission
    if (rule.permission_required
        && !principal.permissions.includes(rule.permission_required)) {
      continue
    }

    if (rule.effect === 'deny') {
      denyMatched.push(rule)
      continue   // deny 匹配后不算 allow，下面统一判
    }
    matched.push(rule)
    const m = extractMask(rule)
    if (m) masks.push(...m)
  }

  // V2：deny 最高优先 —— 任一 deny 命中就拒
  if (denyMatched.length > 0) {
    return {
      allow: false,
      reason: `denied by rule(s) ${denyMatched.map((r) => r.id).join(',')}`,
      matchedRuleIds: denyMatched.map((r) => r.id),
    }
  }

  if (matched.length === 0) {
    return { allow: false, reason: 'no matching rule' }
  }

  const filter = deriveFilter(matched)
  const dedupedMasks = dedupeMasks(masks)
  const decision: Decision = {
    allow: true,
    matchedRuleIds: matched.map((r) => r.id),
  }
  if (filter) decision.filter = filter
  if (dedupedMasks.length) decision.mask = dedupedMasks
  return decision
}

function dedupeMasks(masks: FieldMask[]): FieldMask[] {
  const seen = new Map<string, FieldMask>()
  for (const m of masks) {
    const key = `${m.field}|${m.mode}`
    if (!seen.has(key)) seen.set(key, m)
  }
  return [...seen.values()]
}
