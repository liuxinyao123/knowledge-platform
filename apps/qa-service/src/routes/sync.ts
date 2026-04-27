import { existsSync } from 'node:fs'
import { Router } from 'express'
import { qaServiceDotenvPath } from '../envPaths.ts'
import { countIndexChunks, getLastFullSyncIso } from '../services/vectorSearch.ts'
import {
  embeddingsBaseUrlForHealth,
  isEmbeddingConfigured,
  resolvedEmbeddingModel,
} from '../services/embeddings.ts'
import { runFullSync } from '../services/syncWorker.ts'

export const syncRouter = Router()

syncRouter.get('/health', async (_req, res) => {
  try {
    const chunkCount = await countIndexChunks()
    const lastFullSync = await getLastFullSyncIso()
    const configured = isEmbeddingConfigured()
    const keyHint = {
      EMBEDDING_API_KEY: Boolean(process.env.EMBEDDING_API_KEY?.trim()),
      SILICONFLOW_API_KEY: Boolean(process.env.SILICONFLOW_API_KEY?.trim()),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }
    res.json({
      ok: true,
      embeddingsConfigured: configured,
      /** @deprecated 与 embeddingsConfigured 相同，保留兼容 */
      openaiConfigured: configured,
      embeddingsBaseUrl: embeddingsBaseUrlForHealth(),
      embeddingModel: resolvedEmbeddingModel(),
      /** 仅表示是否非空，不包含密钥内容 */
      embeddingKeyHint: keyHint,
      /** 本机应对应为 true；若为 false 多为 Docker 未挂载 apps/qa-service/.env */
      qaServiceEnvFileFound: existsSync(qaServiceDotenvPath()),
      chunkCount,
      lastFullSync,
    })
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'health failed',
    })
  }
})

/** 触发全量同步（同步执行，页面多时会较慢） */
syncRouter.post('/run', async (_req, res) => {
  try {
    const result = await runFullSync()
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'sync failed',
    })
  }
})
