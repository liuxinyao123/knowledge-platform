/**
 * asset-vector-coloc · Citation 图字段回填单测
 *
 * 验证 toCitation：
 *   - 普通 paragraph chunk → 不带 image_id / image_url（向后兼容 v1.x）
 *   - kind='image_caption' + image_id 非空 → 回填 image_id 与 image_url
 *   - env CITATION_IMAGE_URL_ENABLED=false → 不回填（关闭开关行为）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { toCitation } from '../services/ragPipeline.ts'
import type { AssetChunk } from '../services/knowledgeSearch.ts'

describe('toCitation — image_id / image_url 回填', () => {
  const ORIGINAL_ENV = process.env.CITATION_IMAGE_URL_ENABLED

  beforeEach(() => {
    delete process.env.CITATION_IMAGE_URL_ENABLED
  })
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.CITATION_IMAGE_URL_ENABLED
    else process.env.CITATION_IMAGE_URL_ENABLED = ORIGINAL_ENV
  })

  it('普通 paragraph chunk 不带 image 字段', () => {
    const doc: AssetChunk = {
      asset_id: 1,
      asset_name: 'A',
      chunk_content: 'plain text',
      score: 0.91,
      metadata: null,
      kind: 'paragraph',
      image_id: null,
    }
    const cite = toCitation(doc, 1)
    expect(cite.image_id).toBeUndefined()
    expect(cite.image_url).toBeUndefined()
    expect(cite.asset_id).toBe(1)
    expect(cite.score).toBe(0.91)
  })

  it("kind='image_caption' + image_id 非空 → 回填 image_id / image_url", () => {
    const doc: AssetChunk = {
      asset_id: 7,
      asset_name: 'liftgate.pdf',
      chunk_content: 'A detailed strut diagram',
      score: 0.88,
      metadata: null,
      kind: 'image_caption',
      image_id: 42,
    }
    const cite = toCitation(doc, 3)
    expect(cite.image_id).toBe(42)
    expect(cite.image_url).toBe('/api/assets/images/42')
  })

  it("kind='image_caption' 但 image_id 为 null → 不回填", () => {
    const doc: AssetChunk = {
      asset_id: 7,
      asset_name: 'foo.pdf',
      chunk_content: 'caption with no image_id link',
      score: 0.7,
      metadata: null,
      kind: 'image_caption',
      image_id: null,
    }
    const cite = toCitation(doc, 1)
    expect(cite.image_id).toBeUndefined()
    expect(cite.image_url).toBeUndefined()
  })

  it("kind='image_caption' 但 image_id 为 0 → 不回填（防御 0 等假值）", () => {
    const doc: AssetChunk = {
      asset_id: 8,
      asset_name: 'foo.pdf',
      chunk_content: 'edge case',
      score: 0.5,
      metadata: null,
      kind: 'image_caption',
      image_id: 0,
    }
    const cite = toCitation(doc, 1)
    expect(cite.image_id).toBeUndefined()
    expect(cite.image_url).toBeUndefined()
  })

  it('CITATION_IMAGE_URL_ENABLED=false → 不回填（即便其它条件满足）', () => {
    process.env.CITATION_IMAGE_URL_ENABLED = 'false'
    const doc: AssetChunk = {
      asset_id: 7,
      asset_name: 'liftgate.pdf',
      chunk_content: 'A detailed strut diagram',
      score: 0.88,
      metadata: null,
      kind: 'image_caption',
      image_id: 42,
    }
    const cite = toCitation(doc, 1)
    expect(cite.image_id).toBeUndefined()
    expect(cite.image_url).toBeUndefined()
  })

  it('CITATION_IMAGE_URL_ENABLED=0 / off / no 同样关闭', () => {
    for (const v of ['0', 'off', 'no']) {
      process.env.CITATION_IMAGE_URL_ENABLED = v
      const doc: AssetChunk = {
        asset_id: 9, asset_name: 'x', chunk_content: 'y', score: 0.6,
        metadata: null, kind: 'image_caption', image_id: 1,
      }
      const cite = toCitation(doc, 1)
      expect(cite.image_id, `flag=${v}`).toBeUndefined()
      expect(cite.image_url, `flag=${v}`).toBeUndefined()
    }
  })

  it('CITATION_IMAGE_URL_ENABLED 默认 (未设置) → 回填', () => {
    delete process.env.CITATION_IMAGE_URL_ENABLED
    const doc: AssetChunk = {
      asset_id: 7,
      asset_name: 'x',
      chunk_content: 'caption',
      score: 0.9,
      metadata: null,
      kind: 'image_caption',
      image_id: 99,
    }
    const cite = toCitation(doc, 1)
    expect(cite.image_url).toBe('/api/assets/images/99')
  })

  it('chunk_content 截断到 500 字符，与 image 字段独立工作', () => {
    const long = 'x'.repeat(800)
    const doc: AssetChunk = {
      asset_id: 1, asset_name: 'A', chunk_content: long, score: 0.5,
      metadata: null, kind: 'image_caption', image_id: 5,
    }
    const cite = toCitation(doc, 1)
    expect(cite.chunk_content.length).toBe(500)
    expect(cite.image_url).toBe('/api/assets/images/5')
  })
})
