/**
 * /knowledge-graph —— 全 Space 力导向图
 *
 * 主页面：Space 选择 + stats bar + banner（empty/truncated）+ 懒加载 SigmaGraph
 */
import { Suspense, lazy, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getKgGraph } from '@/api/kg'
import { insightsApi } from '@/api/insights'
import { listSpaces } from '@/api/spaces'
import NodeLegend from './NodeLegend'

// 关键：sigma + graphology + forceatlas2 走独立 chunk，主 bundle 不增量
const SigmaGraph = lazy(() => import('./SigmaGraph'))

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '未知'
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export default function KnowledgeGraph(): ReactElement {
  const spacesQuery = useQuery({
    queryKey: ['spaces-list-for-kgview'],
    queryFn: listSpaces,
    staleTime: 5 * 60_000,
  })
  const spaces = spacesQuery.data ?? []
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null)
  const effectiveSpaceId = selectedSpaceId ?? spaces[0]?.id ?? null

  const graphQuery = useQuery({
    queryKey: ['kg-graph', effectiveSpaceId],
    queryFn: () => getKgGraph(effectiveSpaceId as number),
    enabled: effectiveSpaceId !== null,
    staleTime: 60_000,
  })

  // 副查询：拉 /api/insights 用于"查看 N 条洞察 →"链接
  const insightsCountQuery = useQuery({
    queryKey: ['insights-count-for-kgview', effectiveSpaceId],
    queryFn: () => insightsApi.get(effectiveSpaceId as number),
    enabled: effectiveSpaceId !== null,
    staleTime: 60_000,
    retry: false, // KG 不可用 / 越权时不重试
  })
  const insightsCount = useMemo(() => {
    const p = insightsCountQuery.data
    if (!p) return null
    return (
      (p.isolated?.length ?? 0) +
      (p.bridges?.length ?? 0) +
      (p.surprises?.length ?? 0) +
      (p.sparse?.length ?? 0)
    )
  }, [insightsCountQuery.data])

  const payload = graphQuery.data ?? null

  return (
    <div className="page-body">
      <div className="page-title">知识图谱</div>
      <div className="page-sub">
        以力导向布局展示当前 Space 内所有资产之间的 CO_CITED 与 HAS_TAG 关系；按文件类型着色，悬停高亮邻居。
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0 16px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>Space:</label>
        <select
          value={effectiveSpaceId ?? ''}
          onChange={(e) => setSelectedSpaceId(Number(e.target.value))}
          style={{ minWidth: 180, fontSize: 14, padding: '4px 8px' }}
          disabled={spacesQuery.isLoading || spaces.length === 0}
        >
          {spaces.length === 0 && <option value="">（无可用空间）</option>}
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {payload && !payload.empty && (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              节点 {payload.stats.node_count} · 边 {payload.stats.edge_count}
              {payload.truncated && '（已截断）'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              · 上次刷新 {formatRelative(payload.generated_at)}
            </span>
          </>
        )}

        <span style={{ flex: 1 }} />

        {effectiveSpaceId !== null && (
          <Link
            to="/insights"
            style={{
              fontSize: 13,
              color: 'var(--p, #4f46e5)',
              textDecoration: 'none',
            }}
          >
            查看 {insightsCount ?? '?'} 条洞察 →
          </Link>
        )}

        <button
          type="button"
          onClick={() => graphQuery.refetch()}
          disabled={graphQuery.isFetching || !effectiveSpaceId}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 12px',
            fontSize: 13,
            cursor: graphQuery.isFetching ? 'wait' : 'pointer',
          }}
        >
          {graphQuery.isFetching ? '加载中…' : '刷新'}
        </button>
      </div>

      <NodeLegend />

      {graphQuery.isLoading && (
        <div style={{ padding: '2rem 0', fontSize: 14, color: 'var(--muted)' }}>
          正在加载图谱…
        </div>
      )}

      {graphQuery.isError && (
        <div className="surface-card" style={{ padding: 16, borderLeft: '3px solid var(--danger, #a33)' }}>
          <div style={{ fontSize: 14, color: 'var(--danger, #a33)', fontWeight: 500, marginBottom: 4 }}>
            加载失败
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {graphQuery.error instanceof Error ? graphQuery.error.message : '未知错误'}
          </div>
        </div>
      )}

      {payload?.empty && (
        <div
          className="surface-card"
          style={{ padding: 14, fontSize: 13, borderLeft: '3px solid var(--warning, #c60)' }}
        >
          此 Space 在知识图谱中暂无数据。请重新 ingest 一份资料以触发图谱写入（参见 ADR-27）。
        </div>
      )}

      {payload?.truncated && !payload.empty && (
        <div
          className="surface-card"
          style={{
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
            borderLeft: '3px solid var(--warning, #c60)',
          }}
        >
          图谱规模较大，已截断为度数最高的 {payload.stats.node_count} 个节点。
        </div>
      )}

      {payload && !payload.empty && (
        <Suspense
          fallback={
            <div style={{ padding: '2rem 0', fontSize: 14, color: 'var(--muted)' }}>
              正在加载图渲染引擎…
            </div>
          }
        >
          <SigmaGraph payload={payload} />
        </Suspense>
      )}
    </div>
  )
}
