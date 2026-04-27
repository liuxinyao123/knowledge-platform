import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

// Lazy load optional dependencies
let yamlLoaded: any = null
async function getYaml() {
  if (!yamlLoaded) {
    try {
      // @ts-ignore - dynamic import
      const mod = await import('js-yaml')
      yamlLoaded = mod.default || mod
    } catch (err) {
      console.error('Failed to load js-yaml:', err)
      // Fallback YAML parser
      return {
        load: (content: string) => {
          throw new Error('js-yaml not available and no fallback parser implemented')
        },
      }
    }
  }
  return yamlLoaded
}

// Glob implementation using fs.promises
async function globFiles(pattern: string): Promise<string[]> {
  const baseDir = pattern.split('**')[0] || '.'
  const files: string[] = []

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (fullPath.endsWith('.skill.yaml')) {
          files.push(fullPath)
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await walk(baseDir)
  return files
}

// ============ Error Types ============

export class SkillError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillError'
  }
}

export class SkillManifestError extends SkillError {
  name = 'SkillManifestError'
}

export class SkillDuplicateError extends SkillError {
  name = 'SkillDuplicateError'
}

export class SkillTemplateError extends SkillError {
  name = 'SkillTemplateError'
}

export class SkillAuthError extends SkillError {
  name = 'SkillAuthError'
}

export class SkillUpstreamError extends SkillError {
  name = 'SkillUpstreamError'
}

export class SkillComposeNotImplementedError extends SkillError {
  name = 'SkillComposeNotImplementedError'
}

// ============ Types ============

export interface SkillContext {
  principalJwt?: string
  requestId: string
}

export interface LoadedSkill {
  name: string
  version: number
  description: string
  inputSchema: unknown
  outputSchema: unknown
  handler: (input: unknown, ctx: SkillContext) => Promise<unknown>
  manifest: SkillYaml
  muxToolName: string // The actual MCP tool name (legacy_tool_name or name)
}

export interface SkillYaml {
  name: string
  version: number
  description: string
  category?: string
  stability?: 'stable' | 'beta' | 'deprecated'
  legacy_tool_name?: string
  input: unknown
  output: unknown
  backend: {
    kind: 'http' | 'hook' | 'compose'
    method?: string
    path?: string
    body?: unknown
    response?: { map?: unknown }
    compose?: unknown
  }
  auth?: {
    forward?: boolean
    required_principal?: string
  }
  audit?: {
    level?: string
  }
}

// ============ Template Engine ============

interface TemplateContext {
  input: unknown
  response?: unknown
}

function parseTemplate(template: string, ctx: TemplateContext): unknown {
  // Match {{ ... }} patterns
  const match = template.match(/^{{\s*(.*)\s*}}$/)
  if (!match) return template

  const expr = match[1].trim()

  // Check for unsupported syntax
  if (expr.includes('if ') || expr.includes('for ') || expr.includes('while ')) {
    throw new SkillTemplateError(`Template conditionals/loops not supported: ${expr}`)
  }

  // Handle default filter: {{ x | default: y }}
  if (expr.includes('|')) {
    const [variable, filterPart] = expr.split('|').map((s) => s.trim())
    if (filterPart.startsWith('default:')) {
      const defaultVal = filterPart.slice('default:'.length).trim()
      const resolved = resolvePath(variable, ctx)
      if (resolved === undefined || resolved === null) {
        return JSON.parse(defaultVal)
      }
      return resolved
    }
  }

  // Pure variable reference: {{ input.x }} or {{ response.y }}
  if (/^[a-zA-Z0-9._\[\]]+$/.test(expr)) {
    return resolvePath(expr, ctx)
  }

  // JSON literal: {{ [{...}] }} or {{ {...} }}
  if (expr.startsWith('[') || expr.startsWith('{')) {
    try {
      return JSON.parse(expr)
    } catch {
      throw new SkillTemplateError(`Invalid JSON literal in template: ${expr}`)
    }
  }

  throw new SkillTemplateError(`Unsupported template expression: ${expr}`)
}

function resolvePath(path: string, ctx: TemplateContext): unknown {
  const parts = path.split(/[\.\[\]]/).filter((p) => p !== '')
  let val: any = ctx

  for (const part of parts) {
    if (val === null || val === undefined) return undefined
    val = val[part]
  }

  return val
}

function processValue(val: unknown, ctx: TemplateContext): unknown {
  if (typeof val === 'string' && val.includes('{{')) {
    return parseTemplate(val, ctx)
  }
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) {
      return val.map((v) => processValue(v, ctx))
    }
    const result: any = {}
    for (const [k, v] of Object.entries(val)) {
      result[k] = processValue(v, ctx)
    }
    return result
  }
  return val
}

// ============ Skill Loader ============

export async function loadAllSkills(rootDir: string): Promise<LoadedSkill[]> {
  const skillFiles = await globFiles(path.join(rootDir, '**/*.skill.yaml'))
  const skills: LoadedSkill[] = []
  const seen = new Set<string>()

  for (const file of skillFiles) {
    try {
      const yaml = await loadSkillYaml(file)
      validateSkillYaml(yaml, file)

      if (seen.has(yaml.name)) {
        throw new SkillDuplicateError(`Duplicate skill name: ${yaml.name}`)
      }
      seen.add(yaml.name)

      const muxToolName = yaml.legacy_tool_name || yaml.name

      let handler: (input: unknown, ctx: SkillContext) => Promise<unknown>

      if (yaml.backend.kind === 'hook') {
        handler = await createHookHandler(file, yaml)
      } else if (yaml.backend.kind === 'http') {
        handler = createHttpHandler(yaml)
      } else if (yaml.backend.kind === 'compose') {
        handler = () => {
          throw new SkillComposeNotImplementedError('Compose backend not yet implemented')
        }
      } else {
        throw new SkillManifestError(`Unknown backend kind: ${yaml.backend.kind}`)
      }

      skills.push({
        name: yaml.name,
        version: yaml.version,
        description: yaml.description,
        inputSchema: yaml.input,
        outputSchema: yaml.output,
        handler,
        manifest: yaml,
        muxToolName,
      })
    } catch (err) {
      if (err instanceof SkillError && err.name === 'SkillManifestError') {
        throw err
      }
      if (err instanceof SkillError && err.name === 'SkillDuplicateError') {
        throw err
      }
      if (err instanceof SkillError && err.name === 'SkillComposeNotImplementedError') {
        throw err
      }
      // Hook import failure: warn and skip
      if (err instanceof SkillError && err.message.includes('hook import failed')) {
        console.warn(`[skillLoader] WARN skip ${path.basename(file)}: hook import failed`)
        continue
      }
      throw err
    }
  }

  return skills
}

async function loadSkillYaml(file: string): Promise<SkillYaml> {
  const content = await fs.readFile(file, 'utf-8')
  const yamlLib = await getYaml()
  const parsed = yamlLib.load(content)
  return parsed as SkillYaml
}

function validateSkillYaml(yaml: unknown, file: string): asserts yaml is SkillYaml {
  const schema = z.object({
    name: z.string(),
    version: z.number(),
    description: z.string(),
    category: z.string().optional(),
    stability: z.enum(['stable', 'beta', 'deprecated']).optional(),
    legacy_tool_name: z.string().optional(),
    input: z.unknown(),
    output: z.unknown(),
    backend: z.object({
      kind: z.enum(['http', 'hook', 'compose']),
      method: z.string().optional(),
      path: z.string().optional(),
      body: z.unknown().optional(),
      response: z.object({ map: z.unknown().optional() }).optional(),
      compose: z.unknown().optional(),
    }),
    auth: z
      .object({
        forward: z.boolean().optional(),
        required_principal: z.string().optional(),
      })
      .optional(),
    audit: z
      .object({
        level: z.string().optional(),
      })
      .optional(),
  })

  const result = schema.safeParse(yaml)
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    throw new SkillManifestError(`Invalid skill manifest in ${file}: ${errors}`)
  }
}

async function createHookHandler(
  file: string,
  yaml: SkillYaml
): Promise<(input: unknown, ctx: SkillContext) => Promise<unknown>> {
  const hookPath = file.replace(/\.skill\.yaml$/, '.hook.ts')
  try {
    const hookModule = await import(hookPath)
    const run = hookModule.run

    if (typeof run !== 'function') {
      throw new SkillError('hook import failed: exported run is not a function')
    }

    return async (input: unknown, ctx: SkillContext) => {
      try {
        return await run(input, ctx)
      } catch (err) {
        throw new SkillError(`Hook execution failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    throw new SkillError('hook import failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}

function createHttpHandler(yaml: SkillYaml): (input: unknown, ctx: SkillContext) => Promise<unknown> {
  return async (input: unknown, ctx: SkillContext) => {
    // Lazy load proxy module
    // @ts-ignore - dynamic import
    const backendProxy = await import('./skills/_lib/backendProxy.ts')
    const { proxyQaService } = backendProxy

    const templateCtx: TemplateContext = { input }

    // Process request body
    const body = yaml.backend.body ? processValue(yaml.backend.body, templateCtx) : undefined

    // Prepare proxy request
    const req = {
      method: (yaml.backend.method || 'POST') as 'GET' | 'POST' | 'PATCH',
      path: yaml.backend.path || '',
      body,
    }

    // Call proxy
    const response = await proxyQaService(req, ctx, yaml)
    templateCtx.response = response.body

    // Process response mapping
    if (yaml.backend.response?.map) {
      return processValue(yaml.backend.response.map, templateCtx)
    }

    return response.body
  }
}

// ============ MCP Registration ============

/**
 * Convert a (subset of) JSON Schema "object" schema into a ZodRawShape
 * (Record<string, ZodTypeAny>) that MCP SDK's `server.tool()` accepts.
 *
 * Supports: type=string|number|integer|boolean|object|array, `properties`,
 * `required`, `items`, `default`, `description`, `enum`. Nested objects and
 * arrays are handled. Anything else degrades to `z.any()` rather than throwing —
 * MCP will still accept the call and the skill handler can validate further.
 */
function jsonSchemaObjectToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  if (!schema || typeof schema !== 'object') return shape
  const s = schema as { type?: string; properties?: Record<string, unknown>; required?: string[] }
  if (s.type !== 'object' || !s.properties) return shape
  const required = new Set(Array.isArray(s.required) ? s.required : [])
  for (const [key, propSchema] of Object.entries(s.properties)) {
    let zodType = jsonSchemaToZod(propSchema)
    if (!required.has(key)) zodType = zodType.optional()
    shape[key] = zodType
  }
  return shape
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any()
  const s = schema as {
    type?: string
    properties?: Record<string, unknown>
    items?: unknown
    enum?: unknown[]
    default?: unknown
    description?: string
    required?: string[]
  }

  let t: z.ZodTypeAny
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    // z.enum needs string literals; fall back to z.union if mixed
    const allStrings = s.enum.every((v) => typeof v === 'string')
    t = allStrings
      ? z.enum(s.enum as [string, ...string[]])
      : z.union(s.enum.map((v) => z.literal(v as never)) as any)
  } else {
    switch (s.type) {
      case 'string':
        t = z.string()
        break
      case 'number':
      case 'integer':
        t = z.number()
        break
      case 'boolean':
        t = z.boolean()
        break
      case 'array':
        t = z.array(jsonSchemaToZod(s.items))
        break
      case 'object':
        t = z.object(jsonSchemaObjectToZodShape(s))
        break
      default:
        t = z.any()
    }
  }

  if (s.description) t = t.describe(s.description)
  if (s.default !== undefined) t = t.default(s.default as never)
  return t
}

export function registerAll(server: McpServer, skills: LoadedSkill[]): void {
  for (const skill of skills) {
    const paramsShape = jsonSchemaObjectToZodShape(skill.inputSchema)
    server.tool(
      skill.muxToolName,
      skill.description,
      paramsShape,
      async (input: unknown) => {
        const ctx: SkillContext = {
          requestId: crypto.randomUUID?.() || Math.random().toString(36),
        }

        try {
          const result = await skill.handler(input, ctx)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const code =
            err instanceof SkillAuthError
              ? 'unauthorized'
              : err instanceof SkillUpstreamError
                ? 'upstream_error'
                : 'skill_runtime_error'

          return {
            isError: true,
            content: [{ type: 'text' as const, text: message }],
          }
        }
      }
    )
  }
}

// ============ Schema Generation ============

export async function buildMcpSchema(skills: LoadedSkill[]): Promise<unknown> {
  return {
    name: 'knowledge-mcp',
    version: '1.0.0',
    description: '知识中台 MCP 服务',
    tools: skills.map((skill) => ({
      name: skill.muxToolName,
      description: skill.description,
      inputSchema: skill.inputSchema,
    })),
  }
}
