import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { createServer } from './server.ts'

const useHttp = process.argv.includes('--http')
const server = await createServer()

if (useHttp) {
  const app = express()
  app.use(express.json())

  const transport = new StreamableHTTPServerTransport({})
  app.use('/mcp', (req: express.Request, res: express.Response) =>
    transport.handleRequest(req, res, req.body)
  )
  app.get('/health', (_req: express.Request, res: express.Response) =>
    res.json({ ok: true })
  )

  await server.connect(transport)

  const port = Number(process.env.MCP_HTTP_PORT ?? 3002)
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`✓ MCP HTTP service → http://localhost:${port}/mcp`)
  })
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
