/**
 * auth/types.ts —— 统一授权服务核心类型
 * 契约：openspec/changes/unified-auth/
 */

export interface Principal {
  user_id: number
  email: string
  roles: string[]
  /** PRD §2 细粒度权限字符串集（如 'knowledge:ops:manage'） */
  permissions: string[]
  /** Permissions V2：用户加入的团队 id 列表（数字转字符串便于跟 metadata_acl_rule.subject_id 比对） */
  team_ids?: string[]
  team_names?: string[]
}

export type AclAction = 'READ' | 'WRITE' | 'DELETE' | 'ADMIN' | 'EXECUTE'

export interface AclResource {
  source_id?: number
  asset_id?: number
  field_id?: number
  /** space-permissions：直接指定资源所属的空间 id（绕过 resolveSpaceOf 的 DB 查询） */
  space_id?: number
  /** space-permissions：已解析出的空间 id 集合；空集合等价老行为 */
  space_ids?: number[]
  /** action-framework：action definition name for EXECUTE permission checks */
  action_name?: string
  /** action-framework：action run id for READ permission checks */
  action_run_id?: string
}

export interface FieldMask {
  field: string
  mode: 'hide' | 'star' | 'hash' | 'truncate'
}

export interface SqlFragment {
  where: string
  params: unknown[]
}

export interface Decision {
  allow: boolean
  filter?: SqlFragment
  mask?: FieldMask[]
  reason?: string
  /** 可选：命中规则的 ID 列表（主要给 simulate/调试用，生产路径不强依赖） */
  matchedRuleIds?: number[]
}

/** metadata_acl_rule 行在本进程里的形状 */
export interface AclRuleRow {
  id: number
  source_id: number | null
  asset_id: number | null
  /** space-permissions：作用空间；NULL/undefined = org 级（等价老行为） */
  space_id?: number | null
  field_id?: number | null     // 预留；当前 DDL 还未含此列，按 null 处理
  /** PRD §2 升级：rule 命中后还要求 principal 拥有此 permission（NULL 不要求） */
  permission_required?: string | null
  /** 旧字段；保留兼容；新规则用 subject_type+subject_id */
  role: string | null
  permission: string
  condition: Record<string, unknown> | null
  /** Permissions V2 主体：'role' / 'user' / 'team'；旧规则可能为 null（自动按 role 处理） */
  subject_type?: 'role' | 'user' | 'team' | null | string
  subject_id?: string | null
  /** 'allow'（默认）或 'deny'（最高优先） */
  effect?: 'allow' | 'deny' | string | null
  expires_at?: Date | null
}

// Express req 扩展见 src/types/express.d.ts
