import { Router, type Request, type Response } from 'express'
import httpProxy from 'http-proxy'

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: 600_000,
  timeout: 600_000,
})

proxy.on('error', (err, _req, res) => {
  const r = res as Response
  if (r && typeof r.writeHead === 'function' && !r.headersSent) {
    r.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    r.end(JSON.stringify({ error: 'bookstack_proxy_error', message: err.message }))
  }
})

export const bookstackProxyRouter = Router()

bookstackProxyRouter.use((req: Request, res: Response) => {
  const id = process.env.BOOKSTACK_TOKEN_ID
  const secret = process.env.BOOKSTACK_TOKEN_SECRET
  if (!id || !secret) {
    res.status(503).json({
      error: 'bookstack_token_missing',
      message: '服务端未配置 BOOKSTACK_TOKEN_ID / BOOKSTACK_TOKEN_SECRET',
    })
    return
  }

  const base = process.env.BOOKSTACK_URL ?? 'http://localhost:6875'
  const suffix = !req.url || req.url === '/' ? '' : req.url
  const targetPath = `/api${suffix}`

  // Avoid BookStack treating the request as a browser session (can override API token).
  delete req.headers.authorization
  delete req.headers.cookie

  req.url = targetPath

  proxy.web(req, res, {
    target: base,
    headers: {
      Authorization: `Token ${id}:${secret}`,
    },
  })
})
