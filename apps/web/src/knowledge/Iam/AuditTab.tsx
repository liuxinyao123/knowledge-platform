/**
 * AuditTab —— ACL 规则变更审计（Permissions V2 · F-3）
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-audit-spec.md
 *
 * 功能：
 *   - 过滤器：rule_id / actor（email）/ since / until
 *   - 表格：at / actor / op / rule_id / diff
 *   - 默认按 at DESC 每页 50
 */
import { useCallback, useEffect, useState } from 'react'
import { listAclAudit, type AuditRow, type AuditFilters } from '@/api/iam'
import { diffJson } from './_shared/diffJson'

export default function AuditTab() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [total, setTotal] = useState<number>(0)
  const [err, setErr] = useState<string | null>(null)

  const [ruleIdFilter, setRuleIdFilter] = useState<string>('')
  const [actorFilter, setActorFilter] = useState<string>('')
  const [sinceFilter, setSinceFilter] = useState<string>('')
  const [untilFilter, setUntilFilter] = useState<string>('')

  const load = useCallback(async () => {
    setErr(null)
    const filters: AuditFilters = {}
    const rid = Number(ruleIdFilter)
    if (ruleIdFilter && Number.isFinite(rid)) filters.rule_id = rid
    if (actorFilter.trim()) filters.actor = actorFilter.trim()
    if (sinceFilter) filters.since = sinceFilter
    if (untilFilter) filters.until = untilFilter
    try {
      const r = await listAclAudit(filters)
      setRows(r.items)
      setTotal(r.total)
    } catch (e) {
      const em = e instanceof Error ? e.message : 'load failed'
      setErr(em)
      setRows([])
    }
  }, [ruleIdFilter, actorFilter, sinceFilter, untilFilter])

  useEffect(() => { void load() }, [load])

  return (
    <div>
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <input
          type="text" placeholder="rule_id"
          value={ruleIdFilter}
          onChange={(e) => setRuleIdFilter(e.target.value)}
          style={{ width: 80, padding: '4px 8px' }}
        />
        <input
          type="text" placeholder="actor email"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          style={{ width: 180, padding: '4px 8px' }}
        />
        <input
          type="datetime-local" placeholder="since"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
        <input
          type="datetime-local" placeholder="until"
          value={untilFilter}
          onChange={(e) => setUntilFilter(e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
        <button className="btn" onClick={() => void load()}>刷新</button>
        <div style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
          共 {total} 条（显示 ≤ 50）
        </div>
      </div>

      {err && <div style={{ color: '#B91C1C', marginBottom: 8 }}>{err}</div>}

      {rows == null ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>暂无审计记录</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, #f5f5f5)' }}>
              <th style={cellStyle}>时间</th>
              <th style={cellStyle}>操作者</th>
              <th style={cellStyle}>操作</th>
              <th style={cellStyle}>规则 id</th>
              <th style={cellStyle}>diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diffs = diffJson(r.before_json, r.after_json)
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                  <td style={cellStyle}>{new Date(r.at).toLocaleString()}</td>
                  <td style={cellStyle}>{r.actor_email ?? '—'}</td>
                  <td style={cellStyle}>
                    <span style={opBadgeStyle(r.op)}>{r.op}</span>
                  </td>
                  <td style={cellStyle}>{r.rule_id ?? '—'}</td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 12 }}>
                    {diffs.length === 0 ? '—' : (
                      <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                        {diffs.map((d) => <li key={d}>{d}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  verticalAlign: 'top',
}

function opBadgeStyle(op: 'CREATE' | 'UPDATE' | 'DELETE'): React.CSSProperties {
  const color = op === 'CREATE' ? '#059669' : op === 'UPDATE' ? '#2563EB' : '#DC2626'
  return {
    padding: '2px 6px',
    borderRadius: 4,
    background: `${color}22`,
    color,
    fontSize: 11,
    fontWeight: 600,
  }
}
