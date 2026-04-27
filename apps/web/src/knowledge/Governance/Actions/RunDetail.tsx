/**
 * Governance/Actions/RunDetail.tsx
 *
 * Drawer showing full run details and audit log.
 */

import { useState, useEffect } from 'react'
import { actionsApi, type ActionRun } from '@/api/actions'

interface Props {
  runId: string
  onClose: () => void
}

export default function RunDetail({ runId, onClose }: Props) {
  const [run, setRun] = useState<ActionRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await actionsApi.getRun(runId)
        setRun(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load run')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [runId])

  if (loading) {
    return (
      <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', marginTop: '1rem' }}>
        加载中…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', color: 'var(--error)', borderTop: '1px solid var(--border)', marginTop: '1rem' }}>
        {error}
        <button onClick={onClose} style={{ marginLeft: '1rem' }}>
          关闭
        </button>
      </div>
    )
  }

  if (!run) {
    return null
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3>运行详情: {run.action_name}</h3>
        <button onClick={onClose} style={{ cursor: 'pointer' }}>
          关闭
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <strong>ID:</strong>
          <p style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{run.id}</p>
        </div>
        <div>
          <strong>状态:</strong>
          <p>{run.state}</p>
        </div>
        <div>
          <strong>发起人:</strong>
          <p>{run.actor_id}</p>
        </div>
        <div>
          <strong>创建时间:</strong>
          <p>{new Date(run.created_at).toLocaleString()}</p>
        </div>
        {run.completed_at && (
          <div>
            <strong>完成时间:</strong>
            <p>{new Date(run.completed_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <strong>输入参数:</strong>
        <pre style={{ background: 'var(--highlight)', padding: '0.5rem', overflow: 'auto', fontSize: '0.75rem' }}>
          {JSON.stringify(run.args, null, 2)}
        </pre>
      </div>

      {run.result && (
        <div style={{ marginBottom: '1rem' }}>
          <strong>执行结果:</strong>
          <pre style={{ background: 'var(--highlight)', padding: '0.5rem', overflow: 'auto', fontSize: '0.75rem' }}>
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </div>
      )}

      {run.error && (
        <div style={{ marginBottom: '1rem', color: 'var(--error)' }}>
          <strong>错误信息:</strong>
          <pre style={{ background: 'var(--highlight)', padding: '0.5rem', overflow: 'auto', fontSize: '0.75rem' }}>
            {JSON.stringify(run.error, null, 2)}
          </pre>
        </div>
      )}

      <div>
        <strong>审计日志 (最近 5 条):</strong>
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          {!run.audit_log || run.audit_log.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>无审计记录</p>
          ) : (
            <table className="kc-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>事件</th>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {run.audit_log.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.event}</td>
                    <td>{new Date(entry.created_at).toLocaleString()}</td>
                    <td>{entry.actor_id}</td>
                    <td style={{ fontSize: '0.75rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.extra ? JSON.stringify(entry.extra) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
