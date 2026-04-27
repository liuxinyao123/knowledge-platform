/**
 * actions/revokeAclRule.ts
 *
 * Delete an ACL rule by ID and write acl_rule_audit record.
 */

import { getPgPool } from '../services/pgDb.ts'
import type { ActionContext } from '../services/actionEngine.ts'
import { ActionFatalError } from '../services/actionEngine.ts'

interface RevokeAclRuleInput {
  rule_id: number
}

interface RevokeAclRuleOutput {
  ok: boolean
}

export async function revokeAclRuleHandler(
  args: RevokeAclRuleInput,
  ctx: ActionContext,
): Promise<RevokeAclRuleOutput> {
  const pool = getPgPool()

  // Fetch rule for audit
  const { rows: ruleRows } = await pool.query(
    `SELECT id, source_id, asset_id, role, permission, condition,
            subject_type, subject_id, effect, expires_at, permission_required
     FROM metadata_acl_rule WHERE id = $1`,
    [args.rule_id],
  )

  if (ruleRows.length === 0) {
    // Idempotency: already deleted, succeed
    return { ok: true }
  }

  const rule = ruleRows[0] as Record<string, unknown>

  // Delete the rule
  await pool.query('DELETE FROM metadata_acl_rule WHERE id = $1', [args.rule_id])

  // Write acl_rule_audit
  await pool.query(
    `INSERT INTO acl_rule_audit (rule_id, actor_user_id, actor_email, op, before_json, after_json)
     VALUES ($1, $2, $3, 'DELETE', $4, NULL)`,
    [args.rule_id, ctx.principal.user_id, ctx.principal.email, JSON.stringify(rule)],
  ).catch(() => {})

  return { ok: true }
}
