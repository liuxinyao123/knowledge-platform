/**
 * Governance/Actions/RunHistory.tsx
 *
 * Paginated list of action runs with filters (action, state).
 */

import { useState } from 'react'
import { type ActionRun } from '@/api/actions'
import RunDetail from './RunDetail'

interface Props {
  runs: ActionRun[]
  onRefresh: () => void
}

// 2026-04-25 unblock build: onRefresh 当前未在内部使用，但保留 Props 契约（父组件已传），仅不解构
export default function RunHistory({ runs }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [filterState, setFilterState] = useState<string>('')
  const [filterAction, setFilterAction] = useState<string>('')

  const filteredRuns = runs.filter((run) => {
    if (filterState && run.state !== filterState) return false
    if (filterAction && run.action_name !== filterAction) return false
    return true
  })

  // Collect unique action names
  const actionNames = Array.from(new Set(runs.map((r) => r.action_name)))
  const states = Array.from(new Set(runs.map((r) => r.state)))

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-illus">📋</div>
        <div className="empty-text">暂无执行历史</div>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
        <div>
          <label style={{ marginRight: '0.5rem' }}>操作类型:</label>
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="">全部</option>
            {actionNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ marginRight: '0.5rem' }}>状态:</label>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)}>
            <option value="">全部</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <table className="kc-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>操作</th>
            <th>发起人</th>
            <th>状态</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filteredRuns.map((run) => (
            <tr key={run.id}>
              <td>{run.action_name}</td>
              <td>{run.actor_id}</td>
              <td>{run.state}</td>
              <td>{new Date(run.created_at).toLocaleString()}</td>
              <td>
                <button
                  onClick={() => setSelectedRunId(run.id)}
                  style={{ cursor: 'pointer' }}
                >
                  查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedRunId && (
        <RunDetail
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  )
}
