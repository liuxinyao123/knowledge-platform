/**
 * ingestPipeline/pipeline.ts —— 公共后处理
 *
 * 职责：
 *   1. INSERT metadata_asset
 *   2. 落档图片 + 写 metadata_asset_image（带 caption）
 *   3. 写 metadata_field（kind / page / bbox / heading_path / image_id）
 *   4. embed 可 embed 级的 chunks
 *   5. extractTags + update indexed_at
 */
import type pg from 'pg'
import { getPgPool } from '../pgDb.ts'
import { embedTexts } from '../embeddings.ts'
import { extractTags } from '../tagExtract.ts'
import { isBadChunk, type BadChunkReason } from '../textHygiene.ts'
import {
  persistImages, updateImageCaption,
  type PdfImage,
} from '../pdfPipeline/index.ts'
import { writeAudit } from '../audit.ts'
import { upsertAsset, upsertSource, linkSourceAsset, setAssetTags } from '../knowledgeGraph.ts'
import type {
  ExtractResult, ExtractedImage, IngestInput, IngestOutput,
} from './types.ts'

const EMBED_KINDS = new Set(['paragraph', 'table', 'image_caption', 'generic'])

function chunkLevel(kind: string): 1 | 3 {
  return kind === 'heading' ? 1 : 3
}

function toPdfImage(img: ExtractedImage): PdfImage {
  return {
    page: img.page ?? 1,
    index: img.index,
    bbox: img.bbox,
    fileName: `${img.page ?? 1}-${img.index}.${img.ext}`,
    ext: img.ext,
    bytes: img.bytes,
  }
}

/**
 * ingest-async-pipeline · phase 进度回调
 *
 * Worker 把 DB 写入 hook 传进来；老同步调用方传 undefined 时全部 no-op。
 * phase 值对齐 `services/jobRegistry.ts:JobPhase` 细粒度枚举（parse/ocr/chunk/embed/tag）
 * 以及 `ingest_job.phase` 列的词汇。
 */
export type PipelinePhase = 'parse' | 'chunk' | 'tag' | 'embed' | 'abstract' | 'done'

export interface PipelineProgressEvent {
  phase: PipelinePhase
  /** 0-100；与 jobRegistry PHASE_WEIGHT 对齐 */
  progress: number
  msg?: string
}

export type PipelineProgress = (event: PipelineProgressEvent) => void

// runPipeline 自己不直接访问 jobRegistry（避免循环依赖）。以下权重只用于推导 progress 数值，
// 真正的 jobRegistry.PHASE_WEIGHT 仍是前端显示的真相源。
const PIPELINE_PHASE_PROGRESS: Record<PipelinePhase, number> = {
  parse: 10,
  chunk: 60,
  tag: 75,
  embed: 95,
  abstract: 98,
  done: 100,
}

function emitProgress(
  progress: PipelineProgress | undefined,
  phase: PipelinePhase,
  msg?: string,
): void {
  if (!progress) return
  try {
    progress({ phase, progress: PIPELINE_PHASE_PROGRESS[phase], msg })
  } catch {
    // progress 回调异常不得影响主 pipeline
  }
}

export async function runPipeline(
  input: IngestInput,
  result: ExtractResult,
  progress?: PipelineProgress,
): Promise<IngestOutput> {
  const pool = getPgPool()
  const start = Date.now()

  // pipeline 进入时即报 parse 完成（上游 extractor 已跑完才调 runPipeline）
  emitProgress(progress, 'parse', 'extractor finished, starting persistence')

  // 1) metadata_asset
  //    · 无 fileSourceId：老行为，每次 INSERT 一条新 asset（手动上传 / BookStack sync）
  //    · 有 fileSourceId + externalId：按 (file_source_id, external_id) UPSERT —— 同一外部文件 mtime 变只更不新建
  let assetId: number
  const ext = input.opts
  if (ext?.fileSourceId != null && ext.externalId) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO metadata_asset
         (source_id, name, type, content, updated_at,
          external_id, external_path, source_mtime, offline, file_source_id)
       VALUES ($1, $2, 'document', $3, NOW(), $4, $5, $6, false, $7)
       ON CONFLICT (file_source_id, external_id)
         WHERE file_source_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           content = EXCLUDED.content,
           external_path = EXCLUDED.external_path,
           source_mtime = EXCLUDED.source_mtime,
           offline = false,
           updated_at = NOW()
       RETURNING id`,
      [
        input.sourceId,
        input.name,
        result.fullText,
        ext.externalId,
        ext.externalPath ?? null,
        ext.mtime ?? null,
        ext.fileSourceId,
      ],
    )
    assetId = Number(row.id)
    // UPSERT 命中更新路径时，老的 chunks / images 需要清掉后重抽取（避免残留）
    await pool.query(`DELETE FROM metadata_field       WHERE asset_id = $1`, [assetId])
    await pool.query(`DELETE FROM metadata_asset_image WHERE asset_id = $1`, [assetId])
  } else {
    const { rows: [row] } = await pool.query(
      `INSERT INTO metadata_asset (source_id, name, type, content, updated_at)
       VALUES ($1, $2, 'document', $3, NOW())
       RETURNING id`,
      [input.sourceId, input.name, result.fullText],
    )
    assetId = Number(row.id)
  }

  // 2) 图片落档 + caption 回写 metadata_asset_image
  //    key = `${page}|${index}` → imageId
  const imageKeyToId = new Map<string, number>()
  let withCaption = 0
  if (result.images.length) {
    const pdfImages = result.images.map(toPdfImage)
    const persisted = await persistImages(pool, assetId, pdfImages)
    for (const p of persisted) {
      imageKeyToId.set(`${p.page}|${p.index}`, p.imageId)
    }
    // caption 回写
    for (const img of result.images) {
      if (!img.caption) continue
      const id = imageKeyToId.get(`${img.page ?? 1}|${img.index}`)
      if (id != null) {
        await updateImageCaption(pool, id, img.caption)
        withCaption++
      }
    }
  }

  // 3) + 4) metadata_field
  emitProgress(progress, 'chunk', 'writing metadata_field + embedding')
  let countL1 = 0, countL3 = 0
  await writeFields(pool, assetId, result, imageKeyToId, {
    onCount: (level) => { if (level === 1) countL1++; else countL3++ },
  })

  // 5) tags + indexed_at + 提取诊断（ADR-32）
  emitProgress(progress, 'tag', 'extracting tags (LLM if text is long enough)')
  //    短文本（< 200 字）不值得调 LLM；否则每个小文件都多花 ~5s
  const shouldTag =
    !input.opts?.skipTags
    && result.fullText.trim().length >= 200
  const tags = shouldTag
    ? await extractTags(result.fullText, { assetName: input.name })
    : []

  // chunks 分类统计：{ heading: 1, paragraph: 3, ... }
  const chunksByKind: Record<string, number> = {}
  for (const c of result.chunks) {
    chunksByKind[c.kind] = (chunksByKind[c.kind] ?? 0) + 1
  }
  const warningsJson = result.warnings.length ? JSON.stringify(result.warnings) : null

  await pool.query(
    `UPDATE metadata_asset
       SET indexed_at = NOW(),
           tags = $2,
           extractor_id = $3,
           ingest_warnings = $4,
           ingest_chunks_by_kind = $5
     WHERE id = $1`,
    [assetId, tags, result.extractorId, warningsJson, JSON.stringify(chunksByKind)],
  )

  const out: IngestOutput = {
    assetId,
    chunks: { l1: countL1, l2: 0, l3: countL3 },
    structuredChunks: result.chunks.length,
    images: { total: result.images.length, withCaption },
    tags,
    extractorId: result.extractorId,
    warnings: result.warnings.length ? result.warnings : undefined,
  }

  // 可观测日志
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({
    event: 'ingest_done',
    assetId,
    extractorId: result.extractorId,
    duration_ms: Date.now() - start,
    chunks: out.chunks,
    structuredChunks: out.structuredChunks,
    images: out.images,
    tagsCount: tags.length,
    warningsCount: result.warnings.length,
  }))

  // 审计日志（PRD §17.5 强制）
  await writeAudit({
    action: 'ingest_done',
    targetType: 'asset',
    targetId: assetId,
    detail: {
      extractorId: result.extractorId,
      name: input.name,
      sourceId: input.sourceId,
      chunks: out.chunks,
      structuredChunks: out.structuredChunks,
      imagesTotal: out.images.total,
      duration_ms: Date.now() - start,
    },
    principal: input.principal,
  })

  // 知识图谱写入（ADR 2026-04-23-27 · fire-and-forget；KG 不可用时自动 no-op）
  //   把本次 ingest 产出的 asset + source + tags 投射到 Apache AGE 图谱
  ;(async () => {
    try {
      // source 节点（只用 id/name；name 在没拿到时先占位）
      await upsertSource({ id: input.sourceId, name: `source#${input.sourceId}` })
      await upsertAsset({ id: assetId, name: input.name, type: 'document' })
      await linkSourceAsset(input.sourceId, assetId)
      if (tags.length) await setAssetTags(assetId, tags)
    } catch {
      // KG 失败静默；主路径已完成
    }
  })()

  // ingest-l0-abstract（ADR-32 候选 · 2026-04-26）
  //   embed 之后批量生成 L0/L1 摘要并落 chunk_abstract
  //   L0_GENERATE_ENABLED=false 时 generateAbstractsForAsset 内部 no-op
  //   失败计数会进 ingest_done 日志，单 chunk 失败不阻断 ingest
  emitProgress(progress, 'abstract', 'generating L0/L1 abstracts')
  let abstractCounters = { generated: 0, failed: 0, skipped: 0 }
  try {
    const { generateAbstractsForAsset } = await import('./abstract.ts')
    abstractCounters = await generateAbstractsForAsset(assetId, pool)
  } catch (err) {
    console.warn('[abstract] phase failed (non-fatal):', (err as Error).message)
  }
  // 把 abstract 计数补进 out（ingest_done 日志已经在前面 emit；这里只挂 metadata 回 out 给调用方）
  // 注意：out 是 IngestOutput，外部约定只看核心字段；新计数走 ingest_phase 日志即可
  console.log(JSON.stringify({
    event: 'abstract_done',
    asset_id: assetId,
    generated: abstractCounters.generated,
    failed: abstractCounters.failed,
    skipped: abstractCounters.skipped,
  }))

  emitProgress(progress, 'done', `asset_id=${assetId} chunks=${countL1 + countL3}`)
  return out
}

async function writeFields(
  pool: pg.Pool,
  assetId: number,
  result: ExtractResult,
  imageKeyToId: Map<string, number>,
  hooks: { onCount: (level: 1 | 3) => void },
): Promise<void> {
  // rag-relevance-hygiene · C · chunk gate
  // 标记每个 chunk 是否该跳过。L3（embed 粒度）走 isBadChunk 判断；L1（顶层摘要/标题）不过滤。
  const skipFlags: Array<null | BadChunkReason> = result.chunks.map((c) => {
    if (chunkLevel(c.kind) !== 3) return null
    const v = isBadChunk(c.text)
    return v.bad ? (v.reason ?? 'too_short') : null
  })

  // 收集需要 embed 的 chunks（按顺序，但跳过 bad chunk）
  const toEmbed: string[] = []
  for (let i = 0; i < result.chunks.length; i++) {
    const c = result.chunks[i]
    if (skipFlags[i]) continue
    if (EMBED_KINDS.has(c.kind)) toEmbed.push(c.text)
  }
  const embeddings = toEmbed.length ? await embedTexts(toEmbed) : []

  const filterReasons: Record<string, number> = {}
  let embedIdx = 0
  for (let i = 0; i < result.chunks.length; i++) {
    const c = result.chunks[i]
    const skipReason = skipFlags[i]
    if (skipReason) {
      filterReasons[skipReason] = (filterReasons[skipReason] ?? 0) + 1
      continue   // 不 INSERT
    }
    const level = chunkLevel(c.kind)
    const embedding = EMBED_KINDS.has(c.kind) ? embeddings[embedIdx++] ?? null : null

    let imageId: number | null = null
    if (c.kind === 'image_caption' && c.imageRefIndex) {
      imageId = imageKeyToId.get(`${c.imageRefIndex.page}|${c.imageRefIndex.index}`) ?? null
      // 向后兼容：pdfExtractor 给的 index=0（表示"该页第一张"）时按 page 首个图找
      if (imageId == null && c.imageRefIndex.index === 0) {
        for (const [key, id] of imageKeyToId.entries()) {
          const [p] = key.split('|')
          if (Number(p) === c.imageRefIndex.page) { imageId = id; break }
        }
      }
    }

    await pool.query(
      `INSERT INTO metadata_field
         (asset_id, chunk_index, chunk_level, content, embedding, token_count,
          page, kind, bbox, heading_path, image_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        assetId,
        i,
        level,
        c.text,
        embedding ? `[${embedding.join(',')}]` : null,
        Math.ceil(c.text.length / 1.5),
        c.page ?? null,
        c.kind,
        c.bbox ? JSON.stringify(c.bbox) : null,
        c.headingPath ?? null,
        imageId,
      ],
    )
    hooks.onCount(level)
  }

  const totalFiltered = Object.values(filterReasons).reduce((a, b) => a + b, 0)
  if (totalFiltered > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[ingest] filtered ${totalFiltered} bad chunks (asset=${assetId}):`,
      filterReasons,
    )
  }
}
