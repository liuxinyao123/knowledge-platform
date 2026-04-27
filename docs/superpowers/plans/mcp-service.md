# MCP Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone MCP service exposing `search_knowledge` and `get_page_content` tools backed by BookStack's read-only API, with stdio and HTTP transports.

**Architecture:** Thin Node.js service using `@modelcontextprotocol/sdk`. Tool logic lives in separate files (testable in isolation). Entry point selects transport based on `--http` arg.

**Tech Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk`, axios, express, Vitest

---

### Task 1: Scaffold package

**Files:**
- Create: `apps/mcp-service/package.json`
- Create: `apps/mcp-service/tsconfig.json`
- Create: `apps/mcp-service/.env.example`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mcp-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --experimental-strip-types src/index.ts",
    "dev:http": "node --experimental-strip-types src/index.ts --http",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "axios": "^1.15.0",
    "express": "^5.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^24.12.2",
    "typescript": "^6.0.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "__tests__"]
}
```

- [ ] **Step 3: Create .env.example**

```
BOOKSTACK_URL=http://localhost:6875
BOOKSTACK_MCP_TOKEN=token_id:token_secret
MCP_HTTP_PORT=3002
```

- [ ] **Step 4: Install dependencies**

```bash
cd apps/mcp-service && pnpm install --no-frozen-lockfile
```
Expected: dependencies installed

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-service/package.json apps/mcp-service/tsconfig.json apps/mcp-service/.env.example
git commit -m "chore(mcp-service): scaffold package"
```

---

### Task 2: BookStack service + stripHtml (TDD)

**Files:**
- Create: `apps/mcp-service/src/services/bookstack.ts`
- Create: `apps/mcp-service/__tests__/bookstack.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/mcp-service/__tests__/bookstack.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))
vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ get: mockGet })) },
}))

import { stripHtml, searchKnowledge, getPageContent } from '../src/services/bookstack.ts'

describe('stripHtml', () => {
  it('removes html tags', () => {
    expect(stripHtml('<b>hello</b> world')).toBe('hello world')
  })
  it('collapses whitespace', () => {
    expect(stripHtml('<p>  a  </p>')).toBe('a')
  })
})

describe('searchKnowledge', () => {
  it('calls /search with query and count', async () => {
    mockGet.mockResolvedValue({
      data: { data: [{ name: 'A', type: 'page', url: 'http://bs/p/1',
        preview_html: { content: '<p>excerpt</p>' }, book: { id: 1, name: 'KB' } }] }
    })
    const result = await searchKnowledge('hello', 5)
    expect(mockGet).toHaveBeenCalledWith('/search', { params: { query: 'hello', count: 5 } })
    expect(result[0]).toMatchObject({ name: 'A', excerpt: 'excerpt', book_name: 'KB' })
  })

  it('filters by shelf_id when provided', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { books: [{ id: 10 }] } })           // shelves/:id
      .mockResolvedValueOnce({ data: { data: [
        { name: 'Match', type: 'page', url: 'u1', preview_html: { content: '' }, book: { id: 10, name: 'KB' } },
        { name: 'Skip', type: 'page', url: 'u2', preview_html: { content: '' }, book: { id: 99, name: 'Other' } },
      ]}})
    const result = await searchKnowledge('x', 10, 5)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Match')
  })

  it('returns empty array when shelf_id has no matching books in results', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { books: [{ id: 10 }] } })
      .mockResolvedValueOnce({ data: { data: [
        { name: 'Skip', type: 'page', url: 'u', preview_html: { content: '' }, book: { id: 99, name: 'X' } },
      ]}})
    const result = await searchKnowledge('x', 10, 5)
    expect(result).toHaveLength(0)
  })
})

describe('getPageContent', () => {
  it('returns parsed page fields', async () => {
    mockGet.mockResolvedValue({ data: {
      name: '架构', html: '<h1>标题</h1>', url: 'http://bs/p/42',
      tags: [{ name: '技术' }, { name: '架构' }], updated_at: '2026-04-01T10:00:00Z'
    }})
    const result = await getPageContent(42)
    expect(result.name).toBe('架构')
    expect(result.content).toBe('标题')
    expect(result.tags).toEqual(['技术', '架构'])
    expect(result.updated_at).toBe('2026-04-01T10:00:00Z')
  })

  it('truncates content to 10000 chars', async () => {
    mockGet.mockResolvedValue({ data: {
      name: 'X', html: 'a'.repeat(20000), url: 'u', tags: [], updated_at: ''
    }})
    const result = await getPageContent(1)
    expect(result.content.length).toBe(10000)
  })
})
```

- [ ] **Step 2: Run to verify RED**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement bookstack.ts**

Create `apps/mcp-service/src/services/bookstack.ts`:
```ts
import axios from 'axios'

const bs = axios.create({
  baseURL: `${process.env.BOOKSTACK_URL}/api`,
  headers: { Authorization: `Token ${process.env.BOOKSTACK_MCP_TOKEN}` },
})

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

interface SearchResult {
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
    const shelf = await bs.get(`/shelves/${shelfId}`)
    allowedBookIds = new Set((shelf.data.books ?? []).map((b: any) => b.id))
  }

  const res = await bs.get('/search', { params: { query, count } })
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

interface PageContent {
  name: string
  content: string
  url: string
  tags: string[]
  updated_at: string
}

export async function getPageContent(pageId: number): Promise<PageContent> {
  const res = await bs.get(`/pages/${pageId}`)
  const page = res.data
  return {
    name: page.name,
    content: stripHtml(page.html ?? '').slice(0, 10000),
    url: page.url,
    tags: (page.tags ?? []).map((t: any) => t.name),
    updated_at: page.updated_at,
  }
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-service/src/services/bookstack.ts apps/mcp-service/__tests__/bookstack.test.ts
git commit -m "feat(mcp-service): BookStack client with search and page content"
```

---

### Task 3: Tool wrappers (TDD)

**Files:**
- Create: `apps/mcp-service/src/tools/search_knowledge.ts`
- Create: `apps/mcp-service/src/tools/get_page_content.ts`
- Create: `apps/mcp-service/__tests__/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/mcp-service/__tests__/tools.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const { mockSearch, mockGetPage } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockGetPage: vi.fn(),
}))
vi.mock('../src/services/bookstack.ts', () => ({
  searchKnowledge: mockSearch,
  getPageContent: mockGetPage,
}))

import { runSearchKnowledge } from '../src/tools/search_knowledge.ts'
import { runGetPageContent } from '../src/tools/get_page_content.ts'

describe('runSearchKnowledge', () => {
  it('calls searchKnowledge with defaults and returns results text', async () => {
    mockSearch.mockResolvedValue([{ name: 'A', excerpt: 'ex', url: 'u', type: 'page', book_name: 'KB' }])
    const res = await runSearchKnowledge({ query: 'hello' })
    expect(mockSearch).toHaveBeenCalledWith('hello', 10, undefined)
    expect(JSON.parse(res)).toMatchObject({ results: [{ name: 'A' }] })
  })

  it('passes count and shelf_id', async () => {
    mockSearch.mockResolvedValue([])
    await runSearchKnowledge({ query: 'x', count: 5, shelf_id: 3 })
    expect(mockSearch).toHaveBeenCalledWith('x', 5, 3)
  })
})

describe('runGetPageContent', () => {
  it('calls getPageContent and returns JSON string', async () => {
    mockGetPage.mockResolvedValue({ name: 'P', content: 'c', url: 'u', tags: [], updated_at: '' })
    const res = await runGetPageContent({ page_id: 42 })
    expect(mockGetPage).toHaveBeenCalledWith(42)
    expect(JSON.parse(res)).toMatchObject({ name: 'P' })
  })
})
```

- [ ] **Step 2: Run to verify RED**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: Create tool files**

Create `apps/mcp-service/src/tools/search_knowledge.ts`:
```ts
import { searchKnowledge } from '../services/bookstack.ts'

interface SearchInput {
  query: string
  shelf_id?: number
  count?: number
}

export async function runSearchKnowledge(input: SearchInput): Promise<string> {
  const results = await searchKnowledge(input.query, input.count ?? 10, input.shelf_id)
  return JSON.stringify({ results })
}
```

Create `apps/mcp-service/src/tools/get_page_content.ts`:
```ts
import { getPageContent } from '../services/bookstack.ts'

interface GetPageInput {
  page_id: number
}

export async function runGetPageContent(input: GetPageInput): Promise<string> {
  const page = await getPageContent(input.page_id)
  return JSON.stringify(page)
}
```

- [ ] **Step 4: Run to verify GREEN**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-service/src/tools/ apps/mcp-service/__tests__/tools.test.ts
git commit -m "feat(mcp-service): add search_knowledge and get_page_content tool wrappers"
```

---

### Task 4: MCP Server + entry point

**Files:**
- Create: `apps/mcp-service/src/server.ts`
- Create: `apps/mcp-service/src/index.ts`

- [ ] **Step 1: Create server.ts**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { runSearchKnowledge } from './tools/search_knowledge.ts'
import { runGetPageContent } from './tools/get_page_content.ts'

export function createServer() {
  const server = new McpServer({
    name: 'knowledge-mcp',
    version: '1.0.0',
  })

  server.tool(
    'search_knowledge',
    '在知识库中搜索相关内容',
    {
      query: z.string().describe('搜索关键词'),
      shelf_id: z.number().optional().describe('限定知识空间 ID（可选）'),
      count: z.number().optional().describe('返回数量，默认 10'),
    },
    async (input) => {
      const text = await runSearchKnowledge(input)
      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'get_page_content',
    '获取指定知识库页面的完整内容',
    {
      page_id: z.number().describe('BookStack 页面 ID'),
    },
    async (input) => {
      const text = await runGetPageContent(input)
      return { content: [{ type: 'text', text }] }
    }
  )

  return server
}
```

- [ ] **Step 2: Create index.ts**

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { createServer } from './server.ts'

const useHttp = process.argv.includes('--http')
const server = createServer()

if (useHttp) {
  const app = express()
  app.use(express.json())

  const transport = new StreamableHTTPServerTransport({ path: '/mcp' })
  app.use('/mcp', (req, res) => transport.handleRequest(req, res))
  app.get('/health', (_req, res) => res.json({ ok: true }))

  await server.connect(transport)

  const port = Number(process.env.MCP_HTTP_PORT ?? 3002)
  app.listen(port, () => {
    console.log(`✓ MCP HTTP service → http://localhost:${port}/mcp`)
  })
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/mcp-service/src/server.ts apps/mcp-service/src/index.ts
git commit -m "feat(mcp-service): MCP server with stdio and HTTP transports"
```

---

### Task 5: Generate mcp-schema.json

**Files:**
- Create: `apps/mcp-service/mcp-schema.json`

- [ ] **Step 1: Write schema file**

Create `apps/mcp-service/mcp-schema.json`:
```json
{
  "name": "knowledge-mcp",
  "version": "1.0.0",
  "description": "知识中台 MCP 服务 — 搜索与内容读取",
  "tools": [
    {
      "name": "search_knowledge",
      "description": "在知识库中搜索相关内容",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "搜索关键词"
          },
          "shelf_id": {
            "type": "number",
            "description": "限定知识空间 ID（可选）"
          },
          "count": {
            "type": "number",
            "description": "返回数量，默认 10"
          }
        },
        "required": ["query"]
      }
    },
    {
      "name": "get_page_content",
      "description": "获取指定知识库页面的完整内容",
      "inputSchema": {
        "type": "object",
        "properties": {
          "page_id": {
            "type": "number",
            "description": "BookStack 页面 ID"
          }
        },
        "required": ["page_id"]
      }
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mcp-service/mcp-schema.json
git commit -m "feat(mcp-service): add mcp-schema.json for skill market registration"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run all tests**

```bash
cd apps/mcp-service && pnpm test 2>&1 | tail -10
```
Expected: All tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mcp-service && pnpm build 2>&1 | tail -5
```
Expected: No errors

- [ ] **Step 3: Commit all remaining files**

```bash
cd /Users/liuxinyao/Documents/09-Obsidian/GIT/knowledge-platform
git add docs/superpowers/specs/mcp-service/ docs/superpowers/plans/mcp-service.md
git commit -m "docs: add MCP service spec and implementation plan"
```
