import axios from 'axios'
import type { AxiosInstance } from 'axios'

let _bs: AxiosInstance | null = null

function getBs(): AxiosInstance {
  if (!_bs) {
    _bs = axios.create({
      baseURL: `${process.env.BOOKSTACK_URL}/api`,
      headers: {
        Authorization: `Token ${process.env.BOOKSTACK_TOKEN_ID}:${process.env.BOOKSTACK_TOKEN_SECRET}`,
      },
      proxy: false,
    })
  }
  return _bs
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

export async function searchPages(query: string, count = 15) {
  const res = await getBs().get('/search', { params: { query, count } })
  return (res.data?.data ?? []).filter((r: any) => r.type === 'page').slice(0, 8) as any[]
}

export async function getPageContent(id: number) {
  const res = await getBs().get(`/pages/${id}`)
  const page = res.data as { id: number; name: string; html: string; slug?: string; url?: string }
  const text = stripHtml(page.html).slice(0, 2000)
  const url = page.url ?? `${process.env.BOOKSTACK_URL ?? ''}/link/${page.id}`
  return {
    ...page,
    url,
    text,
    excerpt: text.slice(0, 200),
  }
}

/** 同步索引用：尽量保留正文（仍设上限避免异常大页） */
export async function getPageForIndexing(id: number) {
  const res = await getBs().get(`/pages/${id}`)
  const page = res.data as { id: number; name: string; html: string; slug?: string; url?: string }
  const text = stripHtml(page.html).slice(0, 500_000)
  return {
    id: page.id,
    name: page.name ?? `页面 #${id}`,
    url: page.url ?? `${process.env.BOOKSTACK_URL ?? ''}/link/${page.id}`,
    text,
  }
}

// ── 附件（ADR-31 · 2026-04-24 · BookStack 附件索引） ─────────────────────
// 用户上传 xlsx / pdf / docx 到 BookStack 页面时存为 attachment，
// 过去 sync 只读 page HTML body，附件本身从未被下载过 —— 用户反馈 "切片 2" 即此根因。
// 这里新增两个 API：
//   listPageAttachments(pageId) —— 列出某页所有附件（含 external link / 实体文件）
//   getAttachmentContent(attId) —— 下载实体文件为 Buffer；external link 返 null

export interface BookstackAttachment {
  id: number
  name: string
  extension: string
  external: boolean
  uploaded_to: number
}

/** 列某页所有附件（只返元数据；实体文件需再调 getAttachmentContent）*/
export async function listPageAttachments(pageId: number): Promise<BookstackAttachment[]> {
  // /api/attachments?filter[uploaded_to]={pageId} —— BookStack 官方 filter 语法
  const res = await getBs().get('/attachments', {
    params: { 'filter[uploaded_to]': pageId, count: 200 },
  })
  const raw = (res.data?.data ?? []) as Array<Record<string, unknown>>
  return raw.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
    extension: String(r.extension ?? ''),
    external: Boolean(r.external),
    uploaded_to: Number(r.uploaded_to),
  }))
}

/**
 * 下载附件实体文件。
 * BookStack 单体 attachment 接口返 `{ content: base64, ... }`（对 uploaded 类型）；
 * external link 没有 content。
 */
export async function getAttachmentContent(attId: number): Promise<{
  name: string
  buffer: Buffer
  extension: string
} | null> {
  const res = await getBs().get(`/attachments/${attId}`)
  const att = res.data as {
    id: number
    name: string
    extension?: string
    external?: boolean
    content?: string
  }
  if (att.external) return null
  if (typeof att.content !== 'string' || !att.content) return null
  return {
    name: att.name,
    extension: att.extension ?? '',
    buffer: Buffer.from(att.content, 'base64'),
  }
}

/** 分页拉取全部页面 id（BookStack /api/pages 支持 offset） */
/** 分页拉取页面元数据（用于资产目录同步） */
export async function listPagesBatch(
  offset: number,
  count: number,
): Promise<{ id: number; name: string }[]> {
  const res = await getBs().get('/pages', { params: { count, offset, sort: '+id' } })
  const data = (res.data?.data ?? []) as { id: number; name: string }[]
  return data.map((p) => ({ id: p.id, name: p.name ?? `页面 #${p.id}` }))
}

export async function listAllPageIds(): Promise<number[]> {
  const ids: number[] = []
  const count = 100
  let offset = 0
  for (;;) {
    const res = await getBs().get('/pages', { params: { count, offset, sort: '+id' } })
    const data = (res.data?.data ?? []) as { id: number }[]
    if (!data.length) break
    for (const p of data) ids.push(p.id)
    if (data.length < count) break
    offset += count
  }
  return ids
}
