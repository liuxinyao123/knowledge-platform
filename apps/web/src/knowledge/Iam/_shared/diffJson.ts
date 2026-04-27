/**
 * diffJson —— 渲染 before/after 的字段级 diff。
 *
 * 策略：
 *   - CREATE (before=null)：每个非空 after 字段显示 "key: (new) <after>"
 *   - DELETE (after=null) ：每个非空 before 字段显示 "key: <before> (deleted)"
 *   - UPDATE：遍历 before ∪ after 的 key 集合；only when before[k] !== after[k] 时显示
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-audit-spec.md · AuditTab.diff 场景
 */

type JsonBlob = Record<string, unknown> | null

function toDisp(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 返回描述改动的字符串数组，每项 "<key>: <before> → <after>" 风格。 */
export function diffJson(before: JsonBlob, after: JsonBlob): string[] {
  if (before == null && after == null) return []

  if (before == null) {
    // CREATE
    return Object.entries(after ?? {})
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: (new) ${toDisp(v)}`)
  }

  if (after == null) {
    // DELETE
    return Object.entries(before)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${toDisp(v)} (deleted)`)
  }

  // UPDATE
  const keys = new Set<string>([
    ...Object.keys(before),
    ...Object.keys(after),
  ])
  const out: string[] = []
  for (const k of keys) {
    const a = before[k]
    const b = after[k]
    if (toDisp(a) === toDisp(b)) continue  // 无变化
    out.push(`${k}: ${toDisp(a)} → ${toDisp(b)}`)
  }
  return out
}
