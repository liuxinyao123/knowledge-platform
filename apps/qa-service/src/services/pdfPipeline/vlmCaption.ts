/**
 * pdfPipeline/vlmCaption.ts —— Qwen2.5-VL 视觉描述（opt-in）
 *
 * 行为：
 *   - 仅对 image-heavy 页（textChars < 300 OR imageCount >= 3）的图调用
 *   - 每图一次调用：text + image_url(base64) → caption
 *   - 失败不抛错：返回 null caption；warnings 记录原因
 */
import { chatComplete, isLlmConfigured } from '../llm.ts'
import type { PdfImage, PdfPageStats, PdfPipelineOpts } from './types.ts'

export const DEFAULT_VLM_MODEL = 'Qwen/Qwen2.5-VL-72B-Instruct'
export const IMAGE_HEAVY_DEFAULT_MIN_CHARS = 300
export const IMAGE_HEAVY_DEFAULT_MIN_IMAGES = 3

const SYS_PROMPT =
  '你是文档视觉助理。简要描述图片关键信息：标签、箭头方向、测量值、对比关系。100 字内，中文。'

export interface CaptionInput {
  images: PdfImage[]
  pageStats: PdfPageStats[]
  opts: PdfPipelineOpts
}

export interface CaptionItem {
  page: number
  index: number
  caption: string | null
  warning?: string
}

function vlmEnabled(opts: PdfPipelineOpts): boolean {
  if (typeof opts.vlmEnabled === 'boolean') return opts.vlmEnabled
  const flag = process.env.INGEST_VLM_ENABLED?.trim().toLowerCase()
  return flag === 'true' || flag === '1'
}

function vlmModel(opts: PdfPipelineOpts): string {
  return (opts.vlmModel ?? process.env.INGEST_VLM_MODEL ?? DEFAULT_VLM_MODEL).trim()
}

export function isImageHeavyPage(
  stats: PdfPageStats,
  opts: PdfPipelineOpts,
): boolean {
  const minChars = opts.imageHeavyMinChars ?? IMAGE_HEAVY_DEFAULT_MIN_CHARS
  const minImages = opts.imageHeavyMinImages ?? IMAGE_HEAVY_DEFAULT_MIN_IMAGES
  return stats.textChars < minChars || stats.imageCount >= minImages
}

export async function captionImages(input: CaptionInput): Promise<CaptionItem[]> {
  const { images, pageStats, opts } = input
  if (!vlmEnabled(opts)) {
    return images.map((i) => ({ page: i.page, index: i.index, caption: null }))
  }
  if (!isLlmConfigured()) {
    return images.map((i) => ({
      page: i.page, index: i.index, caption: null, warning: 'llm not configured',
    }))
  }

  const heavyPages = new Set(
    pageStats.filter((s) => isImageHeavyPage(s, opts)).map((s) => s.page),
  )
  const model = vlmModel(opts)

  // 并发池（默认 5）：把原来的串行 for await 改为受控并发
  const concurrency = Math.max(1, Math.min(20, Number(process.env.INGEST_VLM_CONCURRENCY) || 5))

  const captionOne = async (img: PdfImage): Promise<CaptionItem> => {
    if (!heavyPages.has(img.page)) {
      return { page: img.page, index: img.index, caption: null }
    }
    try {
      const dataUrl = `data:image/${img.ext === 'jpg' ? 'jpeg' : img.ext};base64,${img.bytes.toString('base64')}`
      const { content } = await chatComplete(
        [{
          role: 'user',
          content: [
            { type: 'text', text: `第 ${img.page} 页中的第 ${img.index} 张图。请描述其关键信息。` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        { model, system: SYS_PROMPT, maxTokens: 200 },
      )
      const caption = (content ?? '').trim()
      return {
        page: img.page, index: img.index,
        caption: caption || null,
        warning: caption ? undefined : 'vlm returned empty content',
      }
    } catch (err) {
      return {
        page: img.page, index: img.index, caption: null,
        warning: `vlm failed: ${err instanceof Error ? err.message : 'unknown'}`,
      }
    }
  }

  const out: CaptionItem[] = new Array(images.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, images.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= images.length) return
        out[i] = await captionOne(images[i])
      }
    }),
  )
  return out
}
