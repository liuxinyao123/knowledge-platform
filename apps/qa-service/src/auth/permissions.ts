/**
 * auth/permissions.ts —— PRD §2.3 角色 → 权限映射 + 工具
 *
 * 内置常量；未来 G4 IAM 升级为 DB 可编辑后，此文件提供 fallback。
 */
import type { Principal } from './types.ts'

// PRD §2.3 普通用户（user / viewer）默认权限
export const USER_PERMS = [
  'knowledge:overview',
  'knowledge:search',
  'knowledge:spaces',
  'knowledge:ingest',
  'knowledge:qa',
  'knowledge:ops:read',
  'assets:view',
] as const

// editor —— 用户基础 + 治理"管理"权限（标签 / 重复 / 质量），但无 ACL/IAM
export const EDITOR_PERMS = [
  ...USER_PERMS,
  'knowledge:ops:manage',
] as const

// admin —— 全集（含 ACL / IAM / explain / audit）
export const ADMIN_PERMS = [
  ...USER_PERMS,
  'knowledge:ops:manage',
  'permission:manage',
  'rule:edit',
  'audit:view',
  'explain:view',
  'iam:manage',
] as const

export const ROLE_TO_PERMS: Record<string, readonly string[]> = {
  admin: ADMIN_PERMS,
  editor: EDITOR_PERMS,
  viewer: USER_PERMS,
  user: USER_PERMS,
}

/**
 * 把 roles 列表展开为去重的 permissions 集合。未识别 role 被忽略。
 */
export function expandRolesToPermissions(roles: string[]): string[] {
  const set = new Set<string>()
  for (const r of roles) {
    const perms = ROLE_TO_PERMS[r]
    if (perms) for (const p of perms) set.add(p)
  }
  return [...set]
}

export function hasPermission(principal: Principal, name: string): boolean {
  return principal.permissions.includes(name)
}
