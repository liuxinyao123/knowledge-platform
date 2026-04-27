import axios, { AxiosError } from 'axios'
import { SkillContext, SkillAuthError, SkillUpstreamError, SkillYaml } from '../../src/skillLoader.ts'

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface ProxyResponse {
  status: number
  body: unknown
  headers: Record<string, string>
}

export async function proxyQaService(
  req: ProxyRequest,
  ctx: SkillContext,
  yaml: SkillYaml
): Promise<ProxyResponse> {
  const baseUrl = process.env.QA_SERVICE_URL || 'http://localhost:3001'
  const timeoutMs = req.timeoutMs || 5000

  // Determine authorization header
  let authHeader: string | undefined
  const auth = yaml.auth || {}
  const forward = auth.forward !== false // default true

  if (forward && ctx.principalJwt) {
    authHeader = `Bearer ${ctx.principalJwt}`
  } else {
    const skillToken = process.env.QA_SERVICE_SKILL_TOKEN
    if (skillToken) {
      authHeader = `Bearer ${skillToken}`
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...req.headers,
  }
  if (authHeader) {
    headers.Authorization = authHeader
  }

  const url = `${baseUrl}${req.path}`
  const startTime = Date.now()

  try {
    const response = await axios({
      url,
      method: req.method,
      data: req.body,
      headers,
      timeout: timeoutMs,
      validateStatus: () => true, // Don't throw on any status
    })

    const latencyMs = Date.now() - startTime
    console.log(`[proxyQaService] ${yaml.name} ${req.method} ${req.path} ${response.status} ${latencyMs}ms`)

    // Map HTTP errors to skill errors
    if (response.status === 401) {
      throw new SkillAuthError('Unauthorized: invalid or missing credentials')
    }
    if (response.status === 403) {
      throw new SkillAuthError('Forbidden: insufficient permissions')
    }
    if (response.status >= 500) {
      throw new SkillUpstreamError(`Upstream service error: ${response.status}`)
    }

    return {
      status: response.status,
      body: response.data,
      headers: response.headers as Record<string, string>,
    }
  } catch (err) {
    if (err instanceof SkillAuthError || err instanceof SkillUpstreamError) {
      throw err
    }

    if (err instanceof AxiosError) {
      if (err.code === 'ECONNABORTED') {
        throw new SkillUpstreamError(`Request timeout after ${timeoutMs}ms`)
      }
      throw new SkillUpstreamError(`Network error: ${err.message}`)
    }

    throw err
  }
}
