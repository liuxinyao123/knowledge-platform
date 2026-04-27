# Governance RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage-based role management with a persistent MySQL-backed governance API; add a Space Visibility tab.

**Architecture:** qa-service gains a mysql2 connection pool and four new `/api/governance/*` endpoints. The frontend Governance page calls these via a new `govApi` client, replacing `bsApi` calls in MembersTab.

**Tech Stack:** Node.js/Express, mysql2/promise, React, axios, Vitest

---

### Task 1: Install mysql2 in qa-service

**Files:**
- Modify: `apps/qa-service/package.json`

- [ ] **Step 1: Add mysql2 dependency**

Edit `apps/qa-service/package.json` — add to `dependencies`:
```json
"mysql2": "^3.11.0"
```

- [ ] **Step 2: Install**

Run: `cd apps/qa-service && pnpm install --no-frozen-lockfile`
Expected: mysql2 installed successfully

- [ ] **Step 3: Commit**

```bash
git add apps/qa-service/package.json apps/qa-service/pnpm-lock.yaml
git commit -m "chore(qa-service): add mysql2 dependency"
```

---

### Task 2: Create db.ts — MySQL connection pool + table migration

**Files:**
- Create: `apps/qa-service/src/services/db.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/qa-service/src/__tests__/db.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock mysql2/promise before importing db
vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue([[], []]),
      getConnection: vi.fn(),
    })),
  },
}))

describe('db pool', () => {
  it('exports a pool object', async () => {
    const { pool } = await import('../services/db.ts')
    expect(pool).toBeDefined()
    expect(typeof pool.execute).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/qa-service && pnpm test -- --reporter=verbose 2>&1 | tail -20`
Expected: FAIL (module not found or similar)

- [ ] **Step 3: Create db.ts**

```ts
import mysql from 'mysql2/promise'

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'bookstack',
  user: process.env.DB_USER ?? 'bookstack',
  password: process.env.DB_PASS ?? 'bookstack_secret',
  waitForConnections: true,
  connectionLimit: 5,
})

export async function runMigrations(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_user_roles (
      user_id     INT          NOT NULL,
      email       VARCHAR(255) NOT NULL,
      name        VARCHAR(255) NOT NULL DEFAULT '',
      role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id)
    )
  `)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_shelf_visibility (
      shelf_id    INT          NOT NULL,
      shelf_name  VARCHAR(255) NOT NULL DEFAULT '',
      visibility  ENUM('public','team','private') NOT NULL DEFAULT 'public',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (shelf_id)
    )
  `)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/qa-service && pnpm test -- --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/qa-service/src/services/db.ts apps/qa-service/src/__tests__/db.test.ts
git commit -m "feat(qa-service): add mysql2 pool and table migrations"
```

---

### Task 3: Create governance.ts router — 4 endpoints

**Files:**
- Create: `apps/qa-service/src/routes/governance.ts`
- Create: `apps/qa-service/src/__tests__/governance.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/qa-service/src/__tests__/governance.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock db pool
const mockExecute = vi.fn()
vi.mock('../services/db.ts', () => ({
  pool: { execute: mockExecute },
}))

// Mock bookstack
const mockBsGet = vi.fn()
const mockBsPut = vi.fn()
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockBsGet,
      put: mockBsPut,
    })),
  },
}))

import { governanceRouter } from '../routes/governance.ts'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/governance', governanceRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/governance/users', () => {
  it('merges BookStack users with DB roles', async () => {
    mockBsGet.mockResolvedValue({ data: { data: [{ id: 1, name: 'Alice', email: 'alice@x.com', avatar_url: null }] } })
    mockExecute.mockResolvedValue([[{ user_id: 1, role: 'editor' }]])

    const res = await request(buildApp()).get('/api/governance/users')
    expect(res.status).toBe(200)
    expect(res.body.users[0]).toMatchObject({ id: 1, name: 'Alice', role: 'editor' })
  })

  it('defaults to viewer when no DB record', async () => {
    mockBsGet.mockResolvedValue({ data: { data: [{ id: 2, name: 'Bob', email: 'bob@x.com' }] } })
    mockExecute.mockResolvedValue([[]])

    const res = await request(buildApp()).get('/api/governance/users')
    expect(res.body.users[0].role).toBe('viewer')
  })
})

describe('PUT /api/governance/users/:id/role', () => {
  it('upserts role and syncs BookStack', async () => {
    mockExecute.mockResolvedValue([{}, []])
    mockBsPut.mockResolvedValue({})

    const res = await request(buildApp())
      .put('/api/governance/users/1/role')
      .send({ role: 'editor' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockBsPut).toHaveBeenCalledWith('/users/1', { roles: [2] })
  })

  it('returns 400 for invalid role', async () => {
    const res = await request(buildApp())
      .put('/api/governance/users/1/role')
      .send({ role: 'superuser' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/governance/shelf-visibility', () => {
  it('merges BookStack shelves with DB visibility', async () => {
    mockBsGet.mockResolvedValue({ data: { data: [{ id: 10, name: '产品' }] } })
    mockExecute.mockResolvedValue([[{ shelf_id: 10, visibility: 'team' }]])

    const res = await request(buildApp()).get('/api/governance/shelf-visibility')
    expect(res.status).toBe(200)
    expect(res.body.shelves[0]).toMatchObject({ id: 10, name: '产品', visibility: 'team' })
  })

  it('defaults to public when no DB record', async () => {
    mockBsGet.mockResolvedValue({ data: { data: [{ id: 11, name: '技术' }] } })
    mockExecute.mockResolvedValue([[]])

    const res = await request(buildApp()).get('/api/governance/shelf-visibility')
    expect(res.body.shelves[0].visibility).toBe('public')
  })
})

describe('PUT /api/governance/shelf-visibility/:id', () => {
  it('upserts visibility', async () => {
    mockExecute.mockResolvedValue([{}, []])

    const res = await request(buildApp())
      .put('/api/governance/shelf-visibility/10')
      .send({ visibility: 'private' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('returns 400 for invalid visibility', async () => {
    const res = await request(buildApp())
      .put('/api/governance/shelf-visibility/10')
      .send({ visibility: 'secret' })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Install supertest**

```bash
cd apps/qa-service && pnpm add -D supertest @types/supertest --no-frozen-lockfile
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/qa-service && pnpm test -- --reporter=verbose 2>&1 | tail -30`
Expected: FAIL (module not found)

- [ ] **Step 4: Create governance.ts**

```ts
import { Router } from 'express'
import axios from 'axios'
import { pool } from '../services/db.ts'

const VALID_ROLES = ['admin', 'editor', 'viewer'] as const
const VALID_VISIBILITIES = ['public', 'team', 'private'] as const
const ROLE_MAP: Record<string, number> = { admin: 1, editor: 2, viewer: 3 }

const bs = axios.create({
  baseURL: `${process.env.BOOKSTACK_URL}/api`,
  headers: {
    Authorization: `Token ${process.env.BOOKSTACK_TOKEN_ID}:${process.env.BOOKSTACK_TOKEN_SECRET}`,
  },
})

export const governanceRouter = Router()

governanceRouter.get('/users', async (_req, res) => {
  const [bsResp, [dbRows]] = await Promise.all([
    bs.get('/users', { params: { count: 50 } }),
    pool.execute('SELECT user_id, role FROM knowledge_user_roles') as Promise<any>,
  ])
  const bsUsers: any[] = bsResp.data?.data ?? []
  const roleMap = new Map((dbRows as any[]).map((r: any) => [r.user_id, r.role]))
  const users = bsUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url ?? null,
    role: roleMap.get(u.id) ?? 'viewer',
  }))
  res.json({ users })
})

governanceRouter.put('/users/:id/role', async (req, res) => {
  const userId = Number(req.params.id)
  const { role } = req.body as { role: string }
  if (!VALID_ROLES.includes(role as any)) {
    res.status(400).json({ error: 'invalid role' })
    return
  }
  await pool.execute(
    `INSERT INTO knowledge_user_roles (user_id, email, name, role)
     VALUES (?, '', '', ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [userId, role]
  )
  await bs.put(`/users/${userId}`, { roles: [ROLE_MAP[role]] })
  res.json({ ok: true })
})

governanceRouter.get('/shelf-visibility', async (_req, res) => {
  const [bsResp, [dbRows]] = await Promise.all([
    bs.get('/shelves', { params: { count: 100 } }),
    pool.execute('SELECT shelf_id, visibility FROM knowledge_shelf_visibility') as Promise<any>,
  ])
  const bsShelves: any[] = bsResp.data?.data ?? []
  const visMap = new Map((dbRows as any[]).map((r: any) => [r.shelf_id, r.visibility]))
  const shelves = bsShelves.map((s) => ({
    id: s.id,
    name: s.name,
    visibility: visMap.get(s.id) ?? 'public',
  }))
  res.json({ shelves })
})

governanceRouter.put('/shelf-visibility/:id', async (req, res) => {
  const shelfId = Number(req.params.id)
  const { visibility } = req.body as { visibility: string }
  if (!VALID_VISIBILITIES.includes(visibility as any)) {
    res.status(400).json({ error: 'invalid visibility' })
    return
  }
  await pool.execute(
    `INSERT INTO knowledge_shelf_visibility (shelf_id, shelf_name, visibility)
     VALUES (?, '', ?)
     ON DUPLICATE KEY UPDATE visibility = VALUES(visibility)`,
    [shelfId, visibility]
  )
  res.json({ ok: true })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/qa-service && pnpm test -- --reporter=verbose 2>&1 | tail -30`
Expected: All governance tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/qa-service/src/routes/governance.ts apps/qa-service/src/__tests__/governance.test.ts apps/qa-service/package.json
git commit -m "feat(qa-service): add governance routes with UPSERT and BookStack sync"
```

---

### Task 4: Mount governance router in qa-service index

**Files:**
- Modify: `apps/qa-service/src/index.ts`
- Modify: `apps/qa-service/.env.example` (if it exists, else create)

- [ ] **Step 1: Update index.ts**

Add import after existing imports:
```ts
import { governanceRouter } from './routes/governance.ts'
import { runMigrations } from './services/db.ts'
```

Add router mount after `app.use('/api/qa', qaRouter)`:
```ts
app.use('/api/governance', governanceRouter)
```

Call migrations before listen:
```ts
await runMigrations()
```
Wrap the `app.listen` call in an async IIFE:
```ts
;(async () => {
  await runMigrations()
  app.listen(PORT, () => { ... })
})()
```

- [ ] **Step 2: Update/create .env.example**

Add:
```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=bookstack
DB_USER=bookstack
DB_PASS=bookstack_secret
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd apps/qa-service && pnpm test 2>&1 | tail -20`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add apps/qa-service/src/index.ts
git commit -m "feat(qa-service): mount governance router and run DB migrations on startup"
```

---

### Task 5: Create govApi frontend client + Vite proxy

**Files:**
- Create: `apps/web/src/api/governance.ts`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Create governance.ts API client**

```ts
import axios from 'axios'

const govClient = axios.create({ baseURL: '/api/governance' })

export const govApi = {
  getUsers: (): Promise<{ users: GovUser[] }> =>
    govClient.get('/users').then((r) => r.data),
  updateUserRole: (id: number, role: string): Promise<{ ok: boolean }> =>
    govClient.put(`/users/${id}/role`, { role }).then((r) => r.data),
  getShelfVisibility: (): Promise<{ shelves: GovShelf[] }> =>
    govClient.get('/shelf-visibility').then((r) => r.data),
  updateShelfVisibility: (id: number, visibility: string): Promise<{ ok: boolean }> =>
    govClient.put(`/shelf-visibility/${id}`, { visibility }).then((r) => r.data),
}

export interface GovUser {
  id: number
  name: string
  email: string
  avatar_url: string | null
  role: 'admin' | 'editor' | 'viewer'
}

export interface GovShelf {
  id: number
  name: string
  visibility: 'public' | 'team' | 'private'
}
```

- [ ] **Step 2: Add Vite proxy**

In `apps/web/vite.config.ts`, inside `proxy: { ... }` add:
```ts
'/api/governance': {
  target: 'http://localhost:3001',
  changeOrigin: true,
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/governance.ts apps/web/vite.config.ts
git commit -m "feat(web): add govApi client and governance proxy"
```

---

### Task 6: Rework Governance page — MembersTab + SpacesTab

**Files:**
- Modify: `apps/web/src/knowledge/Governance/index.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/knowledge/Governance/index.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/governance', () => ({
  govApi: {
    getUsers: vi.fn(),
    updateUserRole: vi.fn(),
    getShelfVisibility: vi.fn(),
    updateShelfVisibility: vi.fn(),
  },
}))

import { govApi } from '@/api/governance'
import Governance from './index'

function renderGovernance() {
  return render(
    <MemoryRouter initialEntries={['/governance']}>
      <Governance />
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('MembersTab', () => {
  beforeEach(() => {
    ;(govApi.getUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
      users: [{ id: 1, name: 'Alice', email: 'alice@x.com', role: 'admin', avatar_url: null }],
    })
  })

  it('displays user name from govApi', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
  })

  it('role select defaults to user role from govApi', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => {
      const select = screen.getByTestId('role-select-1') as HTMLSelectElement
      expect(select.value).toBe('admin')
    })
  })

  it('calls updateUserRole on save', async () => {
    ;(govApi.updateUserRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => screen.getByTestId('role-select-1'))
    fireEvent.change(screen.getByTestId('role-select-1'), { target: { value: 'editor' } })
    fireEvent.click(screen.getByTestId('save-role-1'))
    await waitFor(() => expect(govApi.updateUserRole).toHaveBeenCalledWith(1, 'editor'))
  })
})

describe('SpacesTab', () => {
  beforeEach(() => {
    ;(govApi.getShelfVisibility as ReturnType<typeof vi.fn>).mockResolvedValue({
      shelves: [{ id: 10, name: '产品', visibility: 'team' }],
    })
  })

  it('displays shelf name', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-spaces'))
    await waitFor(() => expect(screen.getByText('产品')).toBeInTheDocument())
  })

  it('calls updateShelfVisibility on save', async () => {
    ;(govApi.updateShelfVisibility as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-spaces'))
    await waitFor(() => screen.getByTestId('visibility-select-10'))
    fireEvent.change(screen.getByTestId('visibility-select-10'), { target: { value: 'private' } })
    fireEvent.click(screen.getByTestId('save-visibility-10'))
    await waitFor(() => expect(govApi.updateShelfVisibility).toHaveBeenCalledWith(10, 'private'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | head -20`
Expected: FAIL (govApi mock not found, SpacesTab not exists)

- [ ] **Step 3: Rework Governance/index.tsx**

Key changes to `apps/web/src/knowledge/Governance/index.tsx`:
1. Remove `import { bsApi } from '@/api/bookstack'`
2. Add `import { govApi, GovUser, GovShelf } from '@/api/governance'`
3. Replace `MembersTab` implementation:
   - Remove localStorage (`LS_KEY`, `loadStored()`)
   - State: `users: GovUser[]`, `roleSelections: Record<number, string>`
   - useEffect: call `govApi.getUsers()` → seed roleSelections from result
   - `handleSave(userId)`: call `govApi.updateUserRole(userId, roleSelections[userId])`
   - Role dropdown options: `['admin','editor','viewer']` with labels `{admin:'管理员', editor:'编辑', viewer:'访客'}`
   - Each row: role `<select data-testid="role-select-{id}">` + `<button data-testid="save-role-{id}">保存</button>`
4. Add `SpacesTab` component:
   - State: `shelves: GovShelf[]`, `visSelections: Record<number, string>`
   - useEffect: call `govApi.getShelfVisibility()` → seed visSelections
   - `handleSave(shelfId)`: call `govApi.updateShelfVisibility(shelfId, visSelections[shelfId])`
   - Visibility options: `['public','team','private']` with labels `{public:'公开',team:'团队',private:'私密'}`
   - Each row: `<select data-testid="visibility-select-{id}">` + `<button data-testid="save-visibility-{id}">保存</button>`
5. Add `spaces` to SubTab type and SUBTABS array with `data-testid="subtab-spaces"`
6. Render `{activeTab === 'spaces' && <SpacesTab />}`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- --reporter=verbose 2>&1 | grep -E "governance|FAIL|PASS" | head -20`
Expected: All governance tests PASS

- [ ] **Step 5: Run full frontend test suite**

Run: `cd apps/web && pnpm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/knowledge/Governance/index.tsx apps/web/src/knowledge/Governance/index.test.tsx
git commit -m "feat(web): rework MembersTab with govApi, add SpacesTab"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run all qa-service tests**

Run: `cd apps/qa-service && pnpm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 2: Run all web tests**

Run: `cd apps/web && pnpm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 3: TypeScript check**

Run: `cd apps/qa-service && pnpm build 2>&1 | tail -10`
Expected: No TS errors
