/**
 * DetailGraph —— 资产邻域图谱
 *
 * ADR 2026-04-23-27：真实数据来源 GET /api/kg/assets/:id/neighbors（Apache AGE）。
 *   - KG 可用时优先渲染真实邻域（HAS_TAG / CONTAINS / CO_CITED 等边）
 *   - KG 未启用 / 无数据时回退到 detail.graph 的 mock（schema FK / logical 关系图）
 *
 * 渲染仍用 SVG + 环形布局（项目不引 sigma/cytoscape，省 bundle）。
 * 节点半径按边度数自适应，hover tooltip 显示类型 / 计数。
 */
import { useEffect, useState } from 'react'
import type { PgAssetDetail } from '@/api/assetDirectory'
import { getAssetNeighbors, type KgNeighborhood } from '@/api/kg'

const W = 720, H = 360
const CENTER = { x: W / 2, y: H / 2 }
const RADIUS = 130

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
  asset:    'var(--p)',
  entity:   'var(--p)',
  source:   '#0ea5e9',
  space:    '#8b5cf6',
  tag:      '#f59e0b',
  question: '#10b981',
  template: 'var(--orange)',
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

export default function DetailGraph({ detail }: { detail: PgAssetDetail }) {
  const assetId = detail.asset?.id ?? 0
  const [kg, setKg] = useState<KgNeighborhood | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getAssetNeighbors(assetId)
      .then((data) => { if (alive) setKg(data) })
      .catch(() => { if (alive) setKg({ nodes: [], edges: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [assetId])

  // 决定渲染哪一套数据：KG 有节点 > 0 就用真实数据；否则回退 mock
  const useMock = !kg || kg.nodes.length <= 1  // 只自身没邻居也算空
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

  // 计算度数用于节点大小
  const degreeMap = new Map<string, number>()
  for (const e of displayEdges) {
    degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1)
    degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1)
  }

  const positions = layoutNodes(displayNodes, assetId, useMock)

  return (
    <div>
      <div style={{
        marginBottom: 12, padding: 10, borderRadius: 8,
        background: useMock ? '#fff7e6' : '#f0f9ff',
        border: `1px solid ${useMock ? '#ffd591' : '#93c5fd'}`,
        fontSize: 12, color: useMock ? '#874d00' : '#0c4a6e',
      }}>
        {loading ? (
          <>⏳ 正在加载知识图谱邻域…</>
        ) : useMock ? (
          <>📌 <strong>Mock 图（schema FK / logical）</strong>。知识图谱（Apache AGE）暂无该资产邻域数据——随着入库 / 问答积累会自动浮现。</>
        ) : (
          <>
            🧠 <strong>真实图谱</strong> · 节点 {displayNodes.length} · 边 {displayEdges.length}
            {degreeMap.get(`asset:${assetId}`) != null && <> · 本资产度 {degreeMap.get(`asset:${assetId}`)}</>}
          </>
        )}
      </div>

      {/* 图例 */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, flexWrap: 'wrap',
        padding: 10, background: '#f9fafb', border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {useMock ? (
          <>
            <Legend color={KIND_COLOR.entity} shape="circle" label="实体（表）" />
            <Legend color={KIND_COLOR.template} shape="square" label="业务模板" />
            <span style={{ flex: 1 }} />
            <Legend color="#1e7e34" shape="line" label="外键 FK（实线）" />
            <Legend color="#666" shape="dashed" label="业务关联（虚线）" />
          </>
        ) : (
          <>
            <Legend color={KIND_COLOR.asset}    shape="circle" label="资产" />
            <Legend color={KIND_COLOR.source}   shape="circle" label="数据源" />
            <Legend color={KIND_COLOR.tag}      shape="circle" label="标签" />
            <Legend color={KIND_COLOR.space}    shape="circle" label="空间" />
            <span style={{ flex: 1 }} />
            <Legend color="#1e7e34" shape="line" label="结构边 (CONTAINS / HAS_TAG)" />
            <Legend color="#666" shape="dashed" label="CO_CITED（共同引用）" />
          </>
        )}
      </div>

      <div style={{
        border: '1px solid var(--border)', borderRadius: 12, background: '#fafafa',
        position: 'relative', overflow: 'hidden',
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* 边 */}
          {displayEdges.map((e, i) => {
            const a = positions.get(e.from)
            const b = positions.get(e.to)
            if (!a || !b) return null
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            return (
              <g key={i}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={e.isLogical ? '#888' : '#1e7e34'}
                  strokeWidth={e.weight ? Math.min(1.5 + e.weight * 0.5, 4) : 1.5}
                  strokeDasharray={e.isLogical ? '4,3' : undefined}
                  markerEnd={e.isLogical ? 'url(#arr-logical)' : 'url(#arr-fk)'}
                />
                <rect
                  x={midX - 56} y={midY - 9} width={112} height={18} rx={9}
                  fill="#fff" stroke="var(--border)"
                />
                <text x={midX} y={midY + 4} textAnchor="middle" fontSize={10} fill="#666">
                  {e.kind}{e.weight ? ` ×${e.weight}` : ''}
                </text>
              </g>
            )
          })}

          {/* 节点 */}
          {displayNodes.map((n) => {
            const p = positions.get(n.id)
            if (!p) return null
            const isTemplate = n.kind === 'template'
            const fill = KIND_COLOR[n.kind]
            const deg = degreeMap.get(n.id) ?? 0
            // 半径随度数 ∈ [22, 38]
            const radius = Math.min(38, 22 + deg * 2)
            return (
              <g key={n.id}
                 onMouseEnter={() => setHover(n.id)}
                 onMouseLeave={() => setHover(null)}
                 style={{ cursor: 'pointer' }}>
                {isTemplate ? (
                  <rect x={p.x - 38} y={p.y - 18} width={76} height={36} rx={6}
                    fill={fill} fillOpacity={hover === n.id ? 1 : 0.85} />
                ) : (
                  <circle cx={p.x} cy={p.y} r={radius}
                    fill={fill} fillOpacity={hover === n.id ? 1 : 0.85} />
                )}
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={600}>
                  {n.label.length > 6 ? n.label.slice(0, 5) + '…' : n.label}
                </text>
                <text x={p.x} y={p.y + radius + 14} textAnchor="middle" fontSize={11} fill="#333">
                  {n.label}
                  {typeof n.count === 'number' && n.count > 1 ? ` · ${n.count}` : ''}
                </text>
              </g>
            )
          })}

          <defs>
            <marker id="arr-fk" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e7e34" />
            </marker>
            <marker id="arr-logical" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#888" />
            </marker>
          </defs>
        </svg>

        {/* hover tooltip */}
        {hover && (() => {
          const node = displayNodes.find((n) => n.id === hover)
          if (!node) return null
          const deg = degreeMap.get(hover) ?? 0
          return (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              padding: 10, background: '#fff', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 12, maxWidth: 240,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {node.label}
              </div>
              <div style={{ color: 'var(--muted)' }}>
                类型：{KIND_LABEL[node.kind]} · 度数：{deg}
                {typeof node.count === 'number' ? ` · 计数：${node.count}` : ''}
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

function layoutNodes(
  nodes: DisplayNode[],
  selfAssetId: number,
  isMock: boolean,
): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  // 找一个"中心"节点：真实数据下优先以自身 asset 为中心；mock 走原逻辑
  const selfId = `asset:${selfAssetId}`
  const center = isMock
    ? (nodes.find((n) => n.id === 'asset') ?? nodes[0])
    : (nodes.find((n) => n.id === selfId) ?? nodes[0])
  if (center) m.set(center.id, CENTER)
  const others = nodes.filter((n) => n.id !== center?.id)
  others.forEach((n, i) => {
    const angle = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2
    m.set(n.id, {
      x: CENTER.x + Math.cos(angle) * RADIUS,
      y: CENTER.y + Math.sin(angle) * RADIUS,
    })
  })
  return m
}

function Legend({ color, shape, label }: { color: string; shape: 'circle' | 'square' | 'line' | 'dashed'; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {shape === 'circle' && <span style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />}
      {shape === 'square' && <span style={{ width: 12, height: 12, background: color }} />}
      {shape === 'line' && <span style={{ width: 18, height: 2, background: color }} />}
      {shape === 'dashed' && <span style={{
        width: 18, height: 2, backgroundImage: `linear-gradient(to right, ${color} 3px, transparent 3px)`,
        backgroundSize: '6px 2px', backgroundRepeat: 'repeat-x',
      }} />}
      {label}
    </span>
  )
}
