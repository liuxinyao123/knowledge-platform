import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { persistImages, updateImageCaption } from '../services/pdfPipeline/imageStore.ts'
import type { PdfImage } from '../services/pdfPipeline/types.ts'

let tmpRoot = ''

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'asset-img-'))
  process.env.ASSET_IMAGE_ROOT = tmpRoot
})
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  delete process.env.ASSET_IMAGE_ROOT
})

function makePoolMock() {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  return {
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params: params ?? [] })
        // 模拟 RETURNING id —— 按调用顺序自增
        return { rows: [{ id: calls.filter((c) => c.sql.includes('INSERT')).length }] }
      }),
    } as unknown as Parameters<typeof persistImages>[0],
    calls,
  }
}

function img(page: number, index: number, ext: 'png' | 'jpg' = 'png'): PdfImage {
  return {
    page, index, ext, fileName: `${page}-${index}.${ext}`,
    bytes: Buffer.from('fake'),
    bbox: [0, 0, 10, 10],
  }
}

describe('persistImages', () => {
  it('writes files to {root}/{assetId}/{page}-{index}.{ext} and inserts rows', async () => {
    const { pool, calls } = makePoolMock()
    const out = await persistImages(pool, 42, [img(1, 1), img(2, 1, 'jpg')])
    expect(out).toHaveLength(2)
    expect(out[0].filePath).toMatch(/42[\\/]1-1\.png$/)
    expect(out[1].filePath).toMatch(/42[\\/]2-1\.jpg$/)

    // 文件存在
    expect(statSync(path.join(tmpRoot, '42', '1-1.png')).isFile()).toBe(true)
    expect(statSync(path.join(tmpRoot, '42', '2-1.jpg')).isFile()).toBe(true)

    // SQL INSERT + ON CONFLICT
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO metadata_asset_image'))
    expect(inserts).toHaveLength(2)
    expect(inserts[0].sql).toContain('ON CONFLICT')
    expect(inserts[0].params[0]).toBe(42)
  })

  it('returns [] for empty input without DB calls', async () => {
    const { pool, calls } = makePoolMock()
    const out = await persistImages(pool, 1, [])
    expect(out).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('updateImageCaption', () => {
  it('issues UPDATE with id + caption', async () => {
    const { pool, calls } = makePoolMock()
    await updateImageCaption(pool, 7, '示意图：strut 朝下')
    const sql = calls[0]?.sql ?? ''
    expect(sql).toMatch(/UPDATE metadata_asset_image/)
    expect(calls[0].params).toEqual([7, '示意图：strut 朝下'])
  })
})
