/**
 * services/actionPreconditions.ts
 *
 * PreconditionExpr evaluation: asset_status_eq, principal_has_role, and/or
 */

import { getPgPool } from './pgDb.ts'
import type { Principal } from '../auth/types.ts'

export interface PreconditionExpr {
  op: string
  [key: string]: unknown
}

export interface EvalResult {
  pass: boolean
  detail?: Record<string, unknown>
}

/**
 * Evaluate precondition expression tree.
 * Returns { pass: true } or { pass: false, detail: {...} }
 */
export async function evaluatePreconditions(
  expr: Record<string, unknown>,
  args: Record<string, unknown>,
  principal: Principal,
): Promise<EvalResult> {
  return evaluateExpr(expr as PreconditionExpr, args, principal)
}

async function evaluateExpr(
  expr: PreconditionExpr,
  args: Record<string, unknown>,
  principal: Principal,
): Promise<EvalResult> {
  const op = expr.op as string

  if (op === 'asset_status_eq') {
    return evaluateAssetStatusEq(expr, args)
  }

  if (op === 'principal_has_role') {
    return evaluatePrincipalHasRole(expr, principal)
  }

  if (op === 'and') {
    return evaluateAnd(expr, args, principal)
  }

  if (op === 'or') {
    return evaluateOr(expr, args, principal)
  }

  return {
    pass: false,
    detail: { error: `unknown_precondition_op:${op}` },
  }
}

async function evaluateAssetStatusEq(expr: PreconditionExpr, args: Record<string, unknown>): Promise<EvalResult> {
  const assetIdArg = expr.asset_id_arg as string
  const expectedStatus = expr.value as string

  const assetId = args[assetIdArg]
  if (assetId === undefined || assetId === null) {
    return {
      pass: false,
      detail: { op: 'asset_status_eq', error: `missing_arg:${assetIdArg}` },
    }
  }

  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT offline FROM metadata_asset WHERE id = $1`,
    [assetId],
  )

  if (rows.length === 0) {
    return {
      pass: false,
      detail: { op: 'asset_status_eq', error: `asset_not_found:${assetId}` },
    }
  }

  const isOffline = (rows[0] as any).offline ?? false
  const actualStatus = isOffline ? 'offline' : 'online'

  if (actualStatus !== expectedStatus) {
    return {
      pass: false,
      detail: {
        op: 'asset_status_eq',
        expected: expectedStatus,
        actual: actualStatus,
      },
    }
  }

  return { pass: true }
}

async function evaluatePrincipalHasRole(expr: PreconditionExpr, principal: Principal): Promise<EvalResult> {
  const roles = expr.roles as string[]
  if (!roles || roles.length === 0) {
    return {
      pass: false,
      detail: { op: 'principal_has_role', error: 'missing_roles' },
    }
  }

  const hasRole = roles.some((r) => principal.roles.includes(r))
  if (!hasRole) {
    return {
      pass: false,
      detail: { op: 'principal_has_role', required: roles, actual: principal.roles },
    }
  }

  return { pass: true }
}

async function evaluateAnd(
  expr: PreconditionExpr,
  args: Record<string, unknown>,
  principal: Principal,
): Promise<EvalResult> {
  const all = expr.all as PreconditionExpr[]
  if (!all || !Array.isArray(all)) {
    return {
      pass: false,
      detail: { op: 'and', error: 'missing_all' },
    }
  }

  for (const subExpr of all) {
    const result = await evaluateExpr(subExpr, args, principal)
    if (!result.pass) {
      return result
    }
  }

  return { pass: true }
}

async function evaluateOr(
  expr: PreconditionExpr,
  args: Record<string, unknown>,
  principal: Principal,
): Promise<EvalResult> {
  const any = expr.any as PreconditionExpr[]
  if (!any || !Array.isArray(any)) {
    return {
      pass: false,
      detail: { op: 'or', error: 'missing_any' },
    }
  }

  for (const subExpr of any) {
    const result = await evaluateExpr(subExpr, args, principal)
    if (result.pass) {
      return { pass: true }
    }
  }

  return {
    pass: false,
    detail: { op: 'or', error: 'all_branches_failed' },
  }
}
