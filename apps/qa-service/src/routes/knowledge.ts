import { Router, type Request, type Response } from 'express'

export const knowledgeRouter = Router()

knowledgeRouter.get('/pages/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'invalid page id' })
    return
  }

  const base = process.env.BOOKSTACK_URL ?? 'http://localhost:6875'
  const tokenId = process.env.BOOKSTACK_TOKEN_ID
  const tokenSecret = process.env.BOOKSTACK_TOKEN_SECRET

  if (!tokenId || !tokenSecret) {
    res.status(503).json({ error: 'bookstack token not configured' })
    return
  }

  const apiRes = await fetch(`${base}/api/pages/${id}`, {
    headers: { Authorization: `Token ${tokenId}:${tokenSecret}` },
  })

  if (!apiRes.ok) {
    res.status(apiRes.status).json({ error: `bookstack api ${apiRes.status}` })
    return
  }

  const data = (await apiRes.json()) as {
    name?: string
    html?: string
    updated_at?: string
    slug?: string
    book_id?: number
  }

  res.json({
    name: data.name ?? '',
    html: data.html ?? '',
    updated_at: data.updated_at ?? null,
    url: `${base}/books/${data.book_id}/page/${data.slug}`,
  })
})
