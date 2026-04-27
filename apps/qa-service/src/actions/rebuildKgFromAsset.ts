/**
 * actions/rebuildKgFromAsset.ts
 *
 * Re-run knowledge graph upsert for one asset.
 * Calls into knowledgeGraph service.
 */

import { getPgPool } from '../services/pgDb.ts'
import type { ActionContext } from '../services/actionEngine.ts'
import { ActionFatalError } from '../services/actionEngine.ts'

interface RebuildKgFromAssetInput {
  asset_id: number
}

interface RebuildKgFromAssetOutput {
  nodes: number
  edges: number
  ms: number
}

export async function rebuildKgFromAssetHandler(
  args: RebuildKgFromAssetInput,
  ctx: ActionContext,
): Promise<RebuildKgFromAssetOutput> {
  const startMs = Date.now()
  const pool = getPgPool()

  // Verify asset exists
  const { rows: assetRows } = await pool.query(
    'SELECT id, content FROM metadata_asset WHERE id = $1',
    [args.asset_id],
  )

  if (assetRows.length === 0) {
    throw new ActionFatalError('asset_not_found', `Asset ${args.asset_id} not found`)
  }

  const asset = assetRows[0] as { id: number; content: string }

  // TODO: Call into knowledgeGraph service to upsert
  // For MVP, just return mock stats
  // In production: const result = await knowledgeGraphService.upsertAsset(asset.id, asset.content)

  // Mock: simulate 10 nodes and 5 edges
  const nodes = 10
  const edges = 5
  const ms = Date.now() - startMs

  return { nodes, edges, ms }
}
