import { useState, useEffect, useCallback } from 'react'
import { govApi, type AuditEntry } from '@/api/governance'
import { Skeleton, ErrorView, EmptyView } from './TagsPanel'

const ACTION_LABEL: Record<string, string> = {
  ingest_done: '入库完成',
  acl_rule_create: '新建权限规则',
  acl_rule_update: '修改权限规则',
  acl_rule_delete: '删除权限规则',
  tag_merge: '合并标签',
  tag_rename: '重命名标签',
  asset_merge: '合并资产',
  duplicate_dismiss: '标记非重复',
  quality_fix: '质量修复',
}

function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a
}

const PAGE_SIZE = 20

export default function AuditLogPanel() {
  const [items, setItems] = useState<AuditEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [offset, setOffset] = useState(0)

  const load = useCallback(() => {
    govApi.listAuditLog({
      action: actionFilter || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((r) => { setItems(r.items); setTotal(r.total); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [actionFilter, offset])
  useEffect(() => { load() }, [load])

  const csvUrl = govApi.auditLogCsvUrl(
    actionFilter ? { action: actionFilter, limit: 5000 } : { limit: 5000 },
  )

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 12, marginBottom: 12, background: '#f9fafb',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <label style={{ fontSize: 13 }}>动作过滤</label>
        <select value={actionFilter} onChange={(e) => { setOffset(0); setActionFilter(e.target.value) }}
          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
          <option value="">全部</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <a href={csvUrl} download className="btn"
          style={{ padding: '4px 12px', fontSize: 12, textDecoration: 'none' }}>
          ⬇ 导出 CSV
        </a>
      </div>

      {loading ? <Skeleton />
        : err ? <ErrorView msg={err} onRetry={load} />
        : !items || items.length === 0 ? (
          <EmptyView icon="📜" title="暂无记录" text="所有写操作都会出现在这里" />
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>时间</th>
                  <th style={th}>操作人</th>
                  <th style={th}>动作</th>
                  <th style={th}>对象</th>
                  <th style={th}>详情</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>{new Date(r.ts).toLocaleString('zh-CN')}</td>
                    <td style={td}>{r.principal_email || '系统'}</td>
                    <td style={td}>
                      <span className="pill" style={{
                        padding: '1px 8px', background: '#e6f4ff', borderRadius: 10, fontSize: 12,
                      }}>{actionLabel(r.action)}</span>
                    </td>
                    <td style={td}>
                      {r.target_type ? <code>{r.target_type}#{r.target_id}</code> : '—'}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: 'var(--muted)' }}>
                      {r.detail ? truncJson(r.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13 }}>
              <button className="btn"
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                style={{ padding: '4px 12px' }}
              >← 上一页</button>
              <span style={{ alignSelf: 'center', color: 'var(--muted)' }}>
                {offset + 1} - {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <button className="btn"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                style={{ padding: '4px 12px' }}
              >下一页 →</button>
            </div>
          </>
        )}
    </div>
  )
}

function truncJson(o: Record<string, unknown>): string {
  const s = JSON.stringify(o)
  return s.length > 80 ? s.slice(0, 80) + '...' : s
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 12px' }
