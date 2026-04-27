/**
 * actions/offlineAsset.ts
 *
 * Soft-delete: set asset.offline = true
 */

import { getPgPool } from '../services/pgDb.ts'
import type { ActionContext } from '../services/actionEngine.ts'
import { ActionFatalError } from '../services/actionEngine.ts'

interface OfflineAssetInput {
  asset_id: number
  reason?: string
}

interface OfflineAssetOutput {
  ok: boolean
}

export async function offlineAssetHandler(
  args: OfflineAssetInput,
  ctx: ActionContext,
): Promise<OfflineAssetOutput> {
  const pool = getPgPool()

  // Verify asset exists
  const { rows: assetRows } = await pool.query(
    'SELECT id, offline FROM metadata_asset WHERE id = $1',
    [args.asset_id],
  )

  if (assetRows.length === 0) {
    throw new ActionFatalError('asset_not_found', `Asset ${args.asset_id} not found`)
  }

  // Idempotency: if already offline, succeed
  const asset = assetRows[0] as { id: number; offline: boolean }
  if (asset.offline) {
    return { ok: true }
  }

  // Set offline
  await pool.query(
    'UPDATE metadata_asset SET offline = true, updated_at = NOW() WHERE id = $1',
    [args.asset_id],
  )

  return { ok: true }
}
