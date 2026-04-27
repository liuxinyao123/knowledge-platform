/**
 * SubjectBadge —— 统一的 "主体" 展示徽标
 *
 * 目标：在 RulesTab / PermissionsDrawer / AuditTab 等处一致渲染
 *   - role:editor / role:* → 蓝色
 *   - user:alice@corp.com  → 绿色
 *   - team:3               → 紫色
 *   - legacy（仅 role 字段）→ 灰色 + 斜体
 */
import type React from 'react'
import type { SubjectType } from '@/api/iam'

interface Props {
  subject_type: SubjectType | null | undefined
  subject_id: string | null | undefined
  /** legacy 规则（subject_type 为空）时显示的 role */
  legacyRole?: string | null
}

export default function SubjectBadge({ subject_type, subject_id, legacyRole }: Props) {
  if (!subject_type) {
    return (
      <span style={{ ...badge, background: '#e5e7eb', color: '#374151', fontStyle: 'italic' }}>
        legacy: {legacyRole ?? '*'}
      </span>
    )
  }
  const palette = PALETTE[subject_type] ?? PALETTE.role
  const label = subject_type === 'team' ? `team#${subject_id}` : `${subject_type}:${subject_id}`
  return (
    <span style={{ ...badge, background: palette.bg, color: palette.fg }}>
      {label}
    </span>
  )
}

const badge: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const PALETTE: Record<SubjectType, { bg: string; fg: string }> = {
  role: { bg: '#DBEAFE', fg: '#1D4ED8' },
  user: { bg: '#D1FAE5', fg: '#065F46' },
  team: { bg: '#E9D5FF', fg: '#6B21A8' },
}
