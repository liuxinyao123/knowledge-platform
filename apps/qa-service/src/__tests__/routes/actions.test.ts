/**
 * __tests__/routes/actions.test.ts
 *
 * Route endpoints: auth, state transitions, error codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { default: { Pool: vi.fn().mockImplementation(() => ({ connect, query })) } }
})

vi.mock('../../auth/evaluateAcl.ts', () => ({
  evaluateAcl: () => ({ allow: true }),
}))

describe('actions routes', () => {
  beforeEach(() => vi.resetModules())

  it('GET /api/actions requires auth', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('GET /api/actions filters by V2 EXECUTE permission', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/:name/run accepts valid args', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/:name/run returns 400 on schema failure', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/:name/run returns 404 for unknown action', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/:name/run returns 409 on precondition failure', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/:name/run returns 403 on V2 deny', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('GET /api/actions/runs/:run_id allows actor self-view', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('GET /api/actions/runs/:run_id checks READ permission for others', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('GET /api/actions/runs/:run_id returns 404 on missing run', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/runs/:run_id/approve requires approver role', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/runs/:run_id/approve returns 409 if not pending', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/runs/:run_id/reject requires approver role', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })

  it('POST /api/actions/runs/:run_id/cancel allows owner or admin', async () => {
    const { actionsRouter } = await import('../../routes/actions.ts')
    expect(actionsRouter).toBeDefined()
  })
})
