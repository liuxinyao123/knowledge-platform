/**
 * Governance/Actions/index.tsx
 *
 * Main tab: shows pending approval queue + run history.
 */

import { useState, useEffect, useCallback } from 'react'
import { actionsApi } from '@/api/actions'
import type { ActionRun } from '@/api/actions'
import PendingQueue from './PendingQueue'
import RunHistory from './RunHistory'

type ActionSubTab = 'pending' | 'history'

export default function ActionsTab() {
  const [subTab, setSubTab] = useState<ActionSubTab>('pending')
  const [pendingRuns, setPendingRuns] = useState<ActionRun[]>([])
  const [historyRuns, setHistoryRuns] = useState<ActionRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Load pending + history. Backend: GET /api/actions/runs?state=&limit=&offset=
  // admin sees all; non-admin sees own runs only (filtered server-side).
  useEffect(() => {
    let cancelled = false
    const fetchRuns = async () => {
      setLoading(true)
      setError(null)
      try {
        const [pending, history] = await Promise.all([
          actionsApi.listRuns({ state: 'pending', limit: 100 }),
          actionsApi.listRuns({ limit: 50 }),
        ])
        if (cancelled) return
        // 防御：如果 API 返回 shape 异常（e.g. vite proxy 缺失导致拿到 HTML），
        // Array.isArray 兜底为 []，防止 setState 写入 undefined 导致渲染期 crash
        const pendingItems = Array.isArray(pending?.items) ? pending.items : []
        const historyItems = Array.isArray(history?.items) ? history.items : []
        setPendingRuns(pendingItems)
        // History view 排除 pending 行避免与 PendingQueue 重复
        setHistoryRuns(historyItems.filter((r) => r.state !== 'pending'))
        if (!Array.isArray(pending?.items) || !Array.isArray(history?.items)) {
          setError('API 响应格式异常（可能是 vite proxy 配置问题）。请硬刷新或重启 dev server。')
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(`加载运行记录失败：${msg}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchRuns()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
  }, [])

  return (
    <div data-testid="tab-content-actions" className="surface-card" style={{ padding: '1rem' }}>
      <div className="panel-head" style={{ marginBottom: '1rem' }}>
        <span className="panel-title">操作与审批</span>
      </div>

      {/* Tab switcher */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        <button
          onClick={() => setSubTab('pending')}
          style={{
            padding: '0.5rem 1rem',
            background: subTab === 'pending' ? 'var(--highlight)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            borderBottom: subTab === 'pending' ? '2px solid var(--primary)' : 'none',
          }}
        >
          待审批 ({pendingRuns.length})
        </button>
        <button
          onClick={() => setSubTab('history')}
          style={{
            padding: '0.5rem 1rem',
            background: subTab === 'history' ? 'var(--highlight)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            borderBottom: subTab === 'history' ? '2px solid var(--primary)' : 'none',
          }}
        >
          执行历史
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>加载中…</p>
      ) : error ? (
        <div style={{ padding: '0.75rem', background: 'var(--error-bg, #fee)', border: '1px solid var(--error, #c33)', borderRadius: 4 }}>
          <p style={{ color: 'var(--error, #c33)', margin: 0 }}>{error}</p>
          <button onClick={handleRefresh} style={{ marginTop: '0.5rem', cursor: 'pointer' }}>重试</button>
        </div>
      ) : subTab === 'pending' ? (
        <PendingQueue runs={pendingRuns} onRefresh={handleRefresh} />
      ) : (
        <RunHistory runs={historyRuns} onRefresh={handleRefresh} />
      )}
    </div>
  )
}
