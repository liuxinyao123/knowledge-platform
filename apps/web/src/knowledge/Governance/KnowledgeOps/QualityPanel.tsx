import { useState, useEffect, useCallback } from 'react'
import { govApi, type QualityIssueGroup, type QualityIssueKind } from '@/api/governance'
import { Skeleton, ErrorView, EmptyView } from './TagsPanel'

const KIND_LABEL: Record<QualityIssueKind, string> = {
  missing_author: '缺少作者',
  no_tags: '未抽取标签',
  stale: '180+ 天未更新',
  empty_content: '正文为空',
}

export default function QualityPanel() {
  const [groups, setGroups] = useState<QualityIssueGroup[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<QualityIssueKind | null>(null)
  const [assets, setAssets] = useState<Array<{ id: number; name: string }>>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    govApi.listQualityIssues()
      .then((r) => { setGroups(r.items); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const expand = async (kind: QualityIssueKind) => {
    if (expanded === kind) {
      setExpanded(null); setAssets([]); return
    }
    setExpanded(kind); setAssetsLoading(true)
    try {
      const r = await govApi.listQualityAssets(kind, 50)
      setAssets(r.items)
    } finally {
      setAssetsLoading(false)
    }
  }

  const fixAll = async (kind: QualityIssueKind) => {
    if (!assets.length) return
    if (!confirm(`对 ${assets.length} 条 "${KIND_LABEL[kind]}" 进行批量修复？`)) return
    try {
      const r = await govApi.fixQualityIssue(kind, assets.map((a) => a.id))
      const reminded = r.reminded ? `（仅通知 ${r.reminded.length} 条）` : ''
      setMsg(`✓ 修复 ${r.fixed} 条 ${reminded}`)
      load()
      if (expanded) expand(expanded)
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setMsg('✗ ' + (err?.response?.data?.error || '失败'))
    }
  }

  if (loading) return <Skeleton />
  if (err) return <ErrorView msg={err} onRetry={load} />
  if (!groups || groups.length === 0) return (
    <EmptyView icon="✅" title="质量已达标" text="当前没有发现明显的质量问题" />
  )

  return (
    <div>
      {msg && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: msg.startsWith('✓') ? '#e6f4ea' : '#fce8e6',
          color: msg.startsWith('✓') ? '#1e7e34' : '#c53030', fontSize: 13,
        }}>{msg}</div>
      )}
      {groups.map((g) => (
        <div key={g.kind} style={{
          marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
        }}>
          <div
            onClick={() => expand(g.kind)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 12, cursor: 'pointer',
              background: expanded === g.kind ? '#faf5ff' : 'transparent',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {expanded === g.kind ? '▼' : '▶'} {KIND_LABEL[g.kind]}
                <span style={{
                  marginLeft: 8, padding: '1px 8px', borderRadius: 10,
                  background: '#fee', color: 'var(--red)', fontSize: 12,
                }}>{g.count}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {g.description} · {g.hint}
              </div>
            </div>
          </div>
          {expanded === g.kind && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
              {assetsLoading ? <Skeleton /> : (
                <>
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>展开前 {assets.length} 条</span>
                    <button className="btn btn-primary" onClick={() => fixAll(g.kind)}
                      style={{ padding: '4px 12px', fontSize: 12 }}>
                      批量修复
                    </button>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {assets.slice(0, 20).map((a) => (
                      <li key={a.id}><code>#{a.id}</code> {a.name}</li>
                    ))}
                    {assets.length > 20 && (
                      <li style={{ color: 'var(--muted)' }}>... 仅展示前 20</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
