/**
 * MiniGraph —— 80×80 静态 SVG 径向缩图，卡片右侧嵌入
 *
 * 用法：
 *   <MiniGraph seeds={[882]} neighbors={[103,271,559,612]} />
 *   <MiniGraph seeds={[103,612]} />          // surprise 双节点
 *   <MiniGraph seeds={[45,118,302]} />       // sparse community core
 *
 * 无交互、无依赖（不引 sigma.js），只渲染节点圆 + 连线。
 * 复用 DetailGraph 的"节点圆 + 简单连线"外观风格。
 */
import type { ReactElement } from 'react'

interface Props {
  seeds: number[]
  neighbors?: number[]
  size?: number
}

export default function MiniGraph({ seeds, neighbors = [], size = 80 }: Props): ReactElement {
  const w = size
  const h = size
  const cx = w / 2
  const cy = h / 2
  const seedColor = 'var(--color-text-primary, #111)'
  const neighborColor = 'var(--muted, #888)'
  const edgeColor = 'var(--border, rgba(0,0,0,0.2))'
  const seedR = 5
  const neighborR = 3.5

  // 布局：
  //   - 1 seed: 中心 + neighbors 环形
  //   - 2+ seeds: seeds 按水平排列（小群），neighbors 环形包外
  const seedPositions: Array<{ x: number; y: number }> = []
  if (seeds.length === 1) {
    seedPositions.push({ x: cx, y: cy })
  } else {
    const step = (w - 24) / Math.max(1, seeds.length - 1)
    const startX = 12
    for (let i = 0; i < seeds.length; i++) {
      seedPositions.push({ x: startX + i * step, y: cy })
    }
  }

  const neighborPositions: Array<{ x: number; y: number }> = []
  const nCount = neighbors.length
  if (nCount > 0) {
    const radius = Math.min(cx, cy) - 6
    for (let i = 0; i < nCount; i++) {
      const angle = (i / nCount) * Math.PI * 2 - Math.PI / 2
      neighborPositions.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      })
    }
  }

  // 连线：每个 seed 到每个 neighbor
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const s of seedPositions) {
    for (const n of neighborPositions) {
      edges.push({ x1: s.x, y1: s.y, x2: n.x, y2: n.y })
    }
  }
  // 多 seed 间连线
  if (seedPositions.length > 1) {
    for (let i = 0; i < seedPositions.length - 1; i++) {
      edges.push({
        x1: seedPositions[i].x,
        y1: seedPositions[i].y,
        x2: seedPositions[i + 1].x,
        y2: seedPositions[i + 1].y,
      })
    }
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`图谱洞察局部图，种子 ${seeds.length} 个，邻居 ${neighbors.length} 个`}
    >
      {edges.map((e, i) => (
        <line
          key={i}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke={edgeColor}
          strokeWidth={0.8}
        />
      ))}
      {neighborPositions.map((p, i) => (
        <circle
          key={`n-${i}`}
          cx={p.x}
          cy={p.y}
          r={neighborR}
          fill={neighborColor}
        />
      ))}
      {seedPositions.map((p, i) => (
        <circle
          key={`s-${i}`}
          cx={p.x}
          cy={p.y}
          r={seedR}
          fill={seedColor}
        />
      ))}
    </svg>
  )
}
