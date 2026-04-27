/**
 * OpenAI 兼容 LLM 客户端（硅基流动 / OpenAI / 任何兼容服务）
 *
 * 环境变量（按优先级）：
 *   LLM_API_KEY           → 专用 LLM key（可不设，自动复用 SILICONFLOW/EMBEDDING key）
 *   SILICONFLOW_API_KEY   → 硅基流动 key（兼容 embedding 与 LLM）
 *   EMBEDDING_API_KEY     → 向量 key 复用
 *   OPENAI_API_KEY        → OpenAI 官方 key
 *
 *   LLM_BASE_URL          → 默认 https://api.siliconflow.cn/v1
 *   LLM_MODEL             → 主力模型，默认 Qwen/Qwen2.5-72B-Instruct
 *   LLM_FAST_MODEL        → 快速/分级模型，默认 Qwen/Qwen2.5-7B-Instruct
 */

/**
 * OpenAI 兼容的内容块（支持视觉模型时使用）。
 * - 普通文本继续直接传 string；
 * - 视觉调用传 ContentBlock[]：text + image_url 混排。
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | ContentBlock[]
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type OAITool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export function getLlmKey(): string {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.SILICONFLOW_API_KEY?.trim() ||
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ''
  )
}

export function isLlmConfigured(): boolean {
  return Boolean(getLlmKey())
}

export function getLlmModel(): string {
  return process.env.LLM_MODEL?.trim() || 'Qwen/Qwen2.5-72B-Instruct'
}

export function getLlmFastModel(): string {
  return process.env.LLM_FAST_MODEL?.trim() || 'Qwen/Qwen2.5-7B-Instruct'
}

function getLlmBaseUrl(): string {
  return (
    process.env.LLM_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.SILICONFLOW_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    'https://api.siliconflow.cn/v1'
  ).replace(/\/+$/, '')
}

async function llmFetch(body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(`${getLlmBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getLlmKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 400)}`)
  }
  return res
}

/** 单次对话补全，支持 tool calling */
export async function chatComplete(
  messages: ChatMessage[],
  opts?: {
    model?: string
    maxTokens?: number
    system?: string
    tools?: OAITool[]
    toolChoice?: unknown
    /** 结构化输出强制；'json_object' 等价 OpenAI response_format（硅基兼容） */
    responseFormat?: 'json_object' | { type: string; [k: string]: unknown }
    /** 0..2，默认 1.0；摘要类任务建议 0.2 拉低发散 */
    temperature?: number
  },
): Promise<{ content: string | null; toolCalls: ToolCall[]; rawMessage: ChatMessage }> {
  const allMessages: ChatMessage[] = opts?.system
    ? [{ role: 'system', content: opts.system }, ...messages]
    : messages

  const body: Record<string, unknown> = {
    model: opts?.model ?? getLlmModel(),
    messages: allMessages,
    max_tokens: opts?.maxTokens ?? 1024,
  }
  if (opts?.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  if (opts?.responseFormat !== undefined) {
    body.response_format = typeof opts.responseFormat === 'string'
      ? { type: opts.responseFormat }
      : opts.responseFormat
  }
  if (opts?.temperature !== undefined) {
    body.temperature = opts.temperature
  }

  const res = await llmFetch(body)
  const data = (await res.json()) as {
    choices: [{ message: { role: string; content: string | null; tool_calls?: ToolCall[] } }]
  }
  const msg = data.choices[0].message
  return {
    content: msg.content ?? null,
    toolCalls: msg.tool_calls ?? [],
    rawMessage: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls },
  }
}

/** 流式对话，逐 token yield */
export async function* chatStream(
  messages: ChatMessage[],
  opts?: { model?: string; maxTokens?: number; system?: string },
): AsyncGenerator<string> {
  const allMessages: ChatMessage[] = opts?.system
    ? [{ role: 'system', content: opts.system }, ...messages]
    : messages

  const res = await llmFetch({
    model: opts?.model ?? getLlmModel(),
    messages: allMessages,
    max_tokens: opts?.maxTokens ?? 2000,
    stream: true,
  })

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let yielded = 0     // rag-relevance-hygiene · D3
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          // D3 · 空流守护：收到 [DONE] 但完全没 yield 过 content → 显式错误
          if (yielded === 0) {
            throw new Error(
              'LLM stream returned no content chunks (upstream returned empty stream or closed immediately)',
            )
          }
          return
        }
        try {
          const chunk = JSON.parse(payload) as {
            choices: [{ delta: { content?: string | null } }]
          }
          const text = chunk.choices[0]?.delta?.content
          if (text) { yielded++; yield text }
        } catch { /* ignore malformed SSE lines */ }
      }
    }
    // 到这说明 reader done 但没收到 [DONE]；若没 yield 则同样视为异常 close
    if (yielded === 0) {
      throw new Error(
        'LLM stream returned no content chunks (upstream closed without [DONE])',
      )
    }
  } catch (e) {
    // 空流错误原样冒泡；其他（reader abort / 解析挂等）归一化为 interrupted
    if (e instanceof Error && e.message.startsWith('LLM stream returned no content')) throw e
    throw new Error(`LLM stream interrupted: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }
}
