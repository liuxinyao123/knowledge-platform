import { describe, it, expect, vi } from 'vitest'
import { loadAllSkills } from '../../../src/skillLoader.ts'
import path from 'path'

vi.mock('../../../skills/_lib/backendProxy.ts', () => ({
  proxyQaService: vi.fn(async (req, ctx) => ({
    status: 200,
    body: {
      run_id: 'r1',
      state: 'pending',
    },
    headers: {},
  })),
}))

describe('action.execute', () => {
  it('has correct input/output schema', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.execute')

    expect(skill).toBeDefined()
    expect(skill?.description).toContain('Action')

    const inputSchema = skill?.inputSchema as any
    expect(inputSchema?.required).toContain('action_name')
    expect(inputSchema?.required).toContain('args')

    const outputSchema = skill?.outputSchema as any
    expect(outputSchema?.required).toContain('run_id')
    expect(outputSchema?.required).toContain('state')
  })

  it('has audit level set to detail', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.execute')

    expect(skill?.manifest.audit?.level).toBe('detail')
  })

  it('reason field is optional', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.execute')

    const inputSchema = skill?.inputSchema as any
    expect(inputSchema?.required).not.toContain('reason')
  })

  it('state enum has correct values', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'action.execute')

    const outputSchema = skill?.outputSchema as any
    const stateEnum = outputSchema?.properties?.state?.enum
    expect(stateEnum).toEqual(['pending', 'executing', 'succeeded', 'failed'])
  })
})
