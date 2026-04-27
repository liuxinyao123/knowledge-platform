import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PdfImage, PdfPageStats } from '../services/pdfPipeline/types.ts'

const mockChatComplete = vi.fn()
vi.mock('../services/llm.ts', () => ({
  chatComplete: mockChatComplete,
  isLlmConfigured: vi.fn().mockReturnValue(true),
  getLlmFastModel: vi.fn(() => 'mock-fast'),
  getLlmModel: vi.fn(() => 'mock'),
}))

function img(page: number, index: number): PdfImage {
  return {
    page, index, ext: 'png', fileName: `${page}-${index}.png`,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  }
}

describe('captionImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.INGEST_VLM_ENABLED
    delete process.env.INGEST_VLM_MODEL
  })

  it('returns null captions when VLM disabled (no env)', async () => {
    const { captionImages } = await import('../services/pdfPipeline/vlmCaption.ts')
    const out = await captionImages({
      images: [img(1, 1), img(1, 2)],
      pageStats: [{ page: 1, textChars: 50, imageCount: 2 }],
      opts: {},
    })
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.caption === null)).toBe(true)
    expect(mockChatComplete).not.toHaveBeenCalled()
  })

  it('captions only image-heavy pages when VLM enabled', async () => {
    process.env.INGEST_VLM_ENABLED = 'true'
    mockChatComplete.mockResolvedValue({ content: 'a desc', toolCalls: [], rawMessage: { role: 'assistant', content: '' } })
    const { captionImages } = await import('../services/pdfPipeline/vlmCaption.ts')
    const stats: PdfPageStats[] = [
      { page: 1, textChars: 50, imageCount: 1 },     // image-heavy (chars < 300)
      { page: 2, textChars: 1000, imageCount: 1 },   // not image-heavy
    ]
    const out = await captionImages({
      images: [img(1, 1), img(2, 1)],
      pageStats: stats,
      opts: {},
    })
    expect(out.find((c) => c.page === 1)?.caption).toBe('a desc')
    expect(out.find((c) => c.page === 2)?.caption).toBeNull()
    expect(mockChatComplete).toHaveBeenCalledTimes(1)
  })

  it('falls back to null + warning when VLM throws', async () => {
    process.env.INGEST_VLM_ENABLED = 'true'
    mockChatComplete.mockRejectedValue(new Error('429 rate limit'))
    const { captionImages } = await import('../services/pdfPipeline/vlmCaption.ts')
    const out = await captionImages({
      images: [img(1, 1)],
      pageStats: [{ page: 1, textChars: 10, imageCount: 1 }],
      opts: {},
    })
    expect(out[0].caption).toBeNull()
    expect(out[0].warning).toMatch(/vlm failed.*429/)
  })

  it('respects opts.vlmEnabled override', async () => {
    process.env.INGEST_VLM_ENABLED = 'false'
    mockChatComplete.mockResolvedValue({ content: 'X', toolCalls: [], rawMessage: { role: 'assistant', content: '' } })
    const { captionImages } = await import('../services/pdfPipeline/vlmCaption.ts')
    const out = await captionImages({
      images: [img(1, 1)],
      pageStats: [{ page: 1, textChars: 10, imageCount: 1 }],
      opts: { vlmEnabled: true },
    })
    expect(out[0].caption).toBe('X')
  })

  it('respects opts.imageHeavyMinImages threshold', async () => {
    process.env.INGEST_VLM_ENABLED = 'true'
    mockChatComplete.mockResolvedValue({ content: 'd', toolCalls: [], rawMessage: { role: 'assistant', content: '' } })
    const { captionImages } = await import('../services/pdfPipeline/vlmCaption.ts')
    // textChars 充足 (1000) → 不靠 chars 触发；imageCount=2 < 默认阈值 3 → 不应触发
    const out = await captionImages({
      images: [img(1, 1)],
      pageStats: [{ page: 1, textChars: 1000, imageCount: 2 }],
      opts: { imageHeavyMinImages: 5 },     // 收紧阈值
    })
    expect(out[0].caption).toBeNull()
  })
})
