import { describe, it, expect, vi } from 'vitest'
import { loadAllSkills } from '../../../src/skillLoader.ts'
import path from 'path'

vi.mock('../../../skills/_lib/backendProxy.ts', () => ({
  proxyQaService: vi.fn(async (req, ctx) => ({
    status: 200,
    body: {
      run_id: 'r1',
      state: 'succeeded',
      attempts: 1,
    },
    headers: {},
  })),
}))

describe('action.status', () => {
  it('has correct input/output schema', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.status')

    expect(skill).toBeDefined()

    const inputSchema = skill?.inputSchema as any
    expect(inputSchema?.required).toContain('run_id')

    const outputSchema = skill?.outputSchema as any
    expect(outputSchema?.required).toContain('run_id')
    expect(outputSchema?.required).toContain('state')
    expect(outputSchema?.required).toContain('attempts')
  })

  it('state field has correct enum values', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.status')

    const outputSchema = skill?.outputSchema as any
    const stateEnum = outputSchema?.properties?.state?.enum
    expect(stateEnum).toEqual(['pending', 'executing', 'succeeded', 'failed'])
  })

  it('optional fields are not required', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.status')

    const outputSchema = skill?.outputSchema as any
    expect(outputSchema?.required).not.toContain('last_error')
    expect(outputSchema?.required).not.toContain('audit_log_id')
  })
})
