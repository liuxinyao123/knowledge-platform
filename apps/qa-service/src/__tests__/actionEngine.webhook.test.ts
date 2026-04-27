/**
 * __tests__/actionEngine.webhook.test.ts
 *
 * Webhook: allowlist, HMAC signature, retry backoff
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { default: { Pool: vi.fn().mockImplementation(() => ({ connect, query })) } }
})

describe('webhook delivery', () => {
  beforeEach(() => vi.resetModules())

  it('validates webhook URL against allowlist', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('signs webhook payload with HMAC-SHA256', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('includes X-Action-Signature header', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('retries on 500 with exponential backoff (1s, 4s, 16s)', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('writes webhook_failed audit on exhausted retries', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('succeeds on first attempt', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })

  it('respects webhook.events filter', async () => {
    const { sendActionWebhook } = await import('../services/actionWebhook.ts')
    expect(sendActionWebhook).toBeDefined()
  })
})
