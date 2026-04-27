/**
 * services/governance/spaceRoleSeed.ts
 *
 * space-permissions 默认角色模板 + 成员 ↔ metadata_acl_rule 投影工具。
 *
 * 设计：成员表是真相源；`metadata_acl_rule.space_id IS NOT NULL` 且
 *      `subject_type/subject_id` 存在于 `space_member` 里的规则视为"投影规则"，
 *      RulesTab 渲染时只读。
 *
 * 投影事务：每次 member 变更（加/改/删）都走
 *   BEGIN; DELETE 旧投影; INSERT 新投影; COMMIT;
 * 保证 member ↔ projected rule 严格同步。
 */
import type { PoolClient } from 'pg'

export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type SpaceMemberSubjectType = 'user' | 'team'

export interface SpaceRoleDefaultRule {
  effect: 'allow' | 'deny'
  permission: 'READ' | 'WRITE' | 'DELETE' | 'ADMIN'
  permission_required?: string | null
}

/**
 * 角色 → 默认规则模板
 *  - owner / admin：ADMIN 超集；admin 要求 principal 拥有 'space.admin' 细粒度权限（可选收紧）
 *  - editor：WRITE + READ
 *  - viewer：READ only
 */
export const SPACE_ROLE_DEFAULT_RULES: Record<SpaceRole, SpaceRoleDefaultRule[]> = {
  owner:  [{ effect: 'allow', permission: 'ADMIN' }],
  admin:  [{ effect: 'allow', permission: 'ADMIN' }],
  editor: [
    { effect: 'allow', permission: 'WRITE' },
    { effect: 'allow', permission: 'READ' },
  ],
  viewer: [{ effect: 'allow', permission: 'READ' }],
}

/**
 * 删除某成员在某空间的所有投影规则
 *   subject_type + subject_id 在 space_member 内唯一，所以 projected rule 也唯一
 */
export async function clearMemberProjection(
  tx: PoolClient,
  spaceId: number,
  subjectType: SpaceMemberSubjectType,
  subjectId: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM metadata_acl_rule
      WHERE space_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [spaceId, subjectType, subjectId],
  )
}

/**
 * 按角色模板生成投影规则行（必须在事务中；调用方先 clear 再 project）
 */
export async function projectMemberRules(
  tx: PoolClient,
  spaceId: number,
  subjectType: SpaceMemberSubjectType,
  subjectId: string,
  role: SpaceRole,
): Promise<number[]> {
  const rules = SPACE_ROLE_DEFAULT_RULES[role] ?? []
  const ids: number[] = []
  for (const r of rules) {
    const { rows } = await tx.query(
      `INSERT INTO metadata_acl_rule
         (space_id, source_id, asset_id, role,
          subject_type, subject_id,
          effect, permission, permission_required)
       VALUES ($1, NULL, NULL, NULL, $2, $3, $4, $5, $6)
       RETURNING id`,
      [spaceId, subjectType, subjectId, r.effect, r.permission, r.permission_required ?? null],
    )
    ids.push(Number(rows[0].id))
  }
  return ids
}

/**
 * 清洗 + 重建同一成员的投影。
 * 调用路径：加成员 / 改角色 / 转让 owner（两边都要 reproject）
 */
export async function reprojectMember(
  tx: PoolClient,
  spaceId: number,
  subjectType: SpaceMemberSubjectType,
  subjectId: string,
  role: SpaceRole,
): Promise<number[]> {
  await clearMemberProjection(tx, spaceId, subjectType, subjectId)
  return projectMemberRules(tx, spaceId, subjectType, subjectId, role)
}

/** 规则是否由 space_member 投影生成（用于 RulesTab 只读判定） */
export function isProjectedRule(rule: {
  space_id: number | null
  subject_type?: string | null
  subject_id?: string | null
}): boolean {
  return rule.space_id != null && !!rule.subject_type && !!rule.subject_id
}
