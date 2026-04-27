/**
 * DismissButton —— 乐观更新关闭洞察；失败回滚 + toast
 */
import { useState, type ReactElement } from 'react'
import { insightsApi } from '@/api/insights'

interface Props {
  spaceId: number
  insightKey: string
  onDismissed: () => void
  onError?: (msg: string) => void
}

export default function DismissButton({
  spaceId,
  insightKey,
  onDismissed,
  onError,
}: Props): ReactElement {
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (pending) return
    setPending(true)
    onDismissed() // 乐观更新
    try {
      await insightsApi.dismiss(spaceId, insightKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 失败回滚由 onError 调用方处理
      if (onError) onError(`关闭失败：${msg}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 11,
        cursor: pending ? 'wait' : 'pointer',
        color: 'var(--muted)',
      }}
      title="不再提醒"
    >
      不再提醒
    </button>
  )
}
