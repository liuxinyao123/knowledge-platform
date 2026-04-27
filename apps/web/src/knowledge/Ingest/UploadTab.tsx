/**
 * UploadTab —— 文件上传 Tab：drop zone + 文件选择 + 直接调 /api/ingest/upload-full
 */
import { useRef, useState, type DragEvent } from 'react'
import { uploadFull } from '@/api/ingest'
import { configToOptions, type IngestConfig } from './IngestConfigPanel'

interface Props {
  config: IngestConfig
  onSubmitted: () => void   // 通知父级刷新 JobQueue
}

const ACCEPT = '.md,.html,.htm,.txt,.csv,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg'

export default function UploadTab({ config, onSubmitted }: Props) {
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState(false)
  const [recentJobIds, setRecentJobIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFiles(files: FileList | File[]) {
    setBusy(true); setError(null)
    const arr = Array.from(files)
    const ids: string[] = []
    try {
      for (const f of arr) {
        const { jobId } = await uploadFull(f, configToOptions(config))
        ids.push(jobId)
      }
      setRecentJobIds((prev) => [...ids, ...prev].slice(0, 5))
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setHover(false)
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files)
  }

  return (
    <div data-testid="upload-tab">
      <div
        onDragOver={(e) => { e.preventDefault(); setHover(true) }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${hover ? 'var(--p, #6C47FF)' : 'var(--border)'}`,
          borderRadius: 12, padding: '36px 20px',
          background: hover ? 'rgba(108,71,255,0.04)' : '#fafafa',
          textAlign: 'left', transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          拖拽文件到这里
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          支持：PDF / DOCX / Markdown / 图片（OCR）/ 网页链接
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn"
            data-testid="upload-pick"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '上传中…' : '选择文件'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: 10, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{error}</div>
      )}

      {recentJobIds.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          已提交 {recentJobIds.length} 个任务，下方队列将实时刷新
        </div>
      )}
    </div>
  )
}
