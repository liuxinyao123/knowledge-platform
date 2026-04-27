/**
 * auth/filterDerive.ts —— 从匹配的规则集合派生行级 SqlFragment
 *
 * 规则：
 *   - 命中的规则全部是 source 级（无 asset_id 限定）→ 返回 allow=true，不加 filter
 *   - 命中的规则包含 source_id 集合且不含 "对所有 source 生效" 的规则 →
 *     filter = "ma.source_id = ANY(...)"
 *   - 包含 asset 级限定 → filter = "mf.asset_id = ANY(...)"
 *   - 命中 role=NULL 的兜底规则（对所有生效）→ 不加 filter
 */
import type { AclRuleRow, SqlFragment } from './types.ts'

export function deriveFilter(matchedRules: AclRuleRow[]): SqlFragment | undefined {
  // 若存在任一规则既无 source_id 也无 asset_id → 全通，不加 filter
  const hasGlobal = matchedRules.some((r) => r.source_id == null && r.asset_id == null)
  if (hasGlobal) return undefined

  // 收集 asset_id 限定集
  const assetIds = Array.from(
    new Set(matchedRules.filter((r) => r.asset_id != null).map((r) => r.asset_id as number)),
  )
  // 收集 source_id 限定集
  const sourceIds = Array.from(
    new Set(matchedRules.filter((r) => r.asset_id == null && r.source_id != null).map((r) => r.source_id as number)),
  )

  if (assetIds.length > 0 && sourceIds.length === 0) {
    return { where: 'mf.asset_id = ANY($1::int[])', params: [assetIds] }
  }
  if (sourceIds.length > 0 && assetIds.length === 0) {
    return { where: 'ma.source_id = ANY($1::int[])', params: [sourceIds] }
  }
  if (assetIds.length > 0 && sourceIds.length > 0) {
    return {
      where: '(mf.asset_id = ANY($1::int[]) OR ma.source_id = ANY($2::int[]))',
      params: [assetIds, sourceIds],
    }
  }
  return undefined
}
