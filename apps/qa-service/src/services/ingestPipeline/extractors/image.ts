/**
 * 单张图片直接上传：仅在 INGEST_VLM_ENABLED 时调 Qwen-VL 描述
 * 输出 1 个 image_caption chunk + 1 张 ExtractedImage（caption 已附）
 */
import path from 'node:path'
import { chatComplete, isLlmConfigured } from '../../llm.ts'
import type { Extractor, ExtractResult, ExtractedImage } from '../types.ts'

const SYS_PROMPT =
  '你是图像内容描述助手。给出图片关键信息，100 字内中文。'
const DEFAULT_MODEL = 'Qwen/Qwen2.5-VL-72B-Instruct'

function vlmEnabled(): boolean {
  const flag = process.env.INGEST_VLM_ENABLED?.trim().toLowerCase()
  return flag === 'true' || flag === '1'
}
function vlmModel(): string {
  return process.env.INGEST_VLM_MODEL?.trim() || DEFAULT_MODEL
}

export const imageExtractor: Extractor = {
  id: 'image',
  async extract(buffer, name) {
    const ext = path.extname(name).toLowerCase().replace('.', '') as 'png' | 'jpg' | 'jpeg'
    const safeExt: 'png' | 'jpg' | 'jpeg' = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png'
    const warnings: string[] = []
    let caption: string | null = null

    if (vlmEnabled() && isLlmConfigured()) {
      try {
        const dataUrl = `data:image/${safeExt === 'jpg' ? 'jpeg' : 'png'};base64,${buffer.toString('base64')}`
        const { content } = await chatComplete(
          [{
            role: 'user',
            content: [
              { type: 'text', text: '请描述这张图片的关键内容。' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          }],
          { model: vlmModel(), system: SYS_PROMPT, maxTokens: 200 },
        )
        caption = (content ?? '').trim() || null
      } catch (e) {
        warnings.push(`vlm failed: ${e instanceof Error ? e.message : 'unknown'}`)
      }
    }

    const image: ExtractedImage = {
      page: 1, index: 1, ext: safeExt, bytes: buffer, caption,
    }

    return {
      chunks: caption
        ? [{
          kind: 'image_caption' as const,
          text: caption,
          page: 1,
          imageRefIndex: { page: 1, index: 1 },
        }]
        : [{
          kind: 'paragraph' as const,
          text: `（图片 ${name}；未生成描述）`,
        }],
      images: [image],
      fullText: caption ?? '',
      warnings,
      extractorId: 'image',
    } as ExtractResult
  },
}
