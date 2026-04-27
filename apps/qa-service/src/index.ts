import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import { qaServiceDotenvPath, repoRootDotenvPath } from './envPaths.ts'
import { qaRouter } from './routes/qa.ts'
import { governanceRouter } from './routes/governance.ts'
import { bookstackProxyRouter } from './routes/bookstackProxy.ts'
import { syncRouter } from './routes/sync.ts'
import { ingestRouter } from './routes/ingest.ts'
import { ingestJobsRouter } from './routes/ingestJobs.ts'
import { evalRouter } from './routes/eval.ts'
import { notebooksRouter } from './routes/notebooks.ts'
import { teamsRouter } from './routes/teams.ts'
import { iamAclRouter } from './routes/iamAcl.ts'
import { assetDirectoryRouter } from './routes/assetDirectory.ts'
import { knowledgeRouter } from './routes/knowledge.ts'
import { knowledgeDocsRouter } from './routes/knowledgeDocs.ts'
import { aclRouter } from './routes/acl.ts'
import { agentRouter } from './routes/agent.ts'
import { authRouter } from './routes/auth.ts'
import { mcpDebugRouter, graphDebugRouter } from './routes/mcpDebug.ts'
import { fileSourceRouter } from './routes/fileSource.ts'
import { spacesRouter } from './routes/spaces.ts'
import { kgRouter } from './routes/kg.ts'
import { ontologyRouter } from './routes/ontology.ts'
import { bootScheduler as bootFileSourceScheduler, abortAllScans } from './services/fileSource/scheduler.ts'
import { tagsRouter } from './routes/governance/tags.ts'
import { duplicatesRouter } from './routes/governance/duplicates.ts'
import { qualityRouter } from './routes/governance/quality.ts'
import { auditLogRouter } from './routes/governance/auditLog.ts'
import { actionsRouter } from './routes/actions.ts'
import { insightsRouter } from './routes/insights.ts'
import { runMigrations } from './services/db.ts'
import { runPgMigrations } from './services/pgDb.ts'
import { bootstrapGraph } from './services/graphDb.ts'
import { loadRules } from './auth/evaluateAcl.ts'
import { isAuthConfigured, authMode } from './auth/verifyToken.ts'
import { checkJava } from './services/pdfPipeline/javaCheck.ts'
import {
  embeddingsBaseUrlForHealth,
  isEmbeddingConfigured,
  resolvedEmbeddingModel,
} from './services/embeddings.ts'
import { bootstrapActions } from './actions/index.ts'
import { startIngestWorker, resetInProgressJobs, type IngestWorkerHandle } from './services/ingestWorker.ts'

// qa-service/.env 优先（override），仓库根 .env 仅补全未出现的键
const qaEnv = qaServiceDotenvPath()
const rootEnv = repoRootDotenvPath()
if (existsSync(qaEnv)) {
  dotenv.config({ path: qaEnv, override: true })
}
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv })
}

const app = express()

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  }),
)
// BookStack 反向代理必须保留原始请求体流（multipart / 大文件），放在 express.json() 之前
app.use('/api/bookstack', bookstackProxyRouter)
app.use(express.json())

app.use('/api/qa', qaRouter)
app.use('/api/governance', governanceRouter)
app.use('/api/sync', syncRouter)
app.use('/api/ingest', ingestRouter)
app.use('/api/ingest/jobs', ingestJobsRouter)
app.use('/api/eval', evalRouter)
app.use('/api/notebooks', notebooksRouter)
app.use('/api/iam/teams', teamsRouter)
app.use('/api/iam/acl', iamAclRouter)
app.use('/api/asset-directory', assetDirectoryRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/knowledge', knowledgeDocsRouter)
app.use('/api/acl', aclRouter)
app.use('/api/auth', authRouter)
app.use('/api/mcp', mcpDebugRouter)
app.use('/api/graph', graphDebugRouter)
app.use('/api/file-sources', fileSourceRouter)
app.use('/api/spaces', spacesRouter)
app.use('/api/kg', kgRouter)
app.use('/api/ontology', ontologyRouter)
app.use('/api/agent', agentRouter)
app.use('/api/governance/tags', tagsRouter)
app.use('/api/governance/duplicates', duplicatesRouter)
app.use('/api/governance/quality', qualityRouter)
app.use('/api/governance', auditLogRouter)
app.use('/api/actions', actionsRouter)
app.use('/api/insights', insightsRouter)

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

const PORT = process.env.PORT ?? 3001

;(async () => {
  // 启动时 auth 配置 fail-fast（生产）
  if (process.env.NODE_ENV === 'production' && !isAuthConfigured()) {
    // eslint-disable-next-line no-console
    console.error('FATAL: no AUTH_JWKS_URL or AUTH_HS256_SECRET in production')
    process.exit(1)
  }

  await runMigrations()
  await runPgMigrations()
  // 知识图谱 sidecar（ADR 2026-04-23-27）——失败只 warn，不阻塞主服务
  await bootstrapGraph()

  // Bootstrap Action Framework
  bootstrapActions()

  // PDF Pipeline v2 启动检查
  const java = checkJava()
  if (java.ok) {
    // eslint-disable-next-line no-console
    console.log(`✓ java detected: ${java.version}`)
  } else {
    // eslint-disable-next-line no-console
    console.warn('WARN: java not found; PDF pipeline v2 will fall back to officeparser')
  }

  // Preload ACL rules（PG 表已确保存在，不会抛）
  try {
    const rules = await loadRules(true)
    // eslint-disable-next-line no-console
    console.log(`✓ ACL rules loaded: ${rules.length}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`WARN: ACL rules preload failed: ${(err as Error).message}`)
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    const emb = isEmbeddingConfigured()
    const base = embeddingsBaseUrlForHealth()
    const model = resolvedEmbeddingModel()
    // eslint-disable-next-line no-console
    console.log(
      `✓ QA service → http://localhost:${PORT} | embeddings: ${emb ? 'on' : 'off'} (${base}) model=${model} | auth=${authMode()}`,
    )
  })

  // file-source 调度器（cron 排期 + 手动触发均可用；node-cron 未装时只有手动可用）
  try {
    await bootFileSourceScheduler()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`WARN: file-source scheduler boot failed: ${(err as Error).message}`)
  }

  // ingest-async-pipeline · 异步 worker 生命周期
  //   INGEST_ASYNC_ENABLED=false 时不启动（仅同步路径 / 兼容旧部署）
  //   启动前先把上次进程遗留的 in_progress 行回滚为 queued
  let ingestWorker: IngestWorkerHandle | null = null
  const ingestAsyncEnabled = (process.env.INGEST_ASYNC_ENABLED ?? 'true').toLowerCase() !== 'false'
  if (ingestAsyncEnabled) {
    try {
      const reset = await resetInProgressJobs()
      if (reset > 0) {
        // eslint-disable-next-line no-console
        console.log(`✓ reset ${reset} stale in_progress ingest_job rows (前次进程未清理)`)
      }
      ingestWorker = startIngestWorker()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`WARN: ingest worker start failed: ${(err as Error).message}`)
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('[ingest] async disabled (INGEST_ASYNC_ENABLED=false), sync-only mode')
  }

  // SIGTERM 优雅退出：abort 正在跑的 scan + 停 ingest worker
  process.on('SIGTERM', () => {
    abortAllScans()
    if (ingestWorker) {
      ingestWorker.stop().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`WARN: ingest worker stop error: ${(err as Error).message}`)
      })
    }
  })
})()

