import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const { mockExecute, mockBsGet, mockBsPut } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockBsGet: vi.fn(),
  mockBsPut: vi.fn(),
}))

vi.mock('../services/db.ts', () => ({
  pool: { execute: mockExecute },
}))

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
    mockBsGet.mockResolvedValue({
      data: { data: [{ id: 1, name: 'Alice', email: 'alice@x.com', avatar_url: null }] },
    })
    mockExecute.mockResolvedValue([[{ user_id: 1, role: 'editor' }]])

    const res = await request(buildApp()).get('/api/governance/users')
    expect(res.status).toBe(200)
    expect(res.body.users[0]).toMatchObject({ id: 1, name: 'Alice', role: 'editor' })
  })

  it('defaults to viewer when no DB record', async () => {
    mockBsGet.mockResolvedValue({
      data: { data: [{ id: 2, name: 'Bob', email: 'bob@x.com' }] },
    })
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
    mockBsGet.mockResolvedValue({
      data: { data: [{ id: 10, name: '产品' }] },
    })
    mockExecute.mockResolvedValue([[{ shelf_id: 10, visibility: 'team' }]])

    const res = await request(buildApp()).get('/api/governance/shelf-visibility')
    expect(res.status).toBe(200)
    expect(res.body.shelves[0]).toMatchObject({ id: 10, name: '产品', visibility: 'team' })
  })

  it('defaults to public when no DB record', async () => {
    mockBsGet.mockResolvedValue({
      data: { data: [{ id: 11, name: '技术' }] },
    })
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
