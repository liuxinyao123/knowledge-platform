/**
 * RequirePermission —— PRD §17.4 权限驱动 UI
 * 无权限默认隐藏（不渲染）；可传 fallback 自定义。
 * 支持 anyOf / allOf 数组；二者同时给时 anyOf 优先。
 */
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export interface RequirePermissionProps {
  name?: string
  anyOf?: string[]
  allOf?: string[]
  fallback?: ReactNode
  children: ReactNode
}

export default function RequirePermission(props: RequirePermissionProps) {
  const { user, loading, hasPermission } = useAuth()

  // 加载期默认隐藏（避免错误闪现）
  if (loading || !user) return <>{props.fallback ?? null}</>

  let allowed = true
  if (props.name) allowed = hasPermission(props.name)
  if (allowed && props.anyOf?.length) {
    allowed = props.anyOf.some((p) => hasPermission(p))
  }
  if (allowed && props.allOf?.length) {
    allowed = props.allOf.every((p) => hasPermission(p))
  }
  if (!props.name && !props.anyOf && !props.allOf) allowed = true   // 无约束放行

  return <>{allowed ? props.children : (props.fallback ?? null)}</>
}
