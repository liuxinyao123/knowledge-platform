import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseOdlJson } from '../services/pdfPipeline/odlParse.ts'

/** fixture：真实 ODL JSON 片段简化版（字段名与 1.11.x 实测一致） */
function realishJson() {
  return {
    'file name': 'demo.pdf',
    'number of pages': 3,
    kids: [
      {
        type: 'heading',
        id: 1,
        'page number': 1,
        'bounding box': [10, 10, 200, 30],
        'heading level': 2,
        content: 'Best Practice LFTGATE – 27 Liftgate Bumper Integration',
      },
      {
        type: 'image',
        id: 2,
        'page number': 1,
        'bounding box': [326.04, 142.7, 585.52, 448.48],
        source: 'images/imageFile1.png',
      },
      {
        type: 'paragraph',
        id: 3,
        'page number': 1,
        content: 'Why: The objective of this Best Practice is to provide guidance.',
      },
      {
        type: 'paragraph',
        id: 4,
        'page number': 1,
        content: 'GM Confidential 1',            // 应被过滤
      },
      {
        type: 'list',
        id: 5,
        'page number': 2,
        'list items': [
          {
            type: 'list item',
            'page number': 2,
            content: '1.0 Purpose of and Location of Bumpers',
            kids: [
              {
                type: 'list',
                'page number': 2,
                'list items': [
                  {
                    type: 'list item',
                    'page number': 2,
                    content: '1.1 Lower Corner Fixed Bumpers',
                  },
                  {
                    type: 'list item',
                    'page number': 2,
                    content: '1.2 Adjustable Beltline Bumpers',
                  },
                ],
              },
            ],
          },
          {
            type: 'list item',
            'page number': 2,
            content: '2.0 Fixed Over Slam Bumpers',
          },
        ],
      },
    ],
  }
}

function fixtureWithImage(): { dir: string; cleanup: () => void; imageFile: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'odl-fixture-'))
  const imageFile = path.join(dir, 'imageFile1.png')
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
  writeFileSync(imageFile, pngBytes)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), imageFile }
}

describe('parseOdlJson — real schema', () => {
  it('maps heading / paragraph from flat kids', async () => {
    const out = await parseOdlJson({ json: realishJson(), imageFiles: [] })
    const heading = out.chunks.find((c) => c.kind === 'heading')!
    expect(heading.text).toMatch(/Bumper Integration/)
    expect(heading.headingLevel).toBe(2)
    expect(heading.page).toBe(1)

    const para = out.chunks.find((c) => c.kind === 'paragraph' && c.text.startsWith('Why'))
    expect(para).toBeTruthy()
  })

  it('filters "GM Confidential 1" even with page number suffix', async () => {
    const out = await parseOdlJson({ json: realishJson(), imageFiles: [] })
    expect(out.chunks.every((c) => !/GM Confidential/.test(c.text))).toBe(true)
  })

  it('flattens nested list items with indent prefix', async () => {
    const out = await parseOdlJson({ json: realishJson(), imageFiles: [] })
    const listItems = out.chunks.filter((c) => c.page === 2 && c.kind === 'paragraph')
    const texts = listItems.map((c) => c.text)
    expect(texts).toContain('- 1.0 Purpose of and Location of Bumpers')
    expect(texts).toContain('  - 1.1 Lower Corner Fixed Bumpers')           // 缩进两空格
    expect(texts).toContain('  - 1.2 Adjustable Beltline Bumpers')
    expect(texts).toContain('- 2.0 Fixed Over Slam Bumpers')
  })

  it('image element → PdfImage with basename-matched file', async () => {
    const fx = fixtureWithImage()
    try {
      const out = await parseOdlJson({
        json: realishJson(),
        imageFiles: [{ fileName: 'imageFile1.png', absPath: fx.imageFile, ext: 'png' }],
      })
      expect(out.images).toHaveLength(1)
      const img = out.images[0]
      expect(img.page).toBe(1)
      expect(img.index).toBe(1)
      expect(img.bytes.length).toBeGreaterThan(0)
      expect(img.fileName).toBe('imageFile1.png')

      const p1 = out.pageStats.find((s) => s.page === 1)!
      expect(p1.imageCount).toBe(1)
    } finally {
      fx.cleanup()
    }
  })

  it('image missing file on disk → image stat counted but not emitted', async () => {
    const out = await parseOdlJson({ json: realishJson(), imageFiles: [] })
    expect(out.images).toHaveLength(0)
    const p1 = out.pageStats.find((s) => s.page === 1)!
    expect(p1.imageCount).toBe(1)                               // stats 仍计数
  })

  it('uses "number of pages" top-level for pages count', async () => {
    const out = await parseOdlJson({ json: realishJson(), imageFiles: [] })
    expect(out.pages).toBe(3)
  })
})
