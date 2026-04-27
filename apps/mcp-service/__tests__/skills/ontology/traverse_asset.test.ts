import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAllSkills } from '../../../src/skillLoader.ts'
import path from 'path'

vi.mock('../../../skills/_lib/backendProxy.ts', () => ({
  proxyQaService: vi.fn(async (req, ctx) => ({
    status: 200,
    body: {
      entities: [
        { id: 'e1', name: 'Entity 1' },
        { id: 'e2', name: 'Entity 2' },
      ],
      edges: [{ source: 'e1', target: 'e2', type: 'relates_to' }],
      meta: { hop_depth: 1, fallback: false },
    },
    headers: {},
  })),
}))

describe('ontology.traverse_asset', () => {
  it('returns entities and edges from QA service', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'ontology.traverse_asset')

    expect(skill).toBeDefined()
    expect(skill?.description).toContain('Ontology Context')
  })

  it('passes asset_id to backend proxy', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'ontology.traverse_asset')

    expect(skill?.inputSchema).toHaveProperty('properties.asset_id')
  })

  it('has correct output schema', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'ontology.traverse_asset')

    const outputSchema = skill?.outputSchema as any
    expect(outputSchema?.required).toContain('entities')
    expect(outputSchema?.required).toContain('edges')
  })

  it('max_hop has default of 2', async () => {
    const skillsDir = path.resolve(__dirname, '../../../skills')
    const skills = await loadAllSkills(skillsDir)
    const skill = skills.find((s) => s.name === 'ontology.traverse_asset')

    const inputSchema = skill?.inputSchema as any
    expect(inputSchema?.properties?.max_hop?.default).toBe(2)
    expect(inputSchema?.properties?.max_hop?.maximum).toBe(2)
    expect(inputSchema?.properties?.max_hop?.minimum).toBe(1)
  })
})
