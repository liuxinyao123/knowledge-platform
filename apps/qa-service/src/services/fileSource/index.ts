/**
 * services/fileSource/index.ts —— 对外入口
 *
 * runScan(sourceId, signal?)       —— 执行一次完整 scan（listFiles + fetch + ingest + cursor save）
 * testConnection(sourceId)         —— 试连（不入库、不改 cursor）；返回 {ok, sample|error}
 * SYSTEM_PRINCIPAL                  —— scan 入库时的身份（从 types.ts re-export）
 */
import { getPgPool } from '../pgDb.ts'
import { ingestDocument } from '../ingestPipeline/index.ts'
import { makeAdapter } from './factory.ts'
import { decryptConfig } from './crypto.ts'
import { withSourceLock, isScanRunning } from './lock.ts'
import type {
  FileSourceAdapter, FileSourceType, FileSourceDescriptor, ListCursor,
} from './types.ts'
import { FileSourceClosed, MasterEncryptKeyMissing, SYSTEM_PRINCIPAL } from './types.ts'

export { SYSTEM_PRINCIPAL } from './types.ts'
export { isScanRunning } from './lock.ts'

interface SourceRow {
  id: number
  type: FileSourceType
  name: string
  config_json: Record<string, unknown>
  cron: string
  last_cursor: ListCursor | null
  last_scan_status: string | null
  last_scan_error: string | null
  last_scan_at: Date | null
  permission_source_id: number | null
  enabled: boolean
}

interface ScanOutcome {
  status: 'ok' | 'partial' | 'error'
  added: number
  updated: number
  removed: number
  failed: Array<{ id: string; error: string }>
  errorMessage: string | null
}

export async function runScan(sourceId: number, signal?: AbortSignal): Promise<ScanOutcome> {
  return withSourceLock(sourceId, () => runScanImpl(sourceId, signal))
}

async function runScanImpl(sourceId: number, signal?: AbortSignal): Promise<ScanOutcome> {
  const pool = getPgPool()
  const row = await loadSourceRow(sourceId)
  if (!row) return { status: 'error', added: 0, updated: 0, removed: 0, failed: [], errorMessage: 'source_not_found' }
  if (!row.enabled) return { status: 'error', added: 0, updated: 0, removed: 0, failed: [], errorMessage: 'source_disabled' }
  if (row.permission_source_id == null) {
    await writeScanLog(sourceId, 'error', 0, 0, 0, [], 'permission_source_id_missing')
    return { status: 'error', added: 0, updated: 0, removed: 0, failed: [], errorMessage: 'permission_source_id_missing' }
  }

  const scanLogId = await startScanLog(sourceId)
  const cursor: ListCursor = row.last_cursor ?? { lastScanAt: null, seenIds: [] }

  let adapter: FileSourceAdapter | null = null
  try {
    adapter = makeAdapter(row.type)
    const plainConfig = decryptConfig(row.config_json)
    await adapter.init(plainConfig)

    if (signal?.aborted) throw new FileSourceClosed()
    const listResult = await adapter.listFiles(cursor)

    const failed: Array<{ id: string; error: string }> = []
    let addedCount = 0, updatedCount = 0

    for (const d of [...listResult.added, ...listResult.updated]) {
      if (signal?.aborted) break
      try {
        const fetched = await adapter.fetchFile(d.id)
        await ingestDocument({
          buffer: fetched.buffer,
          name: fetched.descriptor.name,
          sourceId: row.permission_source_id,
          principal: SYSTEM_PRINCIPAL,
          opts: {
            externalId: d.id,
            externalPath: d.path,
            mtime: d.mtime,
            fileSourceId: sourceId,
          },
        })
        if (listResult.added.some((a: FileSourceDescriptor) => a.id === d.id)) addedCount++
        else updatedCount++
      } catch (err) {
        failed.push({ id: d.id, error: (err as Error).message?.slice(0, 500) ?? 'unknown' })
      }
    }

    let removedCount = 0
    for (const goneId of listResult.removed) {
      try {
        await markAssetOffline(sourceId, goneId)
        removedCount++
      } catch (err) {
        failed.push({ id: goneId, error: (err as Error).message?.slice(0, 500) ?? 'unknown' })
      }
    }

    if (signal?.aborted) {
      await writeScanLog(sourceId, 'error', addedCount, updatedCount, removedCount, failed, 'aborted', scanLogId)
      await pool.query(
        `UPDATE metadata_file_source SET last_scan_status = 'error', last_scan_error = $1, last_scan_at = NOW() WHERE id = $2`,
        ['aborted', sourceId],
      )
      return { status: 'error', added: addedCount, updated: updatedCount, removed: removedCount, failed, errorMessage: 'aborted' }
    }

    const status: ScanOutcome['status'] =
      failed.length === 0 ? 'ok'
        : (addedCount + updatedCount > 0) ? 'partial' : 'error'

    await pool.query(
      `UPDATE metadata_file_source
         SET last_cursor = $1::jsonb,
             last_scan_status = $2,
             last_scan_error = NULL,
             last_scan_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(listResult.nextCursor), status, sourceId],
    )
    await writeScanLog(sourceId, status, addedCount, updatedCount, removedCount, failed, null, scanLogId)

    return { status, added: addedCount, updated: updatedCount, removed: removedCount, failed, errorMessage: null }
  } catch (err) {
    const msg = err instanceof MasterEncryptKeyMissing
      ? 'master_encrypt_key_missing'
      : (err as Error).message ?? 'unknown'
    await pool.query(
      `UPDATE metadata_file_source SET last_scan_status = 'error', last_scan_error = $1, last_scan_at = NOW() WHERE id = $2`,
      [msg.slice(0, 500), sourceId],
    )
    await writeScanLog(sourceId, 'error', 0, 0, 0, [], msg, scanLogId)
    return { status: 'error', added: 0, updated: 0, removed: 0, failed: [], errorMessage: msg }
  } finally {
    try { await adapter?.close() } catch { /* best effort */ }
  }
}

export async function testConnection(sourceId: number): Promise<
  { ok: true; sample: FileSourceDescriptor[] } | { ok: false; error_code: string; message: string }
> {
  const row = await loadSourceRow(sourceId)
  if (!row) return { ok: false, error_code: 'source_not_found', message: `no source id=${sourceId}` }
  let adapter: FileSourceAdapter | null = null
  try {
    adapter = makeAdapter(row.type)
    const plainConfig = decryptConfig(row.config_json)
    await adapter.init(plainConfig)
    const r = await adapter.listFiles({ lastScanAt: null, seenIds: [] })
    const sample = r.added.slice(0, 5)
    return { ok: true, sample }
  } catch (err) {
    const name = (err as Error).name
    const code =
      name === 'FileSourceAuthError'     ? 'auth_failed'
    : name === 'FileSourceNetworkError'  ? 'network_unreachable'
    : name === 'FileSourceProtocolError' ? 'protocol_error'
    : name === 'InvalidFileSourceConfig' ? 'invalid_config'
    : name === 'MasterEncryptKeyMissing' ? 'master_encrypt_key_missing'
    : 'test_failed'
    return { ok: false, error_code: code, message: (err as Error).message ?? 'unknown' }
  } finally {
    try { await adapter?.close() } catch { /* best effort */ }
  }
}

export async function loadSourceRow(sourceId: number): Promise<SourceRow | null> {
  const pool = getPgPool()
  const { rows } = await pool.query<SourceRow>(
    `SELECT id, type, name, config_json, cron, last_cursor, last_scan_status,
            last_scan_error, last_scan_at, permission_source_id, enabled
     FROM metadata_file_source WHERE id = $1`,
    [sourceId],
  )
  return rows[0] ?? null
}

async function markAssetOffline(fileSourceId: number, externalId: string): Promise<void> {
  const pool = getPgPool()
  await pool.query(
    `UPDATE metadata_asset
       SET offline = true, updated_at = NOW()
     WHERE file_source_id = $1 AND external_id = $2`,
    [fileSourceId, externalId],
  )
}

async function startScanLog(sourceId: number): Promise<number> {
  const pool = getPgPool()
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO file_source_scan_log (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [sourceId],
  )
  return Number(rows[0].id)
}

async function writeScanLog(
  sourceId: number,
  status: 'ok' | 'partial' | 'error',
  added: number, updated: number, removed: number,
  failed: Array<{ id: string; error: string }>,
  errorMessage: string | null,
  existingLogId?: number,
): Promise<void> {
  const pool = getPgPool()
  if (existingLogId) {
    await pool.query(
      `UPDATE file_source_scan_log
         SET finished_at = NOW(),
             status = $2,
             added_count = $3,
             updated_count = $4,
             removed_count = $5,
             failed_items = $6::jsonb,
             error_message = $7
       WHERE id = $1`,
      [existingLogId, status, added, updated, removed, JSON.stringify(failed), errorMessage],
    )
  } else {
    await pool.query(
      `INSERT INTO file_source_scan_log
         (source_id, started_at, finished_at, status, added_count, updated_count, removed_count, failed_items, error_message)
       VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6::jsonb, $7)`,
      [sourceId, status, added, updated, removed, JSON.stringify(failed), errorMessage],
    )
  }
}
