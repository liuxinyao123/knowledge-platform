/**
 * ADR-45 · inline image prompt 单测
 *
 * 验证 isInlineImageInAnswerEnabled 的 env 解析；
 * docContext 拼接的 IMAGE: 行只在 (a) flag 开 + (b) chunk 是 image_caption + (c) image_id > 0
 * 三者全满足时出现。
 *
 * 不动 generateAnswer 的实际 chatStream 调用（mock 太重，且与本 ADR 关注点无关）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isInlineImageInAnswerEnabled } from '../services/ragPipeline.ts'

describe('isInlineImageInAnswerEnabled', () => {
  const ORIGINAL = process.env.INLINE_IMAGE_IN_ANSWER_ENABLED

  beforeEach(() => { delete process.env.INLINE_IMAGE_IN_ANSWER_ENABLED })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INLINE_IMAGE_IN_ANSWER_ENABLED
    else process.env.INLINE_IMAGE_IN_ANSWER_ENABLED = ORIGINAL
  })

  it('未设 env → 默认 on', () => {
    expect(isInlineImageInAnswerEnabled()).toBe(true)
  })

  it.each(['true', 'TRUE', '1', 'on', 'yes'])('显式 %s → on', (v) => {
    process.env.INLINE_IMAGE_IN_ANSWER_ENABLED = v
    expect(isInlineImageInAnswerEnabled()).toBe(true)
  })

  it.each(['false', '0', 'off', 'no'])('显式 %s → off', (v) => {
    process.env.INLINE_IMAGE_IN_ANSWER_ENABLED = v
    expect(isInlineImageInAnswerEnabled()).toBe(false)
  })

  it('与 CITATION_IMAGE_URL_ENABLED 完全独立', () => {
    process.env.CITATION_IMAGE_URL_ENABLED = 'false'
    process.env.INLINE_IMAGE_IN_ANSWER_ENABLED = 'true'
    expect(isInlineImageInAnswerEnabled()).toBe(true)
    delete process.env.CITATION_IMAGE_URL_ENABLED
  })
})
