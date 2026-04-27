/**
 * index.test.tsx —— PRD §7 入库页 4-Tab 重写后的烟雾测试
 *
 * 旧 Wizard / ZIP 双 Tab 测试被 G6 升级为 4 Tab：
 *   文件上传 / 网页抓取 / 对话沉淀 / 批量任务
 *
 * 这个文件只覆盖最低限度：
 *   1. 4 个 Tab 都能渲染
 *   2. 切 Tab 后看到对应子组件
 *   3. 入库配置面板存在且可改
 *
 * 完整 e2e（提交 → JobQueue 轮询 → 详情页）由 scripts/verify-permissions 同级的
 * scripts/verify-ingest.mjs（待加）覆盖。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Ingest from './index'

vi.mock('@/api/bookstack', () => ({
  bsApi: {
    getBooks:        vi.fn().mockResolvedValue({ data: [{ id: 1, name: '知识中台' }], total: 1 }),
    createImport:    vi.fn(),
    createPage:      vi.fn(),
    pollImport:      vi.fn(),
    uploadAttachment: vi.fn(),
  },
}))

vi.mock('@/api/ingest', () => ({
  uploadFull:          vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  fetchUrl:            vi.fn().mockResolvedValue({ jobId: 'job-2' }),
  ingestConversation:  vi.fn().mockResolvedValue({ jobId: 'job-3' }),
  listJobs:            vi.fn().mockResolvedValue([]),
  getJob:              vi.fn(),
  pauseJob:            vi.fn(),
  retryJob:            vi.fn(),
  // ingest-async-pipeline Phase E：PreprocessingModule 升级为 SSE + 轮询双保险后引用
  streamJob:           vi.fn(() => () => { /* noop unsubscribe */ }),
  // 旧测试残留接口；保留 mock 防其它组件引用
  extractIngestText:   vi.fn(),
  isExtractError:      () => false,
  isExtractText:       () => true,
  isExtractAttachment: () => false,
  registerIndexedPage: vi.fn(),
  getRecentImports:    vi.fn().mockResolvedValue([]),
}))

vi.mock('@/api/assetDirectory', () => ({
  registerBookstackPageForAssets: vi.fn(),
  // OQ-WEB-TEST-DEBT (2026-04-25)：IngestConfigPanel mount 时拉 PG sources 列表
  listPgSources: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/api/spaces', () => ({
  // OQ-WEB-TEST-DEBT (2026-04-25)：IngestConfigPanel mount 时拉空间列表 + 空间-source 映射
  listSpaces: vi.fn().mockResolvedValue([]),
  listSpaceSources: vi.fn().mockResolvedValue([]),
}))

function renderIngest() {
  return render(
    <MemoryRouter>
      <Ingest />
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.clearAllMocks() })

describe('Ingest page · 4-Tab 结构', () => {
  it('默认渲染 4 个 sub-tab + 入库配置 + 任务队列', async () => {
    renderIngest()
    expect(await screen.findByTestId('tab-upload')).toBeInTheDocument()
    expect(screen.getByTestId('tab-fetch-url')).toBeInTheDocument()
    expect(screen.getByTestId('tab-conversation')).toBeInTheDocument()
    expect(screen.getByTestId('tab-batch')).toBeInTheDocument()
    expect(screen.getByTestId('ingest-config')).toBeInTheDocument()
    // 默认 active = upload
    expect(screen.getByTestId('upload-tab')).toBeInTheDocument()
  })

  it('切到 网页抓取 Tab 显示 URL 输入', async () => {
    renderIngest()
    fireEvent.click(await screen.findByTestId('tab-fetch-url'))
    expect(screen.getByTestId('fetch-url-input')).toBeInTheDocument()
    expect(screen.getByTestId('fetch-url-submit')).toBeInTheDocument()
  })

  it('切到 对话沉淀 Tab 显示标题 + 文本框', async () => {
    renderIngest()
    fireEvent.click(await screen.findByTestId('tab-conversation'))
    expect(screen.getByTestId('conv-title')).toBeInTheDocument()
    expect(screen.getByTestId('conv-text')).toBeInTheDocument()
  })

  it('入库配置：策略 pill 可切换，向量化 toggle 可点', async () => {
    renderIngest()
    const fixedPill = await screen.findByTestId('cfg-strategy-fixed')
    fireEvent.click(fixedPill)
    await waitFor(() => expect(fixedPill.className).toContain('active'))

    const toggle = screen.getByTestId('cfg-vectorize')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  })
})
