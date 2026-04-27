# Ingest Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dual-path document ingestion: single file (.md/.html/.txt) via `createPage`, ZIP via `createImport` + polling, with success/failure result states.

**Architecture:** The existing `Ingest/index.tsx` already has drag-drop, book selector, step bar, and `useIngestPoller`. We extend `handleUpload` to branch on file extension — ZIP keeps the existing `createImport` path; single files use `FileReader` to read content then call `bsApi.createPage`. A new `ResultPanel` component handles success (2 buttons) and failure (retry) states, replacing the progress panel after completion.

**Tech Stack:** React, TypeScript, bsApi (bookstack.ts), useIngestPoller (existing), FileReader API

---

### Task 1: Single-file upload — failing test first

**Files:**
- Modify: `src/knowledge/Ingest/index.test.tsx`

- [ ] **Step 1: Write failing test — single file calls createPage**

Add to `src/knowledge/Ingest/index.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as bsApiModule from '@/api/bookstack'
import Ingest from './index'

vi.mock('@/api/bookstack', () => ({
  bsApi: {
    getBooks: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'Test Book' }], total: 1 }),
    createPage: vi.fn(),
    createImport: vi.fn(),
    pollImport: vi.fn(),
  },
}))

const mock = bsApiModule.bsApi as unknown as {
  getBooks: ReturnType<typeof vi.fn>
  createPage: ReturnType<typeof vi.fn>
  createImport: ReturnType<typeof vi.fn>
  pollImport: ReturnType<typeof vi.fn>
}

function renderIngest() {
  return render(<MemoryRouter><Ingest /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('Ingest — single file (.md) calls createPage', () => {
  it('calls bsApi.createPage with book_id, filename, and file content', async () => {
    mock.createPage.mockResolvedValue({ id: 99, name: 'notes.md' })
    renderIngest()

    // Select book
    const select = await screen.findByTestId('book-select')
    fireEvent.change(select, { target: { value: '1' } })

    // Drop a .md file
    const file = new File(['# Hello'], 'notes.md', { type: 'text/markdown' })
    const dropZone = screen.getByTestId('drop-zone')
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file] },
    })

    // Click upload
    const uploadBtn = await screen.findByTestId('upload-btn')
    fireEvent.click(uploadBtn)

    await waitFor(() => expect(mock.createPage).toHaveBeenCalledWith({
      book_id: 1,
      name: 'notes.md',
      markdown: '# Hello',
    }))
    expect(mock.createImport).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to confirm RED**

```bash
cd apps/web && npx vitest run src/knowledge/Ingest/index.test.tsx 2>&1 | tail -15
```

Expected: FAIL — `createPage` not called (current code calls `createImport` for all files).

---

### Task 2: ZIP still calls createImport — failing test

**Files:**
- Modify: `src/knowledge/Ingest/index.test.tsx`

- [ ] **Step 1: Write failing test — ZIP calls createImport not createPage**

Append to test file:

```tsx
describe('Ingest — ZIP file calls createImport', () => {
  it('calls bsApi.createImport and NOT createPage for .zip files', async () => {
    mock.createImport.mockResolvedValue({ id: 42, status: 'pending', name: 'archive.zip', type: 'book' })
    renderIngest()

    const select = await screen.findByTestId('book-select')
    fireEvent.change(select, { target: { value: '1' } })

    const file = new File(['PK...'], 'archive.zip', { type: 'application/zip' })
    const dropZone = screen.getByTestId('drop-zone')
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })

    fireEvent.click(await screen.findByTestId('upload-btn'))

    await waitFor(() => expect(mock.createImport).toHaveBeenCalled())
    expect(mock.createPage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to confirm RED**

```bash
npx vitest run src/knowledge/Ingest/index.test.tsx 2>&1 | tail -15
```

Expected: this test may pass (existing code already calls createImport) — that's fine, keep it as regression guard.

---

### Task 3: Success result state — failing test

**Files:**
- Modify: `src/knowledge/Ingest/index.test.tsx`

- [ ] **Step 1: Write failing tests for success result panel**

Append:

```tsx
describe('Ingest — success result panel', () => {
  it('shows success result with 继续上传 and 跳转空间管理 after createPage succeeds', async () => {
    mock.createPage.mockResolvedValue({ id: 99, name: 'notes.md' })
    renderIngest()

    const select = await screen.findByTestId('book-select')
    fireEvent.change(select, { target: { value: '1' } })

    const file = new File(['# Hello'], 'notes.md', { type: 'text/markdown' })
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file] } })
    fireEvent.click(await screen.findByTestId('upload-btn'))

    expect(await screen.findByTestId('result-success')).toBeInTheDocument()
    expect(screen.getByTestId('btn-continue')).toBeInTheDocument()
    expect(screen.getByTestId('btn-goto-spaces')).toBeInTheDocument()
  })

  it('clicking 继续上传 resets the form', async () => {
    mock.createPage.mockResolvedValue({ id: 99, name: 'notes.md' })
    renderIngest()

    fireEvent.change(await screen.findByTestId('book-select'), { target: { value: '1' } })
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [new File(['#'], 'a.md', { type: 'text/markdown' })] },
    })
    fireEvent.click(await screen.findByTestId('upload-btn'))
    await screen.findByTestId('result-success')

    fireEvent.click(screen.getByTestId('btn-continue'))

    // Form should be reset — drop zone visible again
    expect(await screen.findByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('result-success')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
npx vitest run src/knowledge/Ingest/index.test.tsx 2>&1 | tail -15
```

Expected: FAIL — `result-success`, `btn-continue`, `btn-goto-spaces` not found.

---

### Task 4: Failure + retry — failing test

**Files:**
- Modify: `src/knowledge/Ingest/index.test.tsx`

- [ ] **Step 1: Write failing tests for failure state**

Append:

```tsx
describe('Ingest — failure result panel', () => {
  it('shows failure result with retry button when createPage throws', async () => {
    mock.createPage.mockRejectedValue(new Error('Server Error'))
    renderIngest()

    fireEvent.change(await screen.findByTestId('book-select'), { target: { value: '1' } })
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [new File(['#'], 'a.md', {})] },
    })
    fireEvent.click(await screen.findByTestId('upload-btn'))

    expect(await screen.findByTestId('result-failure')).toBeInTheDocument()
    expect(screen.getByTestId('btn-retry')).toBeInTheDocument()
  })

  it('clicking retry restores the form with the same file selected', async () => {
    mock.createPage.mockRejectedValue(new Error('fail'))
    renderIngest()

    fireEvent.change(await screen.findByTestId('book-select'), { target: { value: '1' } })
    const file = new File(['#'], 'retry.md', {})
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file] } })
    fireEvent.click(await screen.findByTestId('upload-btn'))
    await screen.findByTestId('result-failure')

    fireEvent.click(screen.getByTestId('btn-retry'))

    // Form restored — drop zone and upload button visible
    expect(await screen.findByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.getByTestId('upload-btn')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
npx vitest run src/knowledge/Ingest/index.test.tsx 2>&1 | tail -15
```

Expected: FAIL.

---

### Task 5: Implement — update Ingest/index.tsx

**Files:**
- Modify: `src/knowledge/Ingest/index.tsx`

- [ ] **Step 1: Add upload mode state and result state**

Add to state declarations (after existing state):

```tsx
type UploadResult = { ok: true } | { ok: false; error: string } | null
const [uploadResult, setUploadResult] = useState<UploadResult>(null)
```

- [ ] **Step 2: Replace handleUpload with branching logic**

```tsx
const handleUpload = async () => {
  if (!selectedFile || !selectedBookId) return
  setUploading(true)
  setUploadResult(null)

  const isZip = selectedFile.name.toLowerCase().endsWith('.zip')

  try {
    if (isZip) {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('type', 'book')
      const result = await bsApi.createImport(formData)
      setImportId(result.id)
      // polling handles completion; don't set uploadResult here
    } else {
      const content = await readFileAsText(selectedFile)
      await bsApi.createPage({
        book_id: Number(selectedBookId),
        name: selectedFile.name,
        markdown: content,
      })
      setUploadResult({ ok: true })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败，请重试'
    setUploadResult({ ok: false, error: message })
  } finally {
    setUploading(false)
  }
}
```

Add helper above component:

```tsx
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
```

- [ ] **Step 3: Add reset function**

```tsx
function handleReset() {
  setSelectedFile(null)
  setSelectedBookId('')
  setImportId(null)
  setUploadResult(null)
  setUploading(false)
}
```

- [ ] **Step 4: Add ResultPanel in JSX, replacing progress panel when uploadResult is set**

In the right card (`surface-card` progress panel), add before the existing empty/progress render:

```tsx
{uploadResult !== null ? (
  uploadResult.ok ? (
    <div className="empty-state" data-testid="result-success">
      <div className="empty-illus">✅</div>
      <div className="empty-text">文档已成功入库</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" data-testid="btn-continue" onClick={handleReset}>
          继续上传
        </button>
        <a
          href="/spaces"
          className="btn btn-primary"
          data-testid="btn-goto-spaces"
        >
          前往空间管理 »
        </a>
      </div>
    </div>
  ) : (
    <div className="empty-state" data-testid="result-failure">
      <div className="empty-illus">❌</div>
      <div className="empty-text">{(uploadResult as { ok: false; error: string }).error}</div>
      <button className="btn btn-primary" data-testid="btn-retry" onClick={handleReset}>
        重试
      </button>
    </div>
  )
) : /* existing empty/progress JSX */ }
```

Also watch `pollerResult` for ZIP completion — add `useEffect`:

```tsx
useEffect(() => {
  if (pollerResult?.status === 'complete') setUploadResult({ ok: true })
  if (pollerResult?.status === 'failed') setUploadResult({ ok: false, error: '入库失败，请检查 ZIP 格式后重试' })
}, [pollerResult?.status])
```

---

### Task 6: Run all tests GREEN

- [ ] **Step 1: Run target test file**

```bash
npx vitest run src/knowledge/Ingest/index.test.tsx 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 2: Run full suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: 0 failures.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output (0 errors).
