export interface BSShelf {
  id: number
  name: string
  slug: string
  description: string
  url: string
  created_at: string
  updated_at: string
}

export interface BSBook {
  id: number
  name: string
  slug: string
  description: string
  url: string
  shelf_id?: number
  created_at: string
  updated_at: string
}

export interface BSChapter {
  id: number
  book_id: number
  name: string
  slug: string
  url: string
  created_at: string
  updated_at: string
}

export interface BSPage {
  id: number
  book_id: number
  chapter_id: number
  name: string
  slug: string
  url: string
  draft: boolean
  template: boolean
  created_at: string
  updated_at: string
}

export interface BSPageDetail extends BSPage {
  html: string
  markdown: string
  tags: { name: string; value: string }[]
}

export interface BSSearchResult {
  id: number
  name: string
  url: string
  type: 'bookshelf' | 'book' | 'chapter' | 'page'
  book_id?: number
  chapter_id?: number
  preview_html: {
    name: string
    content: string
  }
  tags: { name: string; value: string }[]
}

export interface BSListResponse<T> {
  data: T[]
  total: number
}

export interface BSImport {
  id: number
  name: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  type: 'book' | 'chapter' | 'page'
}

