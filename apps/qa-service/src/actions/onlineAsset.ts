/**
 * actions/onlineAsset.ts
 *
 * Restore: set asset.offline = false
 */

import { getPgPool } from '../services/pgDb.ts'
import type { ActionContext } from '../services/actionEngine.ts'
import { ActionFatalError } from '../services/actionEngine.ts'

interface OnlineAssetInput {
  asset_id: number
}

interface OnlineAssetOutput {
  ok: boolean
}

export async function onlineAssetHandler(
  args: OnlineAssetInput,
  ctx: ActionContext,
): Promise<OnlineAssetOutput> {
  const pool = getPgPool()

  // Verify asset exists
  const { rows: assetRows } = await pool.query(
    'SELECT id, offline FROM metadata_asset WHERE id = $1',
    [args.asset_id],
  )

  if (assetRows.length === 0) {
    throw new ActionFatalError('asset_not_found', `Asset ${args.asset_id} not found`)
  }

  // Idempotency: if already online, succeed
  const asset = assetRows[0] as { id: number; offline: boolean }
  if (!asset.offline) {
    return { ok: true }
  }

  // Set online
  await pool.query(
    'UPDATE metadata_asset SET offline = false, updated_at = NOW() WHERE id = $1',
    [args.asset_id],
  )

  return { ok: true }
}
