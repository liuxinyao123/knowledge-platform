import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer from 'multer'
import { readFile } from 'node:fs/promises'
import { extractDocument } from '../services/ingestExtract.ts'
import { getPool } from '../services/db.ts'
import { getPgPool } from '../services/pgDb.ts'
import { registerUploadedBookstackPage } from '../services/registerUploadedPage.ts'
import { walkFolder } from '../services/folderScan.ts'
import { isEmbeddingConfigured } from '../services/embeddings.ts'
import { requireAuth, enforceAcl } from '../auth/index.ts'
import { ingestDocument, enqueueIngestJob, IngestEnqueueError } from '../services/ingestPipeline/index.ts'
import { decodeUploadedFilename } from '../services/fileName.ts'
import {
  createJob, updatePhase, finish, fail, mergePreview, appendLog,
} from '../services/jobRegistry.ts'

// ingest-async-pipeline · feature flag 辅助
function isAsyncEnabled(): boolean {
  return (process.env.INGEST_ASYNC_ENABLED ?? 'true').toLowerCase() !== 'false'
}
function asyncThresholdBytes(): number {
  const n = Number(process.env.INGEST_ASYNC_THRESHOLD_BYTES ?? 2_097_152)
  return Number.isFinite(n) && n > 0 ? n : 2_097_152
}
function wantsSync(req: Request): boolean {
  return String(req.query.sync ?? '').toLowerCase() === 'true'
}

export const ingestRouter = Router()

ingestRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    extractTextPath: 'POST /api/ingest/extract-text',
    registerIndexedPagePath: 'POST /api/ingest/register-indexed-page',
    scanFolderPath: 'POST /api/ingest/scan-folder',
    recentPath: 'GET /api/ingest/recent',
  })
})

// ── GET /api/ingest/recent —— PRD §7 最近入库历史 ──────────────────────────
// 从 audit_log 读 ingest_* / bookstack_page_create / asset_register 最近 N 条
ingestRouter.get('/recent', requireAuth(), async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number((req.query.limit as string) ?? 10)))
  try {
    const pool = getPgPool()
    const { rows } = await pool.query(
      `SELECT id, principal_email, action, target_type, target_id, detail, ts
       FROM audit_log
       WHERE action LIKE 'ingest\\_%' ESCAPE '\\'
          OR action = 'bookstack_page_create'
          OR action = 'asset_register'
       ORDER BY id DESC
       LIMIT $1`,
      [limit],
    )
    const items = rows.map((r) => {
      const detail = (r.detail as Record<string, unknown> | null) ?? {}
      return {
        id: Number(r.id),
        email: r.principal_email ?? null,
        action: String(r.action),
        target_type: r.target_type ?? null,
        target_id: r.target_id ?? null,
        at: r.ts,
        name:   typeof detail.name   === 'string' ? detail.name   : (typeof detail.filename === 'string' ? detail.filename : null),
        chunks: typeof detail.chunks === 'number' ? detail.chunks : (typeof detail.chunkCount === 'number' ? detail.chunkCount : null),
        images: typeof detail.images === 'number' ? detail.images : null,
        tags:   Array.isArray(detail.tags) ? detail.tags : null,
      }
    })
    res.json({ items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/ingest/scan-folder (SSE) ─────────────────────────────────────
// body: { path: string, recursive?: boolean, include_glob?: string[], exclude_glob?: string[], source_id?: number }
// 逐文件 emit 进度；全部完成 emit done；异常 emit error + done
ingestRouter.post(
  '/scan-folder',
  requireAuth(),
  enforceAcl({
    action: 'WRITE',
    resourceExtractor: (req) => {
      const sid = (req.body ?? {}).source_id
      return { source_id: typeof sid === 'number' ? sid : undefined }
    },
  }),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      path?: unknown
      recursive?: unknown
      include_glob?: unknown
      exclude_glob?: unknown
      source_id?: unknown
    }
    const rootPath = typeof body.path === 'string' ? body.path : ''
    if (!rootPath.trim()) {
      return res.status(400).json({ error: 'path is required' })
    }
    const sourceId = typeof body.source_id === 'number' ? body.source_id : 1
    const recursive = body.recursive !== false
    const includeGlob = Array.isArray(body.include_glob)
      ? (body.include_glob as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined
    const excludeGlob = Array.isArray(body.exclude_glob)
      ? (body.exclude_glob as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined

    if (!isEmbeddingConfigured()) {
      return res.status(503).json({ error: 'embedding not configured' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.flushHeaders()

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const emit = (evt: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(evt)}\n\n`)
      }
    }

    let scanned = 0
    let ingested = 0
    let skipped = 0
    let failed = 0
    const started = Date.now()

    emit({ type: 'scan_step', icon: '📂', label: `开始扫描：${rootPath}` })

    try {
      for await (const file of walkFolder({
        root: rootPath,
        recursive,
        includeGlob,
        excludeGlob,
      })) {
        if (ac.signal.aborted) break
        scanned++
        emit({
          type: 'file',
          status: 'processing',
          relPath: file.relPath,
          sizeBytes: file.sizeBytes,
          scanned,
        })

        try {
          const buffer = await readFile(file.absPath)
          const out = await ingestDocument({
            buffer,
            name: file.name,
            sourceId,
            principal: req.principal,
          })
          if (out.structuredChunks === 0 && out.chunks.l1 === 0 && out.chunks.l3 === 0) {
            skipped++
            emit({ type: 'file', status: 'skipped', relPath: file.relPath, reason: 'no content extracted' })
            continue
          }
          ingested++
          emit({
            type: 'file', status: 'done', relPath: file.relPath,
            assetId: out.assetId,
            extractorId: out.extractorId,
            chunks: out.chunks.l3,
            structuredChunks: out.structuredChunks,
            images: out.images,
            tags: out.tags,
          })
        } catch (err) {
          failed++
          emit({
            type: 'file', status: 'failed', relPath: file.relPath,
            error: err instanceof Error ? err.message : 'unknown',
          })
        }
      }

      emit({
        type: 'summary',
        scanned, ingested, skipped, failed,
        durationMs: Date.now() - started,
      })
      emit({ type: 'done' })
    } catch (err) {
      emit({ type: 'error', message: err instanceof Error ? err.message : 'scan failed' })
      emit({ type: 'done' })
    }
    if (!res.writableEnded) res.end()
  },
)

const maxMb = Math.min(512, Math.max(1, Number(process.env.INGEST_MAX_FILE_MB ?? 50)))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024 },
})

async function handleExtract(req: Request, res: Response, next: NextFunction) {
  try {
    const file = req.file
    if (!file?.buffer) {
      res.status(400).json({ ok: false, error: '缺少 multipart 字段 file' })
      return
    }
    const originalName = decodeUploadedFilename(file.originalname)
    const out = await extractDocument(originalName, file.buffer)
    if (out.kind === 'text') {
      const body: Record<string, unknown> = { ok: true, text: out.text }
      if (out.summary != null && String(out.summary).trim()) {
        body.summary = String(out.summary).trim()
      }
      res.json(body)
      return
    }
    res.json({ ok: true, attachmentOnly: true, hint: out.hint })
  } catch (e) {
    next(e)
  }
}

ingestRouter.post('/register-indexed-page', async (req, res, next) => {
  try {
    const pageId = Number((req.body as { pageId?: number })?.pageId)
    const summaryRaw = (req.body as { summary?: string })?.summary
    const summary =
      typeof summaryRaw === 'string' && summaryRaw.trim() ? summaryRaw.trim() : undefined
    if (!Number.isFinite(pageId) || pageId <= 0) {
      res.status(400).json({ ok: false, error: 'pageId is required' })
      return
    }
    const pool = getPool()
    const result = await registerUploadedBookstackPage(pool, pageId, { summary })
    res.json({ ok: true, ...result })
  } catch (e) {
    next(e)
  }
})

ingestRouter.post('/extract-text', (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          ok: false,
          error: `文件过大（上限 ${maxMb}MB，可用 INGEST_MAX_FILE_MB 调整）`,
        })
        return
      }
    }
    if (err) {
      next(err)
      return
    }
    void handleExtract(req, res, next)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ── 新版高层入口：直接把结果串到 jobRegistry，前端只要 poll /api/ingest/jobs/:id
// ═════════════════════════════════════════════════════════════════════════════

interface IngestOptions {
  space?: string
  sourceId?: number
  tags?: string[]
  strategy?: 'heading' | 'fixed' | 'smart'
  vectorize?: boolean
}

function parseOptions(raw: unknown): IngestOptions {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: IngestOptions = {}
  if (typeof r.space === 'string') out.space = r.space
  if (typeof r.sourceId === 'number') out.sourceId = r.sourceId
  if (Array.isArray(r.tags)) out.tags = r.tags.filter((t): t is string => typeof t === 'string')
  if (r.strategy === 'heading' || r.strategy === 'fixed' || r.strategy === 'smart') {
    out.strategy = r.strategy
  }
  if (typeof r.vectorize === 'boolean') out.vectorize = r.vectorize
  return out
}

async function runIngestAndTrack(
  jobId: string,
  buffer: Buffer,
  name: string,
  sourceId: number,
  principal: Request['principal'],
): Promise<void> {
  try {
    updatePhase(jobId, 'parse', `开始解析 ${name} (${buffer.byteLength} bytes)`)
    // ingestPipeline 是同步一口气跑完的，没法中途 emit 每一步 —— 前端看到的是 parse → done 跳变。
    // 这里用粗粒度的 phase 标记，够 UI 展示进度条；细粒度的 6 步可以看日志推断。
    updatePhase(jobId, 'ocr',   'OCR / 文本抽取')
    updatePhase(jobId, 'table', '表格提取')
    updatePhase(jobId, 'chunk', '切分')

    const out = await ingestDocument({ buffer, name, sourceId, principal })

    updatePhase(jobId, 'tag',   '标签提取')
    if (out.tags.length) {
      mergePreview(jobId, { tags: out.tags })
    }

    updatePhase(jobId, 'embed', '向量化')
    mergePreview(jobId, {
      chunks: {
        generated: out.structuredChunks,
        total: out.structuredChunks,
        avgTokens: 420,     // 占位估算；真实平均等 metadata_field.token_count 聚合
        strategy: 'heading',
      },
      images: out.images.total,
    })

    finish(jobId, { assetId: out.assetId, chunkCount: out.chunks.l1 + out.chunks.l3 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    fail(jobId, msg)
  }
}

// ── POST /api/ingest/upload-full ──────────────────────────────────────────────
// multipart: file + options (JSON string 字段)
//
// ingest-async-pipeline（2026-04-24）三个分支：
//   1. ?sync=true → 同步执行，返 200 + {sync:true, assetId, ...}（逃生 / 测试 / 老客户端）
//   2. INGEST_ASYNC_ENABLED=true（默认）→ enqueue 持久化 ingest_job，worker 消费，返 202 + {jobId}
//   3. INGEST_ASYNC_ENABLED=false → 老行为：内存 jobRegistry + void runIngestAndTrack，返 202 + {jobId}
//
// 注意：Phase B MVP 不走"小文件自动同步"——所有默认请求（无 ?sync）都返 {jobId}，保持
//       前端 `{jobId}` 合约不变。`INGEST_ASYNC_THRESHOLD_BYTES` 变量保留但暂不生效，
//       留给 Phase B2 若要加自动同步用。
ingestRouter.post(
  '/upload-full',
  requireAuth(),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `文件过大（上限 ${maxMb}MB）` })
      }
      if (err) return next(err)
      const file = req.file
      if (!file?.buffer) return res.status(400).json({ error: '缺少 file 字段' })

      let opts: IngestOptions = {}
      try {
        if (typeof req.body?.options === 'string') opts = parseOptions(JSON.parse(req.body.options))
      } catch { /* ignore, use defaults */ }

      const sourceId = opts.sourceId ?? 1
      const originalName = decodeUploadedFilename(file.originalname)
      const bytes = file.buffer
      const forceSync = wantsSync(req)
      const asyncOn = isAsyncEnabled()

      void (async () => {
        // 分支 1：?sync=true 逃生
        if (forceSync) {
          try {
            const out = await ingestDocument({
              buffer: bytes, name: originalName, sourceId, principal: req.principal,
            })
            return res.status(200).json({
              sync: true,
              assetId: out.assetId,
              chunks: out.chunks,
              structuredChunks: out.structuredChunks,
              images: out.images,
              tags: out.tags,
              extractorId: out.extractorId,
              warnings: out.warnings,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'ingest failed'
            return res.status(500).json({ sync: true, error: msg })
          }
        }

        // 分支 2：持久化队列（默认）
        if (asyncOn) {
          try {
            const { jobId } = await enqueueIngestJob(
              { buffer: bytes, name: originalName, sourceId, principal: req.principal },
              {
                kind: 'upload',
                createdBy: req.principal?.email ?? 'system',
                space: opts.space ?? '默认空间',
                persistOpts: false,
              },
            )
            return res.status(202).json({ jobId, ingest_status: 'queued', sync: false })
          } catch (e) {
            const msg = e instanceof IngestEnqueueError ? e.message : (e as Error).message
            // eslint-disable-next-line no-console
            console.warn(`[ingest] enqueue failed, fallback to in-memory: ${msg}`)
            // fallthrough to 分支 3
          }
        }

        // 分支 3：INGEST_ASYNC_ENABLED=false 或 enqueue 失败的回退
        const job = createJob({
          kind: 'upload',
          name: originalName,
          space: opts.space ?? '默认空间',
          sourceId,
          tags: opts.tags,
          strategy: opts.strategy ?? 'heading',
          vectorize: opts.vectorize ?? true,
          createdBy: req.principal?.email ?? 'system',
        })
        void runIngestAndTrack(job.id, bytes, originalName, sourceId, req.principal)
        return res.status(202).json({
          jobId: job.id,
          ingest_status: 'queued',
          sync: false,
          fallback: asyncOn ? 'in-memory' : undefined,
        })
      })()
    })
  },
)

// ── POST /api/ingest/fetch-url ────────────────────────────────────────────────
// body: { url, options? }
// 抓 HTML → 清洗成纯文本 → 当作 .md 喂 ingestDocument
ingestRouter.post(
  '/fetch-url',
  requireAuth(),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { url?: unknown; options?: unknown }
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'url must be http(s)' })
    }
    const opts = parseOptions(body.options)
    const sourceId = opts.sourceId ?? 1
    const asyncOn = isAsyncEnabled()

    // ingest-async-pipeline (ADR-40 §Follow-up #3 · 2026-04-25)：
    // 先同步 fetch（200-500ms）拿到 buffer，再决定走持久化队列还是老内存路径。
    // 失败在 fetch 阶段就 4xx/5xx 返回，比之前"返 202 + 后台 fail" 更诚实。
    let buffer: Buffer
    let title: string
    try {
      const resp = await fetch(url, {
        headers: { 'user-agent': 'knowledge-platform-ingest/1.0' },
        redirect: 'follow',
      })
      if (!resp.ok) {
        return res.status(502).json({ error: `upstream HTTP ${resp.status}` })
      }
      const contentType = resp.headers.get('content-type') ?? ''
      const raw = await resp.text()
      const text = contentType.includes('html') ? stripHtml(raw) : raw
      if (text.trim().length < 20) {
        return res.status(422).json({ error: '抓取内容过少（<20 字）' })
      }
      title = extractTitle(raw) ?? url
      const markdown = `# ${title}\n\n来源: ${url}\n\n${text}`
      buffer = Buffer.from(markdown, 'utf8')
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'fetch failed' })
    }

    const name = `${title}.md`

    // 持久化队列分支
    if (asyncOn) {
      try {
        const { jobId } = await enqueueIngestJob(
          { buffer, name, sourceId, principal: req.principal },
          {
            kind: 'fetch-url',
            createdBy: req.principal?.email ?? 'system',
            space: opts.space ?? '默认空间',
            persistOpts: false,
          },
        )
        return res.status(202).json({ jobId, ingest_status: 'queued', sync: false })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ingest/fetch-url] enqueue failed, fallback to in-memory:', (e as Error).message)
      }
    }

    // 内存 fallback
    const job = createJob({
      kind: 'fetch-url',
      name: url,
      space: opts.space ?? '默认空间',
      sourceId,
      tags: opts.tags,
      strategy: opts.strategy ?? 'heading',
      vectorize: opts.vectorize ?? true,
      createdBy: req.principal?.email ?? 'system',
    })
    res.status(202).json({ jobId: job.id, ingest_status: 'queued', sync: false, fallback: 'in-memory' })
    void runIngestAndTrack(job.id, buffer, name, sourceId, req.principal)
  },
)

// ── POST /api/ingest/conversation ─────────────────────────────────────────────
// body: { title, messages: [{role, text}], options? }
ingestRouter.post(
  '/conversation',
  requireAuth(),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      title?: unknown
      messages?: unknown
      options?: unknown
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '对话沉淀'
    const messagesRaw = Array.isArray(body.messages) ? body.messages : []
    const messages = messagesRaw.map((m) => {
      const mm = (m ?? {}) as { role?: unknown; text?: unknown; content?: unknown }
      const role = typeof mm.role === 'string' ? mm.role : 'user'
      const txt = typeof mm.text === 'string' ? mm.text : typeof mm.content === 'string' ? mm.content : ''
      return { role, text: txt }
    }).filter((m) => m.text.trim().length > 0)
    if (messages.length === 0) {
      return res.status(400).json({ error: 'messages required (non-empty [{role,text}])' })
    }

    const opts = parseOptions(body.options)
    const sourceId = opts.sourceId ?? 1
    const asyncOn = isAsyncEnabled()

    // ingest-async-pipeline (ADR-40 §Follow-up #3 · 2026-04-25)：
    // 构建 markdown buffer 是纯本地操作，立即可得；之后走持久化队列或内存 fallback。
    const md = [`# ${title}`, '']
    for (const m of messages) {
      md.push(`## ${m.role === 'assistant' ? '助手' : m.role === 'system' ? '系统' : '用户'}`)
      md.push('')
      md.push(m.text)
      md.push('')
    }
    const buffer = Buffer.from(md.join('\n'), 'utf8')
    const name = `${title}.md`

    if (asyncOn) {
      try {
        const { jobId } = await enqueueIngestJob(
          { buffer, name, sourceId, principal: req.principal },
          {
            kind: 'conversation',
            createdBy: req.principal?.email ?? 'system',
            space: opts.space ?? '默认空间',
            persistOpts: false,
          },
        )
        return res.status(202).json({ jobId, ingest_status: 'queued', sync: false })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ingest/conversation] enqueue failed, fallback to in-memory:', (e as Error).message)
      }
    }

    const job = createJob({
      kind: 'conversation',
      name: title,
      space: opts.space ?? '默认空间',
      sourceId,
      tags: opts.tags,
      strategy: opts.strategy ?? 'heading',
      vectorize: opts.vectorize ?? true,
      createdBy: req.principal?.email ?? 'system',
    })
    res.status(202).json({ jobId: job.id, ingest_status: 'queued', sync: false, fallback: 'in-memory' })
    void runIngestAndTrack(job.id, buffer, name, sourceId, req.principal)
  },
)

// Helpers ────────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  // 简化版：去 script/style、剩余标签、解码常见 HTML 实体
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  return m[1].trim().replace(/\s+/g, ' ').slice(0, 200) || null
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
ingestRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : 'extract failed'
  res.status(400).json({ ok: false, error: msg })
})
