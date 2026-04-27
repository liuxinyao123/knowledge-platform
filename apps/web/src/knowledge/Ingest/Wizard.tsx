/**
 * Wizard —— 多文件队列 + 解析预览 + 元数据 + 提交
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { bsApi } from '@/api/bookstack'
import { registerBookstackPageForAssets } from '@/api/assetDirectory'
import {
  extractIngestText, isExtractError, isExtractText, isExtractAttachment,
} from '@/api/ingest'
import type { BSBook } from '@/types/bookstack'
import FileQueue from './FileQueue'
import PreviewPane from './PreviewPane'
import MetaForm from './MetaForm'
import RecentImports from './RecentImports'

// ──────────────── 类型 ────────────────

export type RowPhase =
  | 'pending' | 'parsing' | 'parsed' | 'uploading' | 'done' | 'failed'

export interface Row {
  id: string
  file: File
  phase: RowPhase
  extract?:
    | { kind: 'text'; text: string; summary?: string }
    | { kind: 'attachment'; hint: string }
  tags: string[]
  category: string
  overrideSummary?: string
  error?: string
  assetId?: number
  pageId?: number
}

const CATEGORIES = ['规章', '合同', '技术', '报表', '其它']
const STEPS = ['选择', '预览', '元数据', '提交']

function makeId(file: File): string {
  return `${Date.now().toString(36)}-${file.name.slice(0, 8)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ──────────────── 容器 ────────────────

export default function Wizard() {
  const [rows, setRows] = useState<Row[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [books, setBooks] = useState<BSBook[]>([])
  const [bookId, setBookId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [refreshRecent, setRefreshRecent] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bsApi.getBooks().then((r) => setBooks(r.data)).catch(() => {})
  }, [])

  const selected = rows.find((r) => r.id === selectedId) ?? null

  // ── 队列操作 ──
  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const news = arr.map<Row>((f) => ({
      id: makeId(f),
      file: f,
      phase: 'pending',
      tags: [],
      category: '其它',
    }))
    setRows((prev) => {
      const next = [...prev, ...news]
      if (!selectedId && next.length > 0) setSelectedId(next[0].id)
      return next
    })
  }, [selectedId])

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    if (selectedId === id) setSelectedId(null)
  }
  const clearAll = () => { setRows([]); setSelectedId(null) }

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  // ── 解析单行 ──
  async function parseOne(row: Row) {
    updateRow(row.id, { phase: 'parsing', error: undefined })
    try {
      const r = await extractIngestText(row.file)
      if (isExtractError(r)) throw new Error(r.error)
      if (isExtractText(r)) {
        updateRow(row.id, {
          phase: 'parsed',
          extract: { kind: 'text', text: r.text, summary: r.summary },
        })
      } else if (isExtractAttachment(r)) {
        updateRow(row.id, {
          phase: 'parsed',
          extract: { kind: 'attachment', hint: r.hint },
        })
      } else {
        throw new Error('unknown extract result')
      }
    } catch (e) {
      updateRow(row.id, { phase: 'failed', error: (e as Error).message })
    }
  }

  async function parseAll() {
    setBusy(true)
    const pending = rows.filter((r) => r.phase === 'pending' || r.phase === 'failed')
    // 使用 latest state，每次拿一行
    for (const row of pending) {
      await parseOne(row)
    }
    setBusy(false)
  }

  // ── 提交单行 ──
  async function commitOne(row: Row): Promise<void> {
    if (row.phase !== 'parsed' || !row.extract) return
    if (!bookId) throw new Error('请先选择知识库')
    updateRow(row.id, { phase: 'uploading', error: undefined })
    try {
      const bookIdNum = Number(bookId)
      const tagsLine = row.tags.length ? `\nTags: ${row.tags.join(', ')}` : ''
      const catLine = `\n分类: ${row.category}`

      if (row.extract.kind === 'attachment') {
        const page = await bsApi.createPage({
          book_id: bookIdNum,
          name: row.file.name,
          markdown: `# ${row.file.name}\n\n${row.extract.hint}${tagsLine}${catLine}\n`,
        })
        const fd = new FormData()
        fd.append('name', row.file.name)
        fd.append('uploaded_to', String(page.id))
        fd.append('file', row.file)
        await bsApi.uploadAttachment(fd)
        try { await registerBookstackPageForAssets(page.id) } catch { /* best effort */ }
        updateRow(row.id, { phase: 'done', pageId: page.id })
      } else {
        const summaryOverride = row.overrideSummary?.trim()
        const summary = summaryOverride || row.extract.summary
        const body = row.extract.text + tagsLine + catLine
        const page = await bsApi.createPage({
          book_id: bookIdNum,
          name: row.file.name,
          markdown: body,
        })
        try { await registerBookstackPageForAssets(page.id, summary) } catch { /* best effort */ }
        updateRow(row.id, { phase: 'done', pageId: page.id })
      }
    } catch (e) {
      updateRow(row.id, { phase: 'failed', error: (e as Error).message })
    }
  }

  async function commitAll() {
    if (!bookId) { alert('请先选择知识库'); return }
    setBusy(true)
    const ready = rows.filter((r) => r.phase === 'parsed')
    for (const row of ready) {
      await commitOne(row)
    }
    setBusy(false)
    setRefreshRecent((n) => n + 1)
  }

  // ── 步骤判定 ──
  const step = (() => {
    if (rows.length === 0) return 1
    if (rows.every((r) => r.phase === 'pending')) return 1
    if (rows.some((r) => r.phase === 'parsed') && !rows.some((r) => r.phase === 'done')) return 3
    if (rows.some((r) => r.phase === 'done')) return 4
    return 2
  })()

  return (
    <div data-testid="wizard-root">
      {/* 步骤指示 */}
      <div data-testid="wizard-step-indicator" style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        {STEPS.map((s, i) => {
          const active = step === i + 1
          const done = step > i + 1
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: done ? 'var(--green)' : active ? 'var(--p)' : '#e5e7eb',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {done ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 11, marginTop: 4, color: active ? 'var(--p)' : 'var(--muted)', fontWeight: active ? 700 : 400 }}>
                  {s}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, margin: '0 8px', marginBottom: 16,
                  background: done ? 'var(--green)' : '#e5e7eb',
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* 三栏 */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 320px', gap: 14 }}>
        <FileQueue
          rows={rows}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRemove={removeRow}
          onAdd={() => fileInput.current?.click()}
          onRetry={(r) => void parseOne(r)}
        />
        <input
          ref={fileInput}
          data-testid="wizard-file-input"
          type="file"
          multiple
          accept=".md,.html,.htm,.txt,.csv,.zip,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.rtf,.odt,.odp,.ods,.dxf,.dwg,.cad,.step,.stp,.iges,.igs,.stl,.sat,.3dm"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files) }}
        />

        <PreviewPane row={selected} />

        <MetaForm
          row={selected}
          categories={CATEGORIES}
          onApply={(patch) => selected && updateRow(selected.id, patch)}
        />
      </div>

      {/* 底部控制 */}
      <div style={{
        marginTop: 16, padding: 14,
        background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>知识库</label>
        <select
          data-testid="wizard-book-select"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 200 }}
        >
          <option value="">请选择…</option>
          {books.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {rows.length} 文件 · 待解析 {rows.filter((r) => r.phase === 'pending').length} · 待提交 {rows.filter((r) => r.phase === 'parsed').length} · 成功 {rows.filter((r) => r.phase === 'done').length} · 失败 {rows.filter((r) => r.phase === 'failed').length}
        </span>
        <button data-testid="btn-parse-all" className="btn" disabled={busy || rows.length === 0} onClick={() => void parseAll()}>
          {busy ? '处理中…' : '解析全部'}
        </button>
        <button
          data-testid="btn-commit-all"
          className="btn btn-primary"
          disabled={busy || !bookId || !rows.some((r) => r.phase === 'parsed')}
          onClick={() => void commitAll()}
        >
          提交全部 →
        </button>
        <button data-testid="btn-clear" className="btn" disabled={busy || rows.length === 0} onClick={clearAll}>清空</button>
      </div>

      {/* Recent Imports */}
      <RecentImports refreshKey={refreshRecent} />
    </div>
  )
}
