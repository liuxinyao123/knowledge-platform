/**
 * OpenAI 兼容的 Embeddings HTTP API（官方 OpenAI、硅基流动 SiliconFlow 等均可）。
 *
 * 不配密钥时：向量索引与同步不可用，RAG 会自动回退 BookStack 搜索。
 *
 * 硅基流动示例：
 *   EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
 *   EMBEDDING_API_KEY=sk-...
 *   （可不写 OPENAI_EMBEDDING_MODEL，将默认使用 Qwen/Qwen3-Embedding-8B）
 *   亦可显式：OPENAI_EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
 *
 * 仍兼容仅设置 OPENAI_API_KEY（走官方 https://api.openai.com/v1）。
 */
function embeddingsEndpoint(): string {
  const base = (
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.SILICONFLOW_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
  return `${base}/embeddings`
}

export function embeddingApiKey(): string {
  return (
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.SILICONFLOW_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ''
  )
}

export function isEmbeddingConfigured(): boolean {
  return Boolean(embeddingApiKey())
}

/** 用于 /health 展示（不含密钥） */
export function embeddingsBaseUrlForHealth(): string {
  return (
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.SILICONFLOW_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
}

/** 用户显式配置的 Base URL（不含未设置时的 api.openai.com 兜底） */
function embeddingBaseUrlForModelDefault(): string {
  return (
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.SILICONFLOW_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    ''
  )
}

const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_SILICONFLOW_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B'

/** 实际请求嵌入接口时使用的模型名（健康检查与 embed 共用） */
export function resolvedEmbeddingModel(): string {
  const explicit = process.env.OPENAI_EMBEDDING_MODEL?.trim()
  if (explicit) return explicit
  if (embeddingBaseUrlForModelDefault().toLowerCase().includes('siliconflow')) {
    return DEFAULT_SILICONFLOW_EMBEDDING_MODEL
  }
  return DEFAULT_OPENAI_EMBEDDING_MODEL
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const key = embeddingApiKey()
  if (!key) {
    throw new Error('未配置嵌入 API 密钥：请设置 EMBEDDING_API_KEY 或 OPENAI_API_KEY')
  }

  const model = resolvedEmbeddingModel()
  const batchSize = Math.min(128, Math.max(1, Number(process.env.EMBED_BATCH_SIZE ?? 64)))
  const url = embeddingsEndpoint()

  const all: number[][] = []
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: batch }),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Embeddings API 失败: ${res.status} ${errText}`)
    }
    const data = (await res.json()) as {
      data: { index: number; embedding: number[] }[]
    }
    const sorted = [...data.data].sort((a, b) => a.index - b.index)
    for (const row of sorted) all.push(row.embedding)
  }
  return all
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
