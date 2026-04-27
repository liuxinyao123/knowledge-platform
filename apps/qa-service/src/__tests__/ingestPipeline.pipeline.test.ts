import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractResult } from '../services/ingestPipeline/types.ts'

let insertCalls: Array<{ sql: string; params: unknown[] }> = []
let nextAssetId = 1
let nextImageId = 100

vi.mock('../services/pgDb.ts', () => ({
  getPgPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      insertCalls.push({ sql, params: params ?? [] })
      if (/INSERT INTO metadata_asset\b/.test(sql)) {
        return { rows: [{ id: nextAssetId++ }] }
      }
      if (/INSERT INTO metadata_asset_image\b/.test(sql)) {
        return { rows: [{ id: nextImageId++ }] }
      }
      return { rows: [], rowCount: 1 }
    }),
  }),
}))

vi.mock('../services/embeddings.ts', () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => [i, i + 1, i + 2]),
  ),
  isEmbeddingConfigured: vi.fn(() => true),
}))

vi.mock('../services/tagExtract.ts', () => ({
  extractTags: vi.fn(async () => ['tag-a', 'tag-b']),
}))

// 把 persistImages / updateImageCaption stub 掉（不走真实 writeFile）
vi.mock('../services/pdfPipeline/index.ts', async (orig) => {
  const real = await orig<typeof import('../services/pdfPipeline/index.ts')>()
  return {
    ...real,
    persistImages: vi.fn(async (_pool: unknown, assetId: number, imgs: Array<{ page?: number; index: number }>) =>
      imgs.map((i) => ({
        imageId: 1000 + i.index,
        page: i.page ?? 1,
        index: i.index,
        filePath: `mock/${assetId}/${i.page}-${i.index}.png`,
      })),
    ),
    updateImageCaption: vi.fn(async () => {}),
  }
})

import { runPipeline } from '../services/ingestPipeline/pipeline.ts'
import type { IngestInput } from '../services/ingestPipeline/types.ts'

function makeInput(): IngestInput {
  return {
    buffer: Buffer.from('x'),
    name: 'demo.pdf',
    sourceId: 1,
  }
}

function makeExtract(): ExtractResult {
  return {
    extractorId: 'pdf',
    // pipeline.ts 的 200 字短路门：短文本不调 extractTags。
    // 测试目的是 E2E 验证 tags 返回链路，故用 200+ 字文本。
    fullText: 'some text. '.repeat(25),   // 275 chars
    warnings: ['x'],
    // rag-relevance-hygiene · C · MIN_CHUNK_CHARS=20：L3 chunk 文本 <20 字会被 isBadChunk 当 too_short 过滤。
    // 测试要验证"paragraph + table + image_caption" 三条都被 embed，故 text 都给足 20+ 字。
    chunks: [
      { kind: 'heading', text: 'Title', page: 1, headingLevel: 1, headingPath: 'Title' },
      { kind: 'paragraph', text: 'The first paragraph content describes the demo document body.', page: 1, bbox: [0, 0, 100, 50] },
      { kind: 'table', text: '| Column A | Column B | Column C | Row data one two three |', page: 2 },
      { kind: 'image_caption', text: 'A detailed strut diagram showing the suspension geometry in section view.', page: 2, imageRefIndex: { page: 2, index: 1 } },
    ],
    images: [
      { page: 2, index: 1, ext: 'png', bytes: Buffer.from('png'), caption: 'a strut diagram' },
    ],
  }
}

describe('runPipeline', () => {
  beforeEach(() => {
    insertCalls = []
    nextAssetId = 42
    nextImageId = 999
  })

  it('writes asset, metadata_field with new columns, embeds only embedKinds', async () => {
    const out = await runPipeline(makeInput(), makeExtract())

    expect(out.assetId).toBe(42)
    expect(out.extractorId).toBe('pdf')
    expect(out.chunks.l1).toBe(1)                   // heading
    expect(out.chunks.l3).toBe(3)                   // paragraph + table + image_caption
    expect(out.chunks.l2).toBe(0)
    expect(out.structuredChunks).toBe(4)
    expect(out.images.total).toBe(1)
    expect(out.images.withCaption).toBe(1)
    expect(out.tags).toEqual(['tag-a', 'tag-b'])

    const fieldInserts = insertCalls.filter((c) => /INSERT INTO metadata_field\b/.test(c.sql))
    expect(fieldInserts).toHaveLength(4)

    // 每行 params 形状：[assetId, i, level, content, embedding, tokenCount, page, kind, bbox, headingPath, imageId]
    expect(fieldInserts[0].params[7]).toBe('heading')           // kind
    expect(fieldInserts[0].params[4]).toBeNull()                // heading 不 embed
    expect(fieldInserts[0].params[10]).toBeNull()               // image_id

    expect(fieldInserts[1].params[7]).toBe('paragraph')
    expect(fieldInserts[1].params[4]).not.toBeNull()            // embed
    expect(fieldInserts[1].params[8]).toBe(JSON.stringify([0, 0, 100, 50]))

    expect(fieldInserts[3].params[7]).toBe('image_caption')
    expect(fieldInserts[3].params[4]).not.toBeNull()            // embed
    expect(fieldInserts[3].params[10]).toBe(1001)               // image_id 反查成功

    // tag update
    // pipeline.ts writes the SQL multi-line; match any whitespace between clauses
    expect(insertCalls.some((c) => /UPDATE metadata_asset\s+SET indexed_at/.test(c.sql))).toBe(true)
  })

  it('skipTags opt skips extractTags', async () => {
    const input = { ...makeInput(), opts: { skipTags: true } }
    const out = await runPipeline(input, makeExtract())
    expect(out.tags).toEqual([])
  })

  it('no warnings when extract returned none', async () => {
    const ex = makeExtract()
    ex.warnings = []
    const out = await runPipeline(makeInput(), ex)
    expect(out.warnings).toBeUndefined()
  })

  // ingest-async-pipeline · progress 回调
  it('invokes progress callback with parse → chunk → tag → done in order', async () => {
    const events: Array<{ phase: string; progress: number }> = []
    await runPipeline(makeInput(), makeExtract(), (ev) => {
      events.push({ phase: ev.phase, progress: ev.progress })
    })
    const phases = events.map((e) => e.phase)
    // 至少包含 parse → chunk → tag → done 四步（内部若扩展其它 phase 不影响顺序断言）
    expect(phases[0]).toBe('parse')
    expect(phases).toContain('chunk')
    expect(phases).toContain('tag')
    expect(phases[phases.length - 1]).toBe('done')
    // 单调递增（允许相等，但不能倒退）
    for (let i = 1; i < events.length; i++) {
      expect(events[i].progress).toBeGreaterThanOrEqual(events[i - 1].progress)
    }
    // 最后一步必须 100
    expect(events[events.length - 1].progress).toBe(100)
  })

  it('progress callback errors are swallowed (no cascade)', async () => {
    // 回调抛错不该让主 pipeline 失败
    const out = await runPipeline(makeInput(), makeExtract(), () => {
      throw new Error('boom')
    })
    expect(out.assetId).toBeGreaterThan(0)
    expect(out.chunks.l3).toBe(3)
  })

  it('runPipeline still works when progress is omitted (backward-compat)', async () => {
    // 不传第三个参数，结果结构与"旧 case"一致
    const out = await runPipeline(makeInput(), makeExtract())
    expect(out.assetId).toBeGreaterThan(0)
    expect(out.chunks).toEqual({ l1: 1, l2: 0, l3: 3 })
    expect(out.images).toEqual({ total: 1, withCaption: 1 })
    expect(out.tags).toEqual(['tag-a', 'tag-b'])
  })
})
