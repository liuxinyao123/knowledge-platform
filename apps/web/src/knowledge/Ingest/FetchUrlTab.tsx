/**
 * FetchUrlTab —— 网页抓取 Tab
 * 输入 URL → POST /api/ingest/fetch-url → 后端抓 HTML → 喂 ingestPipeline
 */
import { useState } from 'react'
import { fetchUrl } from '@/api/ingest'
import { configToOptions, type IngestConfig } from './IngestConfigPanel'

interface Props {
  config: IngestConfig
  onSubmitted: () => void
}

export default function FetchUrlTab({ config, onSubmitted }: Props) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)

  async function submit() {
    // BUG-12：空态明确提示
    if (!url.trim()) {
      setError('请输入 URL'); return
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      setError('需要 http:// 或 https:// 开头的有效 URL'); return
    }
    setBusy(true); setError(null)
    try {
      const { jobId } = await fetchUrl(url.trim(), configToOptions(config))
      setLastJobId(jobId)
      setUrl('')
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="fetch-url-tab" style={{
      border: '2px dashed var(--border)', borderRadius: 12,
      padding: '36px 20px', background: '#fafafa',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        粘贴网页链接
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        后端会抓 HTML、清洗成纯文本、按当前配置入库
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="url"
          value={url}
          placeholder="https://example.com/article"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }}
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13, background: '#fff', color: 'var(--text)',
            outline: 'none', boxSizing: 'border-box',
          }}
          data-testid="fetch-url-input"
        />
        <button
          type="button"
          className="btn primary"
          data-testid="fetch-url-submit"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '提交中…' : '抓取并入库'}
        </button>
      </div>
      {error && (
        <div style={{
          marginTop: 12, padding: 10, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{error}</div>
      )}
      {lastJobId && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          已创建任务 {lastJobId.slice(0, 8)}…，下方队列实时跟踪
        </div>
      )}
    </div>
  )
}
