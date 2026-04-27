/**
 * Governance/Actions/PendingQueue.tsx
 *
 * List of pending approval action runs with Approve/Reject buttons.
 */

import { useState, useCallback } from 'react'
import { actionsApi, type ActionRun } from '@/api/actions'
import RunDetail from './RunDetail'

interface Props {
  runs: ActionRun[]
  onRefresh: () => void
}

export default function PendingQueue({ runs, onRefresh }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)

  const handleApprove = useCallback(
    async (runId: string) => {
      setProcessing(runId)
      try {
        await actionsApi.approveRun(runId, 'Approved via Governance UI')
        onRefresh()
      } finally {
        setProcessing(null)
      }
    },
    [onRefresh],
  )

  const handleReject = useCallback(
    async (runId: string) => {
      setProcessing(runId)
      try {
        await actionsApi.rejectRun(runId, 'Rejected via Governance UI')
        onRefresh()
      } finally {
        setProcessing(null)
      }
    },
    [onRefresh],
  )

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-illus">✓</div>
        <div className="empty-text">暂无待审批项目</div>
      </div>
    )
  }

  return (
    <div>
      <table className="kc-table" style={{ width: '100%', marginTop: '0.75rem' }}>
        <thead>
          <tr>
            <th>操作</th>
            <th>发起人</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.action_name}</td>
              <td>{run.actor_id}</td>
              <td>{run.state}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button
                  onClick={() => setSelectedRunId(run.id)}
                  style={{ marginRight: '0.5rem', cursor: 'pointer' }}
                  disabled={processing === run.id}
                >
                  查看
                </button>
                <button
                  onClick={() => handleApprove(run.id)}
                  disabled={processing === run.id}
                  style={{ marginRight: '0.5rem', cursor: 'pointer' }}
                >
                  批准
                </button>
                <button
                  onClick={() => handleReject(run.id)}
                  disabled={processing === run.id}
                  style={{ cursor: 'pointer', color: 'var(--error)' }}
                >
                  拒绝
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
