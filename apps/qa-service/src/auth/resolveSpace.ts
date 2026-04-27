/**
 * auth/resolveSpace.ts —— space-permissions 资源 → 空间 id 解析
 *
 * 作用：`evaluateAcl` 在过滤规则前，把 resource 上的 source_id / asset_id
 *      解析成资源归属的 space_id 集合；`space_source` 是真相源。
 *
 * Feature flag：`SPACE_PERMS_ENABLED=0` 时始终返回空集 → 等价 V2 老行为。
 *
 * 契约：openspec/changes/space-permissions/specs/space-permissions-spec.md
 */
import { getPgPool } from '../services/pgDb.ts'
import type { AclResource } from './types.ts'

function flagEnabled(): boolean {
  const v = process.env.SPACE_PERMS_ENABLED
  if (v == null) return true
  return !['0', 'false', 'off', 'no'].includes(String(v).toLowerCase())
}

/**
 * resolveSpaceOf — 返回资源归属的空间 id 集合
 *
 * - resource.space_id 已带 → 直接用
 * - resource.space_ids 已带（上游解析过）→ 跳过
 * - resource.source_id 已带 → 查 space_source
 * - resource.asset_id 已带 → 先查 metadata_asset.source_id 再 → space_source
 * - 都没有 / flag off → 空集（space-scoped rule 不参评，org 级照常）
 */
export async function resolveSpaceOf(resource: AclResource): Promise<number[]> {
  if (!flagEnabled()) return []
  if (Array.isArray(resource.space_ids)) return resource.space_ids
  if (resource.space_id != null) return [resource.space_id]

  const pool = getPgPool()

  if (resource.source_id != null) {
    const { rows } = await pool.query(
      `SELECT space_id FROM space_source WHERE source_id = $1`,
      [resource.source_id],
    )
    return rows.map((r) => Number(r.space_id))
  }

  if (resource.asset_id != null) {
    const { rows } = await pool.query(
      `SELECT ss.space_id
         FROM metadata_asset a
         JOIN space_source ss ON ss.source_id = a.source_id
        WHERE a.id = $1`,
      [resource.asset_id],
    )
    return rows.map((r) => Number(r.space_id))
  }

  return []
}

/** 测试辅助：允许单测直接 mock */
export const __test__ = { flagEnabled }
