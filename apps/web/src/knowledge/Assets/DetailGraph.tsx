/**
 * DetailGraph —— 资产邻域图谱
 *
 * ADR 2026-04-23-27：真实数据来源 GET /api/kg/assets/:id/neighbors（Apache AGE）。
 *   - KG 可用时优先渲染真实邻域（HAS_TAG / CONTAINS / CO_CITED 等边）
 *   - KG 未启用 / 无数据时回退到 detail.graph 的 mock（schema FK / logical 关系图）
 *
 * 渲染：手写 SVG + 环形布局（不引 sigma/cytoscape，省 bundle）。
 * 视觉重做（2026-04-26）：
 *   · 节点缩小、按 kind 分色、度数加 halo、中心 asset 双环强调
 *   · 边按 kind 分色（HAS_TAG 蓝 / CONTAINS 紫 / CITED 绿 / CO_CITED 虚灰）
 *   · 边标签默认隐藏，hover 边或邻接节点才浮现，避免画面拥挤
 *   · 背景 radial gradient + 网点纹路
 *   · 悬停节点高亮邻边 + 暗化非邻居
 */
import { useEffect, useMemo, useState } from 'react'
import type { PgAssetDetail } from '@/api/assetDirectory'
import { getAssetNeighbors, type KgNeighborhood } from '@/api/kg'

const W = 760, H = 420
const CENTER = { x: W / 2, y: H / 2 }
const RADIUS = 150

type DisplayNode = {
  id: string
  label: string
  kind: 'asset' | 'source' | 'space' | 'tag' | 'question' | 'entity' | 'template'
  count?: number
}
type DisplayEdge = {
  from: string
  to: string
  kind: string
  weight?: number
  isLogical?: boolean
}

const KIND_COLOR: Record<DisplayNode['kind'], string> = {
  asset:    '#7c3aed',  // 紫 · 资产（中心）
  entity:   '#7c3aed',
  source:   '#0ea5e9',  // 蓝 · 数据源
  space:    '#ec4899',  // 玫红 · 空间（区别 asset）
  tag:      '#f59e0b',  // 琥珀 · 标签
  question: '#10b981',  // 翠绿 · 问题
  template: '#fb923c',  // 橙 · 模板（mock）
}

const KIND_LABEL: Record<DisplayNode['kind'], string> = {
  asset:    '资产',
  entity:   '实体',
  source:   '数据源',
  space:    '空间',
  tag:      '标签',
  question: '问题',
  template: '模板',
}

/** 按 edge.kind 分色 + 形态（实/虚） */
function edgeStyle(kind: string, isLogical: boolean | undefined): { color: string; dashed: boolean } {
  if (isLogical) return { color: '#9ca3af', dashed: true }                // CO_CITED / mock-logical
  switch (kind) {
    case 'HAS_TAG':   return { color: '#60a5fa', dashed: false }          // 蓝
    case 'CONTAINS':  return { color: '#a78bfa', dashed: false }          // 紫
    case 'CITED':     return { color: '#16a34a', dashed: false }          // 深绿
    case 'SCOPES':    return { color: '#ec4899', dashed: false }          // 玫红
    default:          return { color: '#16a34a', dashed: false }          // 兜底深绿
  }
}

export default function DetailGraph({ detail }: { detail: PgAssetDetail }) {
  const assetId = detail.asset?.id ?? 0
  const [kg, setKg] = useState<KgNeighborhood | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getAssetNeighbors(assetId)
      .then((data) => { if (alive) setKg(data) })
      .catch(() => { if (alive) setKg({ nodes: [], edges: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [assetId])

  const useMock = !kg || kg.nodes.length <= 1
  const displayNodes: DisplayNode[] = useMock
    ? detail.graph.nodes.map((n) => ({
        id: n.id, label: n.label,
        kind: n.type === 'template' ? 'template' : 'entity',
        count: n.count,
      }))
    : kg!.nodes.map((n) => ({
        id: n.id, label: n.label,
        kind: n.kind, count: n.count,
      }))
  const displayEdges: DisplayEdge[] = useMock
    ? detail.graph.edges.map((e) => ({
        from: e.from, to: e.to, kind: e.label || e.kind, isLogical: e.kind === 'logical',
      }))
    : kg!.edges.map((e) => ({
        from: e.from, to: e.to, kind: e.kind, weight: e.weight,
        isLogical: e.kind === 'CO_CITED',
      }))

  // degree
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of displayEdges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1)
      m.set(e.to, (m.get(e.to) ?? 0) + 1)
    }
    return m
  }, [displayEdges])

  // 邻居映射（hover 高亮用）
  const neighborMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of displayEdges) {
      if (!m.has(e.from)) m.set(e.from, new Set())
      if (!m.has(e.to)) m.set(e.to, new Set())
      m.get(e.from)!.add(e.to)
      m.get(e.to)!.add(e.from)
    }
    return m
  }, [displayEdges])

  const positions = layoutNodes(displayNodes, assetId, useMock)
  const selfId = useMock ? 'asset' : `asset:${assetId}`

  /** 当前 hover 状态下，节点 / 边是否高亮 */
  function nodeOpacity(id: string): number {
    if (!hover) return 1
    if (id === hover) return 1
    if (neighborMap.get(hover)?.has(id)) return 1
    return 0.25
  }
  function edgeOpacity(e: DisplayEdge, idx: number): number {
    if (hoverEdge != null) return idx === hoverEdge ? 1 : 0.18
    if (!hover) return 0.85
    if (e.from === hover || e.to === hover) return 1
    return 0.18
  }

  return (
    <div>
      {/* 顶部状态条 */}
      <div style={{
        marginBottom: 12, padding: 10, borderRadius: 10,
        background: useMock
          ? 'linear-gradient(90deg,#fff7e6,#fff)'
          : 'linear-gradient(90deg,#eef2ff,#fff)',
        border: `1px solid ${useMock ? '#fcd34d' : '#c7d2fe'}`,
        fontSize: 12, color: useMock ? '#92400e' : '#3730a3',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {loading ? (
          <>⏳ 正在加载知识图谱邻域…</>
        ) : useMock ? (
          <>📌 <strong>Mock 图（schema FK / logical）</strong>。Apache AGE 暂无该资产邻域 — 入库 / 问答积累后会自动浮现。</>
        ) : (
          <>
            🧠 <strong>真实图谱</strong>
            <span style={{ opacity: 0.7 }}>·</span>
            节点 {displayNodes.length}
            <span style={{ opacity: 0.7 }}>·</span>
            边 {displayEdges.length}
            {degreeMap.get(selfId) != null && (
              <>
                <span style={{ opacity: 0.7 }}>·</span>
                本资产度 {degreeMap.get(selfId)}
              </>
            )}
          </>
        )}
      </div>

      {/* 图例 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, flexWrap: 'wrap',
        padding: '8px 12px', background: '#fafbfc',
        border: '1px solid var(--border)', borderRadius: 10,
      }}>
        {useMock ? (
          <>
            <Legend color={KIND_COLOR.entity} shape="circle" label="实体（表）" />
            <Legend color={KIND_COLOR.template} shape="square" label="业务模板" />
            <span style={{ flex: 1 }} />
            <Legend color="#16a34a" shape="line" label="外键 FK" />
            <Legend color="#9ca3af" shape="dashed" label="业务关联" />
          </>
        ) : (
          <>
            <Legend color={KIND_COLOR.asset}    shape="circle" label="资产" />
            <Legend color={KIND_COLOR.source}   shape="circle" label="数据源" />
            <Legend color={KIND_COLOR.tag}      shape="circle" label="标签" />
            <Legend color={KIND_COLOR.space}    shape="circle" label="空间" />
            <Legend color={KIND_COLOR.question} shape="circle" label="问题" />
            <span style={{ flex: 1 }} />
            <Legend color="#60a5fa" shape="line"   label="HAS_TAG" />
            <Legend color="#a78bfa" shape="line"   label="CONTAINS" />
            <Legend color="#16a34a" shape="line"   label="CITED" />
            <Legend color="#9ca3af" shape="dashed" label="CO_CITED" />
          </>
        )}
      </div>

      {/* 画布 */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 14, position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 40%, #ffffff 0%, #f4f6fb 70%, #eef1f7 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6)',
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* 网点纹理 + 滤镜定义 */}
          <defs>
            <pattern id="dot-bg" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="#cbd5e1" opacity="0.35" />
            </pattern>
            <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
              <feOffset dx="0" dy="2" result="offsetblur" />
              <feComponentTransfer><feFuncA type="linear" slope="0.25" /></feComponentTransfer>
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <marker id="arr-fk" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <rect x={0} y={0} width={W} height={H} fill="url(#dot-bg)" />

          {/* 中心 halo（强调本资产） */}
          {!useMock && positions.get(selfId) && (
            <circle
              cx={positions.get(selfId)!.x}
              cy={positions.get(selfId)!.y}
              r={42}
              fill={KIND_COLOR.asset}
              opacity={0.08}
            />
          )}

          {/* 边 */}
          {displayEdges.map((e, i) => {
            const a = positions.get(e.from)
            const b = positions.get(e.to)
            if (!a || !b) return null
            const { color, dashed } = edgeStyle(e.kind, e.isLogical)
            const op = edgeOpacity(e, i)
            const showLabel = hoverEdge === i
              || hover === e.from || hover === e.to
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            const sw = e.weight ? Math.min(1.2 + e.weight * 0.4, 3) : 1.4
            return (
              <g key={i} style={{ color, transition: 'opacity 0.18s' }} opacity={op}
                 onMouseEnter={() => setHoverEdge(i)}
                 onMouseLeave={() => setHoverEdge(null)}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={color}
                  strokeWidth={sw}
                  strokeDasharray={dashed ? '5,4' : undefined}
                  strokeLinecap="round"
                  markerEnd="url(#arr-fk)"
                />
                {showLabel && (
                  <g pointerEvents="none">
                    <rect x={midX - 44} y={midY - 9} width={88} height={18} rx={9}
                      fill="#fff" stroke={color} strokeOpacity={0.5} />
                    <text x={midX} y={midY + 4} textAnchor="middle" fontSize={10}
                      fill="#374151" fontWeight={500}>
                      {e.kind}{e.weight && e.weight > 1 ? ` ×${e.weight}` : ''}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* 节点 */}
          {displayNodes.map((n) => {
            const p = positions.get(n.id)
            if (!p) return null
            const isCenter = n.id === selfId
            const isTemplate = n.kind === 'template'
            const fill = KIND_COLOR[n.kind]
            const deg = degreeMap.get(n.id) ?? 0
            // 半径：基础 16，每度 +1.4，max 26；center 节点 +4
            const radius = Math.min(26, 16 + deg * 1.4) + (isCenter ? 4 : 0)
            const op = nodeOpacity(n.id)
            const innerLabel = renderInnerLabel(n)
            return (
              <g key={n.id}
                 onMouseEnter={() => setHover(n.id)}
                 onMouseLeave={() => setHover(null)}
                 opacity={op}
                 style={{ cursor: 'pointer', transition: 'opacity 0.18s' }}>
                {isTemplate ? (
                  <rect x={p.x - 38} y={p.y - 18} width={76} height={36} rx={6}
                    fill={fill} filter="url(#node-shadow)" />
                ) : (
                  <>
                    {isCenter && (
                      <circle cx={p.x} cy={p.y} r={radius + 4}
                        fill="none" stroke={fill} strokeWidth={2} strokeOpacity={0.45} />
                    )}
                    <circle cx={p.x} cy={p.y} r={radius}
                      fill={fill} filter="url(#node-shadow)" />
                  </>
                )}
                <text x={p.x} y={p.y + 4} textAnchor="middle"
                  fontSize={isCenter ? 13 : 11} fill="#fff" fontWeight={700}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {innerLabel}
                </text>
                {/* 外部 label 仅 center 显示，其他节点 hover 显示 */}
                {(isCenter || hover === n.id) && (
                  <text x={p.x} y={p.y + radius + 14} textAnchor="middle"
                    fontSize={11} fill="#1f2937" fontWeight={isCenter ? 600 : 400}
                    style={{ pointerEvents: 'none' }}>
                    {n.label.length > 12 ? n.label.slice(0, 11) + '…' : n.label}
                    {typeof n.count === 'number' && n.count > 1 ? ` · ${n.count}` : ''}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* hover tooltip（右上角浮卡） */}
        {hover && (() => {
          const node = displayNodes.find((n) => n.id === hover)
          if (!node) return null
          const deg = degreeMap.get(hover) ?? 0
          return (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              padding: '10px 12px', background: 'rgba(255,255,255,0.97)',
              border: '1px solid var(--border)', borderRadius: 10,
              fontSize: 12, maxWidth: 260,
              boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>
                {node.label}
              </div>
              <div style={{ color: 'var(--muted)' }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: KIND_COLOR[node.kind], marginRight: 6, verticalAlign: 'middle',
                }} />
                {KIND_LABEL[node.kind]} · 度数 {deg}
                {typeof node.count === 'number' ? ` · 计数 ${node.count}` : ''}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                ID：<code>{node.id}</code>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

/** 节点内部短标签：center/asset 用 #id，tag/source/space/question 用 label 截断 */
function renderInnerLabel(n: DisplayNode): string {
  if (n.kind === 'asset' || n.kind === 'entity') {
    // asset:42 → #42；空间内显示
    const m = n.id.match(/(\d+)$/)
    return m ? `#${m[1]}` : (n.label.length > 4 ? n.label.slice(0, 3) + '…' : n.label)
  }
  // 其它类型节点内部仅显示 1~3 字
  const lbl = n.label || ''
  if (lbl.length <= 3) return lbl
  // 中文 char 比英文宽，中文截 2 字 + …，英文 4
  const isCn = /[\u4e00-\u9fff]/.test(lbl)
  return isCn ? lbl.slice(0, 2) + '…' : lbl.slice(0, 4) + '…'
}

function layoutNodes(
  nodes: DisplayNode[],
  selfAssetId: number,
  isMock: boolean,
): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  const selfId = `asset:${selfAssetId}`
  const center = isMock
    ? (nodes.find((n) => n.id === 'asset') ?? nodes[0])
    : (nodes.find((n) => n.id === selfId) ?? nodes[0])
  if (center) m.set(center.id, CENTER)
  const others = nodes.filter((n) => n.id !== center?.id)
  // 多于 1 个节点时，从顶端 -90° 开始顺时针均匀分布；< 4 个时拉宽角度（避免重叠到中心上下）
  const N = others.length
  others.forEach((n, i) => {
    const angle = (i / Math.max(N, 1)) * 2 * Math.PI - Math.PI / 2
    m.set(n.id, {
      x: CENTER.x + Math.cos(angle) * RADIUS,
      y: CENTER.y + Math.sin(angle) * RADIUS,
    })
  })
  return m
}

function Legend({ color, shape, label }: { color: string; shape: 'circle' | 'square' | 'line' | 'dashed'; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#374151' }}>
      {shape === 'circle' && <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />}
      {shape === 'square' && <span style={{ width: 11, height: 11, borderRadius: 2, background: color }} />}
      {shape === 'line' && <span style={{ width: 18, height: 2, background: color, borderRadius: 1 }} />}
      {shape === 'dashed' && <span style={{
        width: 18, height: 2,
        backgroundImage: `linear-gradient(to right, ${color} 4px, transparent 4px)`,
        backgroundSize: '7px 2px', backgroundRepeat: 'repeat-x',
      }} />}
      <span style={{ fontSize: 12 }}>{label}</span>
    </span>
  )
}
