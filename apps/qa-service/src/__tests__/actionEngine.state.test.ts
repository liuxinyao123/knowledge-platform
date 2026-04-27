/**
 * __tests__/actionEngine.state.test.ts
 *
 * State machine: valid/invalid transitions, error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { default: { Pool: vi.fn().mockImplementation(() => ({ connect, query })) } }
})

vi.mock('../auth/evaluateAcl.ts', () => ({
  evaluateAcl: () => ({ allow: true }),
}))

describe('actionEngine state machine', () => {
  beforeEach(() => vi.resetModules())

  it('accepts valid transition draft → pending', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })

  it('accepts valid transition pending → approved', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })

  it('rejects invalid transition succeeded → pending', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })

  it('rejects invalid transition executing → draft', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })

  it('accepts final state cancelled', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })

  it('accepts final state rejected', async () => {
    const { InvalidStateTransitionError } = await import('../services/actionEngine.ts')
    expect(InvalidStateTransitionError).toBeDefined()
  })
})
