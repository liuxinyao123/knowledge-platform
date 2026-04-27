import { describe, it, expect } from 'vitest'
import { mergeChunksToPageDocs } from '../services/vectorSearch.ts'

describe('mergeChunksToPageDocs', () => {
  it('groups by page and keeps best score ordering', () => {
    const docs = mergeChunksToPageDocs(
      [
        { page_id: 1, chunk_index: 0, page_name: 'A', page_url: '/a', text: 'x', score: 0.9 },
        { page_id: 2, chunk_index: 0, page_name: 'B', page_url: '/b', text: 'y', score: 0.95 },
        { page_id: 1, chunk_index: 1, page_name: 'A', page_url: '/a', text: 'z', score: 0.85 },
      ],
      8,
    )
    expect(docs[0].id).toBe(2)
    expect(docs[0].text).toContain('y')
    expect(docs[1].id).toBe(1)
  })
})
