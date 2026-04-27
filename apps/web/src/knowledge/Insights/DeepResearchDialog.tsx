/**
 * DeepResearchDialog —— 从洞察卡片触发 Deep Research 的可编辑对话框
 *
 * 流：
 *   1. 打开时自动调 POST /api/insights/topic 生成 topic + query_hint
 *   2. 用户可编辑主题与查询
 *   3. 提交 → POST /api/agent/dispatch { intent:'knowledge_qa', question, spaceId, assetIds }
 *      跳转到 /qa 页面（复用既有 SSE 流）
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { insightsApi, type DeepResearchTopicResponse } from '@/api/insights'

interface Props {
  spaceId: number
  insightKey: string
  initialSeedIds: number[]
  onClose: () => void
}

export default function DeepResearchDialog({
  spaceId,
  insightKey,
  initialSeedIds,
  onClose,
}: Props): ReactElement {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [queryHint, setQueryHint] = useState('')
  const [seedIds, setSeedIds] = useState<number[]>(initialSeedIds)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    insightsApi
      .topic(spaceId, insightKey)
      .then((data: DeepResearchTopicResponse) => {
        if (cancelled) return
        setTopic(data.topic)
        setQueryHint(data.query_hint)
        if (Array.isArray(data.seed_asset_ids) && data.seed_asset_ids.length > 0) {
          setSeedIds(data.seed_asset_ids)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [spaceId, insightKey])

  function handleSubmit() {
    if (!topic.trim()) {
      setErr('研究主题不能为空')
      return
    }
    // 跳转到 /qa，带主题 + scope。QA 页面会接过 query string 发给 agent/dispatch。
    const params = new URLSearchParams({
      q: topic,
      spaceId: String(spaceId),
    })
    if (seedIds.length > 0) {
      params.set('assetIds', seedIds.join(','))
    }
    if (queryHint.trim()) {
      params.set('hint', queryHint)
    }
    navigate(`/qa?${params.toString()}`)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'relative',
        zIndex: 100,
      }}
    >
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg, #fff)',
            borderRadius: 8,
            padding: '1.25rem 1.5rem',
            width: 520,
            maxWidth: '90vw',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          }}
        >
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 500 }}>
            Deep Research
          </h3>

          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '1rem 0' }}>
              正在生成研究主题…
            </div>
          ) : err ? (
            <div style={{ color: 'var(--danger, #a33)', fontSize: 13, padding: '0.5rem 0' }}>
              {err}
            </div>
          ) : (
            <>
              <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>
                研究主题
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  fontSize: 14,
                  padding: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  marginBottom: 12,
                  fontFamily: 'inherit',
                }}
              />

              <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>
                查询提示（可选）
              </label>
              <input
                type="text"
                value={queryHint}
                onChange={(e) => setQueryHint(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 14,
                  padding: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  marginBottom: 12,
                  fontFamily: 'inherit',
                }}
              />

              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                范围：Space #{spaceId} · {seedIds.length} 个种子资产
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 12px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !topic.trim()}
              style={{
                background: 'var(--color-text-primary, #111)',
                color: 'var(--bg, #fff)',
                border: 'none',
                borderRadius: 6,
                padding: '4px 14px',
                fontSize: 13,
                cursor: loading || !topic.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !topic.trim() ? 0.5 : 1,
              }}
            >
              开始研究
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
