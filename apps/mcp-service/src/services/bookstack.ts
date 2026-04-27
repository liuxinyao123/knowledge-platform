import axios from 'axios'
import type { AxiosInstance } from 'axios'

let _bs: AxiosInstance | null = null

function getBs(): AxiosInstance {
  if (!_bs) {
    _bs = axios.create({
      baseURL: `${process.env.BOOKSTACK_URL}/api`,
      headers: { Authorization: `Token ${process.env.BOOKSTACK_MCP_TOKEN}` },
      proxy: false,
    })
  }
  return _bs
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

export interface SearchResult {
  name: string
  excerpt: string
  url: string
  type: string
  book_name: string
}

export async function searchKnowledge(
  query: string,
  count: number,
  shelfId?: number
): Promise<SearchResult[]> {
  let allowedBookIds: Set<number> | null = null
  if (shelfId != null) {
    const shelf = await getBs().get(`/shelves/${shelfId}`)
    allowedBookIds = new Set((shelf.data.books ?? []).map((b: any) => b.id as number))
  }

  const res = await getBs().get('/search', { params: { query, count } })
  let items: any[] = res.data?.data ?? []

  if (allowedBookIds !== null) {
    items = items.filter((r) => allowedBookIds!.has(r.book?.id))
  }

  return items.map((r) => ({
    name: r.name,
    excerpt: stripHtml(r.preview_html?.content ?? '').slice(0, 300),
    url: r.url,
    type: r.type,
    book_name: r.book?.name ?? '',
  }))
}

export interface PageContent {
  name: string
  content: string
  url: string
  tags: string[]
  updated_at: string
}

export async function getPageContent(pageId: number): Promise<PageContent> {
  const res = await getBs().get(`/pages/${pageId}`)
  const page = res.data
  return {
    name: page.name,
    content: stripHtml(page.html ?? '').slice(0, 10000),
    url: page.url,
    tags: (page.tags ?? []).map((t: any) => t.name as string),
    updated_at: page.updated_at,
  }
}
