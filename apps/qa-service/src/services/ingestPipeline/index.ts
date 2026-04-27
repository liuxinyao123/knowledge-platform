/**
 * ingestPipeline/index.ts —— 所有 ingest 入口的单一桥梁
 *
 * 使用：
 *   await ingestDocument({ buffer, name, sourceId, principal })
 *
 * 流程：
 *   1. 按扩展名路由 extractor
 *   2. extractor 返 ExtractResult
 *   3. pipeline 统一写库 / embed / tags / images
 *   4. 返 IngestOutput
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { routeExtractor } from './router.ts'
import { runPipeline } from './pipeline.ts'
import type { IngestInput, IngestOutput } from './types.ts'
import type { PipelineProgress } from './pipeline.ts'
import { getPgPool } from '../pgDb.ts'
import { createJob, fail as failJob, type JobKind } from '../jobRegistry.ts'

export type {
  ChunkKind, Bbox, ExtractedChunk, ExtractedImage, ExtractorId,
  ExtractResult, Extractor, IngestInput, IngestOutput,
} from './types.ts'
export type { PipelineProgress, PipelineProgressEvent, PipelinePhase } from './pipeline.ts'
export { routeExtractor, isKnownExt } from './router.ts'

export async function ingestDocument(
  input: IngestInput,
  progress?: PipelineProgress,
): Promise<IngestOutput> {
  const extractor = routeExtractor(input.name)
  const result = await extractor.extract(input.buffer, input.name)

  // 若路由到 plaintext 但扩展名是未知的，追加 warning 以供调用方可观测
  const maybeExt = (input.name.split('.').pop() || '').toLowerCase()
  const knownHinted = [
    'pdf', 'docx', 'pptx', 'ppt', 'xlsx', 'xls',
    'md', 'markdown', 'html', 'htm', 'txt', 'csv',
    'png', 'jpg', 'jpeg',
  ]
  if (!knownHinted.includes(maybeExt)) {
    result.warnings = [...result.warnings, `unknown extension .${maybeExt}, fallback to plaintext`]
  }

  return runPipeline(input, result, progress)
}

// ── ingest-async-pipeline · 异步入口 ─────────────────────────────────────────

/**
 * 异步入库：把 bytes 落档 tmp → 登记 ingest_job + 内存 jobRegistry → 返回 job_id。
 *
 * 调用方（`routes/ingest.ts` 等）应在 `INGEST_ASYNC_ENABLED=true` 且请求大小超过
 * `INGEST_ASYNC_THRESHOLD_BYTES` 时走这里；否则继续调 `ingestDocument` 同步路径。
 *
 * bytes_ref 存到 `os.tmpdir()/ingest-<jobId>`。worker 在 runIngestJob 时读取并在结束
 * （成功/失败/取消）后清理。OS 重启后 tmp 可能被清空 —— worker 需要检测文件缺失并
 * 把 job 标 failed（由 ingestWorker.ts 负责）。
 *
 * 失败路径：写 tmp 失败 → 把已创建的 job 标 failed；抛 `IngestEnqueueError`。
 */
export class IngestEnqueueError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = 'IngestEnqueueError'
  }
}

export interface EnqueueOptions {
  kind?: JobKind
  /** 发起者 email（异步 SSE 鉴权用）；缺省 'system' */
  createdBy?: string
  /** UI 展示的 space 名（仅显示，不影响 ACL）；缺省空字符串 */
  space?: string
  /** 透传 input.opts 到 ingest_job.input_payload，worker 重建 IngestInput 时复原 */
  persistOpts?: boolean
}

export interface EnqueueResult {
  jobId: string
  bytesRef: string
}

export async function enqueueIngestJob(
  input: IngestInput,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  // 1) 登记 job（内存 + DB INSERT via jobRegistry.dbInsertJob）
  const job = createJob({
    kind: opts.kind ?? 'upload',
    name: input.name,
    space: opts.space ?? '',
    sourceId: input.sourceId,
    createdBy: opts.createdBy ?? 'system',
  })

  // 2) bytes 落档 tmp（worker 取走后负责删）
  const bytesRef = pathJoin(tmpdir(), `ingest-${job.id}`)
  try {
    await fs.writeFile(bytesRef, input.buffer)
  } catch (err) {
    const msg = (err as Error).message
    failJob(job.id, `write tmp failed: ${msg}`)
    throw new IngestEnqueueError(`无法暂存入库文件: ${msg}`, 'TMP_WRITE_FAILED')
  }

  // 3) UPSERT ingest_job 含 bytes_ref + input_payload
  //
  // 修复（2026-04-26 · ADR-34 v2）：之前是 UPDATE WHERE id=$1，但 createJob 内部
  //   dbInsertJob 是 fire-and-forget，UPDATE 可能在 INSERT 之前到达 DB → rowCount=0
  //   静默失败 → row 永远 bytes_ref=NULL stuck。
  //
  // 改成 INSERT ... ON CONFLICT (id) DO UPDATE：
  //   - 我的 INSERT 先到 → 建立完整 row（含 bytes_ref）；createJob 那边晚到的 INSERT 走自己的 ON CONFLICT DO NOTHING
  //   - createJob INSERT 先到 → 我的 INSERT 走 ON CONFLICT，UPDATE bytes_ref + input_payload
  // 不论顺序，row 必含 bytes_ref。
  const initialPayload = {
    space: opts.space ?? '',
    opts: opts.persistOpts ? input.opts ?? null : null,
    principalEmail: input.principal?.email ?? null,
    tags: [],
    strategy: 'heading',
    vectorize: true,
  }
  try {
    await getPgPool().query(
      `INSERT INTO ingest_job
         (id, kind, source_id, name, input_payload, status, phase, progress, log, preview, created_by, bytes_ref)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', 'pending', 0, '[]'::jsonb, '{}'::jsonb, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         bytes_ref     = EXCLUDED.bytes_ref,
         input_payload = ingest_job.input_payload || EXCLUDED.input_payload,
         updated_at    = NOW()`,
      [
        job.id,
        opts.kind ?? 'upload',
        input.sourceId,
        input.name,
        JSON.stringify(initialPayload),
        opts.createdBy ?? 'system',
        bytesRef,
      ],
    )
  } catch (err) {
    // DB 真挂了：清 tmp + 标失败
    await fs.unlink(bytesRef).catch(() => {})
    failJob(job.id, `ingest_job upsert failed: ${(err as Error).message}`)
    throw new IngestEnqueueError(
      `登记 ingest_job 失败: ${(err as Error).message}`,
      'DB_UPDATE_FAILED',
    )
  }

  return { jobId: job.id, bytesRef }
}
