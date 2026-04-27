/**
 * /insights —— 图谱洞察页面
 *
 * 四类洞察 card grid + Space 选择器 + 刷新按钮 + stats strip
 *
 * 契约：openspec/changes/graph-insights/specs/graph-insights-spec.md
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { insightsApi, type InsightsPayload } from '@/api/insights'
import { listSpaces } from '@/api/spaces'
import { useAuth } from '@/auth/AuthContext'
import IsolatedCard from './Cards/Isolated'
import BridgesCard from './Cards/Bridges'
import SurprisesCard from './Cards/Surprises'
import SparseCard from './Cards/Sparse'

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '未知'
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function MetricTile({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="surface-card metric-card">
      <div className="metric-top">
        <div className="metric-label">{label}</div>
      </div>
      <div className="metric-val">{value}</div>
    </div>
  )
}

export default function Insights(): ReactElement {
  const auth = useAuth()
  const queryClient = useQueryClient()

  const spacesQuery = useQuery({
    queryKey: ['spaces-list-for-insights'],
    queryFn: listSpaces,
    staleTime: 5 * 60_000,
  })
  const spaces = spacesQuery.data ?? []
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null)
  const effectiveSpaceId = selectedSpaceId ?? spaces[0]?.id ?? null

  const isAdmin = useMemo(() => {
    const roles = auth.user?.roles ?? []
    if (!effectiveSpaceId) return false
    if (roles.includes('admin')) return true
    const mySpace = spaces.find((s) => s.id === effectiveSpaceId)
    return mySpace?.my_role === 'owner' || mySpace?.my_role === 'admin'
  }, [auth.user, effectiveSpaceId, spaces])

  const insightsQuery = useQuery({
    queryKey: ['insights', effectiveSpaceId],
    queryFn: () => insightsApi.get(effectiveSpaceId as number),
    enabled: effectiveSpaceId !== null,
    staleTime: 60_000,
  })

  const refreshMutation = useMutation({
    mutationFn: () => insightsApi.refresh(effectiveSpaceId as number),
    onSuccess: (data) => {
      queryClient.setQueryData(['insights', effectiveSpaceId], data)
    },
  })

  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set())
  function handleDismiss(key: string) {
    setLocalDismissed((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  const payload: InsightsPayload | null = insightsQuery.data ?? null
  const displayed = useMemo<InsightsPayload | null>(() => {
    if (!payload) return null
    if (localDismissed.size === 0) return payload
    return {
      ...payload,
      isolated: (payload.isolated ?? []).filter((x) => !localDismissed.has(x.key)),
      bridges: (payload.bridges ?? []).filter((x) => !localDismissed.has(x.key)),
      surprises: (payload.surprises ?? []).filter((x) => !localDismissed.has(x.key)),
      sparse: (payload.sparse ?? []).filter((x) => !localDismissed.has(x.key)),
    }
  }, [payload, localDismissed])

  return (
    <div className="page-body">
      <div className="page-title">图谱洞察</div>
      <div className="page-sub">
        按需分析 Space 内的知识图谱，暴露孤立页面、桥接节点、惊奇连接与稀疏社区；每条洞察可一键触发 Deep Research。
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0 20px' }}>
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

        {payload && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            上次计算 {formatRelative(payload.computed_at)}
          </span>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || !effectiveSpaceId}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 13,
              cursor: refreshMutation.isPending ? 'wait' : 'pointer',
            }}
          >
            {refreshMutation.isPending ? '刷新中…' : '强制刷新'}
          </button>
        )}
      </div>

      {insightsQuery.isLoading && (
        <div style={{ fontSize: 14, color: 'var(--muted)', padding: '2rem 0' }}>
          正在计算洞察…
        </div>
      )}

      {insightsQuery.isError && (
        <div className="surface-card" style={{ padding: 16, borderLeft: '3px solid var(--danger, #a33)' }}>
          <div style={{ fontSize: 14, color: 'var(--danger, #a33)', fontWeight: 500, marginBottom: 4 }}>
            加载失败
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {insightsQuery.error instanceof Error ? insightsQuery.error.message : '未知错误'}
          </div>
        </div>
      )}

      {displayed && (
        <>
          {displayed.degraded && (
            <div
              className="surface-card"
              style={{
                padding: 12,
                marginBottom: 16,
                borderLeft: '3px solid var(--warning, #c60)',
                fontSize: 13,
              }}
            >
              图谱规模较大，部分洞察已降级（原因：{displayed.degrade_reason ?? '未知'}）。
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <MetricTile label="资产总数" value={(displayed.stats?.asset_count ?? 0).toLocaleString()} />
            <MetricTile label="图谱边数" value={(displayed.stats?.edge_count ?? 0).toLocaleString()} />
            <MetricTile label="社区数" value={displayed.stats?.community_count ?? 0} />
            <MetricTile
              label="待处理洞察"
              value={
                (displayed.isolated?.length ?? 0) +
                (displayed.bridges?.length ?? 0) +
                (displayed.surprises?.length ?? 0) +
                (displayed.sparse?.length ?? 0)
              }
            />
          </div>

          <IsolatedCard
            spaceId={displayed.space_id}
            items={displayed.isolated ?? []}
            onDismiss={handleDismiss}
          />
          <BridgesCard
            spaceId={displayed.space_id}
            items={displayed.bridges ?? []}
            onDismiss={handleDismiss}
          />
          <SurprisesCard
            spaceId={displayed.space_id}
            items={displayed.surprises ?? []}
            onDismiss={handleDismiss}
          />
          <SparseCard
            spaceId={displayed.space_id}
            items={displayed.sparse ?? []}
            onDismiss={handleDismiss}
          />
        </>
      )}
    </div>
  )
}
