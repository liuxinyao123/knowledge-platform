import type { ReactElement } from 'react'
import type { KgGraphNode } from '@/api/kg'

interface Props {
  /** 鼠标悬停或固定的节点；null 表示隐藏 */
  node: KgGraphNode | null
  /** 是否 pinned（单击触发，区别 hover 暂态） */
  pinned: boolean
  position: { x: number; y: number } | null
}

export default function HoverTooltip({ node, pinned, position }: Props): ReactElement | null {
  if (!node || !position) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x + 8,
        top: position.y + 8,
        padding: 10,
        background: '#fff',
        border: `1px solid ${pinned ? '#10b981' : 'var(--border)'}`,
        borderRadius: 8,
        fontSize: 12,
        maxWidth: 260,
        zIndex: 10,
        pointerEvents: 'none',
        boxShadow: pinned ? '0 2px 8px rgba(16,185,129,0.15)' : '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{node.label}</div>
      <div style={{ color: 'var(--muted)' }}>
        类型：<code style={{ fontSize: 11 }}>{node.type}</code> · 度数：{node.degree}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
        ID：<code>{node.id}</code>
      </div>
      {node.id.startsWith('asset:') && (
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
          双击节点跳转到资产详情
        </div>
      )}
    </div>
  )
}
