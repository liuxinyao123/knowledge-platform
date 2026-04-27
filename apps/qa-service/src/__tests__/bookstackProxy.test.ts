import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { bookstackProxyRouter } from '../routes/bookstackProxy.ts'

describe('BookStack proxy', () => {
  const envSnapshot = { ...process.env }

  afterEach(() => {
    process.env = { ...envSnapshot }
  })

  it('returns 503 when server token env is missing', async () => {
    delete process.env.BOOKSTACK_TOKEN_ID
    delete process.env.BOOKSTACK_TOKEN_SECRET

    const app = express()
    app.use('/api/bookstack', bookstackProxyRouter)

    const res = await request(app).get('/api/bookstack/shelves')
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('bookstack_token_missing')
  })
})
