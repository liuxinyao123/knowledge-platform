/**
 * ZipImporter —— 旧 BookStack ZIP 导入路径（保留给书籍级批量）
 */
import { useEffect, useRef, useState } from 'react'
import { bsApi } from '@/api/bookstack'
import { useIngestPoller } from '@/hooks/useIngestPoller'
import type { BSBook } from '@/types/bookstack'

const STEPS = ['上传', '解析', 'OCR识别', '表格提取', '切分', '向量化/标签']

export default function ZipImporter() {
  const [books, setBooks] = useState<BSBook[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedBookId, setSelectedBookId] = useState<string>('')
  const [importId, setImportId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const poll = useIngestPoller(importId)

  useEffect(() => {
    bsApi.getBooks().then((r) => setBooks(r.data)).catch(() => {})
  }, [])

  async function handleUpload() {
    // BUG-13：空态明确提示；不再让按钮 disabled 吞掉反馈
    if (!selectedFile) { setErr('请先选择要上传的 ZIP 文件'); return }
    if (!selectedBookId) { setErr('请选择目标知识库'); return }
    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      setErr('仅支持 .zip 文件（书籍级批量）。单文件请切到"入库向导"Tab。')
      return
    }
    setUploading(true); setErr(null); setImportId(null)
    try {
      const fd = new FormData()
      fd.append('file', selectedFile)
      fd.append('type', 'book')
      fd.append('book_id', selectedBookId)
      const r = await bsApi.createImport(fd)
      setImportId(r.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const currentStep = poll?.currentStep ?? 0
  const status = poll?.status ?? null
  const failed = status === 'failed'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div className="surface-card">
        <div className="panel-head"><span className="panel-title">上传 ZIP</span></div>
        <div
          data-testid="zip-drop-zone"
          onClick={() => fileRef.current?.click()}
          style={{
            border: '2px dashed var(--border)', borderRadius: 8,
            padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
            background: 'var(--surface)', margin: '12px 0',
          }}
        >
          <input
            data-testid="zip-file-input"
            ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
          {selectedFile ? (
            <div style={{ color: 'var(--p)', fontWeight: 500 }}>{selectedFile.name}</div>
          ) : (
            <>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📦</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                点击选择 BookStack 导出的 ZIP（书籍级）
              </div>
            </>
          )}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>目标书籍</label>
          <select
            data-testid="zip-book-select"
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 6,
              fontSize: 14, background: '#fff',
            }}
          >
            <option value="">请选择知识库…</option>
            {books.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
        </div>
        <button
          data-testid="zip-upload-btn"
          className="btn btn-primary"
          disabled={uploading}
          onClick={() => void handleUpload()}
          style={{ width: '100%' }}
          title={!selectedFile ? '请先选择 ZIP 文件' : !selectedBookId ? '请选择目标知识库' : ''}
        >{uploading ? '上传中…' : '上传'}</button>
        {err && (
          <div style={{ marginTop: 10, padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>
            {err}
          </div>
        )}
      </div>

      <div className="surface-card">
        <div className="panel-head">
          <span className="panel-title">导入进度</span>
          {status && (
            <span className={`pill ${status === 'complete' ? 'pill-green' : status === 'failed' ? 'pill-red' : 'pill-amber'}`}>
              {status === 'complete' ? '完成' : status === 'failed' ? '失败' : status === 'running' ? '处理中' : '等待中'}
            </span>
          )}
        </div>

        {importId == null ? (
          <div className="empty-state">
            <div className="empty-illus">📭</div>
            <div className="empty-text">请在左侧上传 ZIP</div>
          </div>
        ) : (
          <div style={{ padding: '6px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: !failed && i < currentStep ? 'var(--green)' : !failed && i === currentStep ? 'var(--p)' : '#e5e7eb',
                      color: '#fff', fontSize: 12, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {!failed && i < currentStep ? '✓' : i + 1}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{s}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{
                      flex: 1, height: 2, margin: '0 4px', marginBottom: 16,
                      background: !failed && i < currentStep ? 'var(--green)' : '#e5e7eb',
                    }} />
                  )}
                </div>
              ))}
            </div>
            {failed && (
              <div style={{ marginTop: 14, padding: 10, background: '#FEF2F2', color: '#EF4444', fontSize: 13, borderRadius: 6 }}>
                入库失败，请检查 ZIP 格式后重试
              </div>
            )}
            {status === 'complete' && (
              <div style={{ marginTop: 14, padding: 10, background: '#f0fdf4', color: '#166534', fontSize: 13, borderRadius: 6 }}>
                ✓ 入库完成
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
