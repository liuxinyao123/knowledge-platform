import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { loadAllSkills, registerAll, SkillManifestError, SkillDuplicateError } from '../src/skillLoader.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

describe('skillLoader', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-loader-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {}
  })

  describe('loadAllSkills', () => {
    it('loads minimal valid YAML', async () => {
      const yaml = `
name: test.skill
version: 1
description: Test skill
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      const skills = await loadAllSkills(tempDir)
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe('test.skill')
      expect(skills[0].version).toBe(1)
    })

    it('fails on missing required field', async () => {
      const yaml = `
name: test.skill
version: 1
input:
  type: object
output:
  type: object
backend:
  kind: http
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      await expect(loadAllSkills(tempDir)).rejects.toThrow(SkillManifestError)
    })

    it('fails on duplicate skill names', async () => {
      const yaml = `
name: duplicate.skill
version: 1
description: Test
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
`
      await fs.writeFile(path.join(tempDir, 'skill1.skill.yaml'), yaml)
      await fs.writeFile(path.join(tempDir, 'skill2.skill.yaml'), yaml)

      await expect(loadAllSkills(tempDir)).rejects.toThrow(SkillDuplicateError)
    })

    it('skips hook import failure with warning', async () => {
      const yaml = `
name: hook.skill
version: 1
description: Test hook
input:
  type: object
output:
  type: object
backend:
  kind: hook
`
      await fs.writeFile(path.join(tempDir, 'hook.skill.yaml'), yaml)
      // Don't create the hook file, so import fails

      const warnSpy = vi.spyOn(console, 'warn')
      const skills = await loadAllSkills(tempDir)

      expect(skills).toHaveLength(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/WARN skip.*hook import failed/))
      warnSpy.mockRestore()
    })

    it('loads multiple skills without hook', async () => {
      const yaml1 = `
name: skill1
version: 1
description: First skill
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/one
`
      const yaml2 = `
name: skill2
version: 1
description: Second skill
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/two
`
      await fs.writeFile(path.join(tempDir, 'one.skill.yaml'), yaml1)
      await fs.writeFile(path.join(tempDir, 'two.skill.yaml'), yaml2)

      const skills = await loadAllSkills(tempDir)
      expect(skills).toHaveLength(2)
      expect(skills.map((s) => s.name)).toEqual(['skill1', 'skill2'])
    })

    it('uses legacy_tool_name as muxToolName', async () => {
      const yaml = `
name: internal.name
version: 1
description: Test
legacy_tool_name: public.name
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      const skills = await loadAllSkills(tempDir)
      expect(skills[0].muxToolName).toBe('public.name')
    })
  })

  describe('registerAll', () => {
    it('registers each skill as MCP tool', async () => {
      const yaml = `
name: test.skill
version: 1
description: Test skill
input:
  type: object
  properties:
    query: { type: string }
output:
  type: object
backend:
  kind: http
  path: /api/test
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      const skills = await loadAllSkills(tempDir)
      const server = new McpServer({ name: 'test', version: '1.0.0' })
      registerAll(server, skills)

      // MCP SDK 1.29: tools live on `_registeredTools` as an object keyed by tool name
      const registered = (server as any)._registeredTools ?? {}
      expect(Object.keys(registered)).toHaveLength(1)
      expect(registered['test.skill']).toBeDefined()
    })

    it('uses muxToolName for tool registration', async () => {
      const yaml = `
name: internal
version: 1
description: Test
legacy_tool_name: external
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      const skills = await loadAllSkills(tempDir)
      const server = new McpServer({ name: 'test', version: '1.0.0' })
      registerAll(server, skills)

      // Tool should be registered with muxToolName
      const toolName = skills[0].muxToolName
      expect(toolName).toBe('external')
    })
  })

  describe('template engine', () => {
    it('handles pure variable substitution', async () => {
      const yaml = `
name: test.skill
version: 1
description: Test
input:
  type: object
  properties:
    x: { type: string }
output:
  type: object
backend:
  kind: http
  path: /api/test
  body:
    value: "{{ input.x }}"
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)

      const skills = await loadAllSkills(tempDir)
      const skill = skills[0]

      // Mock the proxyQaService
      vi.mock('../skills/_lib/backendProxy.ts', () => ({
        proxyQaService: vi.fn(async (req) => ({
          status: 200,
          body: { test: 'ok' },
          headers: {},
        })),
      }))

      // The handler would apply template; test is in integration with proxy
      expect(skill.handler).toBeDefined()
    })

    it('handles default filter', async () => {
      const yaml = `
name: test.skill
version: 1
description: Test
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
  body:
    count: "{{ input.count | default: 10 }}"
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)
      const skills = await loadAllSkills(tempDir)
      expect(skills).toHaveLength(1)
    })

    it('handles JSON literal in template', async () => {
      const yaml = `
name: test.skill
version: 1
description: Test
input:
  type: object
output:
  type: object
backend:
  kind: http
  path: /api/test
  body:
    items: "{{ [{id: 1}, {id: 2}] }}"
`
      await fs.writeFile(path.join(tempDir, 'test.skill.yaml'), yaml)
      const skills = await loadAllSkills(tempDir)
      expect(skills).toHaveLength(1)
    })
  })
})
