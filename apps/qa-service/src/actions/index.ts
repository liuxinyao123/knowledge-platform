/**
 * actions/index.ts
 *
 * Registry hub: registers the 5 built-in actions.
 * Called once at qa-service startup.
 */

import { registerAction } from '../services/actionEngine.ts'
import type { ActionContext } from '../services/actionEngine.ts'
import { rebuildAssetIndexHandler } from './rebuildAssetIndex.ts'
import { offlineAssetHandler } from './offlineAsset.ts'
import { onlineAssetHandler } from './onlineAsset.ts'
import { revokeAclRuleHandler } from './revokeAclRule.ts'
import { rebuildKgFromAssetHandler } from './rebuildKgFromAsset.ts'

export function bootstrapActions(): void {
  // rebuild_asset_index (medium risk)
  registerAction({
    name: 'rebuild_asset_index',
    description: 'Re-run vector embedding pipeline for one asset',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'number' } }, required: ['asset_id'] },
    outputSchema: { type: 'object', properties: { chunks: { type: 'number' }, duration_ms: { type: 'number' } } },
    riskLevel: 'medium',
    approvalPolicy: { required: false, approverRoles: ['admin'] },
    preconditions: { op: 'asset_status_eq', asset_id_arg: 'asset_id', value: 'online' },
    handler: rebuildAssetIndexHandler as (args: unknown, ctx: ActionContext) => Promise<unknown>,
  })

  // offline_asset (medium risk)
  registerAction({
    name: 'offline_asset',
    description: 'Soft-delete: set asset.offline = true',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['asset_id'],
    },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    riskLevel: 'medium',
    approvalPolicy: { required: true, approverRoles: ['admin'] },
    preconditions: { op: 'asset_status_eq', asset_id_arg: 'asset_id', value: 'online' },
    handler: offlineAssetHandler as (args: unknown, ctx: ActionContext) => Promise<unknown>,
  })

  // online_asset (low risk)
  registerAction({
    name: 'online_asset',
    description: 'Restore: set asset.offline = false',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'number' } }, required: ['asset_id'] },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    riskLevel: 'low',
    approvalPolicy: { required: false, approverRoles: ['admin'] },
    preconditions: { op: 'asset_status_eq', asset_id_arg: 'asset_id', value: 'offline' },
    handler: onlineAssetHandler as (args: unknown, ctx: ActionContext) => Promise<unknown>,
  })

  // revoke_acl_rule (high risk → forced approval)
  registerAction({
    name: 'revoke_acl_rule',
    description: 'Delete an ACL rule by ID',
    inputSchema: { type: 'object', properties: { rule_id: { type: 'number' } }, required: ['rule_id'] },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    riskLevel: 'high',
    approvalPolicy: { required: true, approverRoles: ['admin'] },
    handler: revokeAclRuleHandler as (args: unknown, ctx: ActionContext) => Promise<unknown>,
  })

  // rebuild_kg_from_asset (low risk)
  registerAction({
    name: 'rebuild_kg_from_asset',
    description: 'Re-run knowledge graph upsert for one asset',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'number' } }, required: ['asset_id'] },
    outputSchema: { type: 'object', properties: { nodes: { type: 'number' }, edges: { type: 'number' }, ms: { type: 'number' } } },
    riskLevel: 'low',
    approvalPolicy: { required: false, approverRoles: ['admin'] },
    handler: rebuildKgFromAssetHandler as (args: unknown, ctx: ActionContext) => Promise<unknown>,
  })
}
