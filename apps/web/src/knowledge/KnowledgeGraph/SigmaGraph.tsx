/**
 * SigmaGraph —— sigma.js + graphology + ForceAtlas2
 *
 * 这个组件被 React.lazy 懒加载，分包到独立 chunk（参考 D-001）。
 * 不在主页面 index.tsx 直接 import，避免主 bundle 增量。
 *
 * graphology / sigma 都通过 createRequire 也能用，但前端 vite 直接 import 即可
 * （vite 的 default-import interop 与 NodeNext 不同，无 louvain.ts 那种问题）。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { KgGraphPayload, KgGraphNode } from '@/api/kg'
import { colorForType } from './colors'
import HoverTooltip from './HoverTooltip'

interface Props {
  payload: KgGraphPayload
}

const FORCE_ATLAS_ITER = 100
const HEIGHT = 560

function radiusForDegree(degree: number): number {
  // 半径 ∈ [3, 14]
  return Math.min(14, 3 + Math.sqrt(degree) * 2)
}

export default function SigmaGraph({ payload }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const navigate = useNavigate()
  const [hoverNode, setHoverNode] = useState<KgGraphNode | null>(null)
  const [pinnedNode, setPinnedNode] = useState<KgGraphNode | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const lastClickRef = useRef<{ id: string; t: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

    // 1. 构造 graphology 图
    const graph = new Graph({ type: 'undirected', multi: false })
    const nodeMap = new Map<string, KgGraphNode>()
    for (const n of payload.nodes) {
      if (!graph.hasNode(n.id)) {
        graph.addNode(n.id, {
          label: n.label,
          x: Math.random(),
          y: Math.random(),
          size: radiusForDegree(n.degree),
          color: colorForType(n.type),
        })
        nodeMap.set(n.id, n)
      }
    }
    for (const e of payload.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
      if (graph.hasEdge(e.source, e.target)) continue
      graph.addEdge(e.source, e.target, {
        size: e.kind === 'CO_CITED' ? Math.min(3, 0.5 + Math.log(1 + (e.weight ?? 1))) : 0.5,
        color: e.kind === 'HAS_TAG' ? '#fde68a' : '#cbd5e1',
        kind: e.kind,
      })
    }

    // 2. 跑 ForceAtlas2
    if (graph.order > 0) {
      forceAtlas2.assign(graph, {
        iterations: FORCE_ATLAS_ITER,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          strongGravityMode: false,
          barnesHutOptimize: graph.order > 200,
          barnesHutTheta: 0.5,
          adjustSizes: false,
        },
      })
    }

    // 3. 渲染 sigma
    const sigma = new Sigma(graph, container, {
      renderEdgeLabels: false,
      defaultNodeColor: '#94a3b8',
      defaultEdgeColor: '#cbd5e1',
      labelDensity: 0.07,
      labelGridCellSize: 60,
      labelRenderedSizeThreshold: 6,
    })
    sigmaRef.current = sigma

    // 4. 邻居高亮
    let hoveredId: string | null = null
    let neighbors = new Set<string>()

    function updateReducers() {
      sigma.setSetting('nodeReducer', (nodeId, attrs) => {
        if (!hoveredId) return attrs
        if (nodeId === hoveredId || neighbors.has(nodeId)) return attrs
        return { ...attrs, color: '#e5e7eb', label: '' }
      })
      sigma.setSetting('edgeReducer', (edgeId, attrs) => {
        if (!hoveredId) return attrs
        const ext = graph.extremities(edgeId)
        const involved = ext[0] === hoveredId || ext[1] === hoveredId
        if (involved) {
          return { ...attrs, color: '#10b981', size: (attrs.size ?? 1) + 1 }
        }
        return { ...attrs, hidden: true }
      })
      sigma.refresh()
    }

    function onEnterNode(e: { node: string }) {
      hoveredId = e.node
      neighbors = new Set(graph.neighbors(e.node))
      const node = nodeMap.get(e.node) ?? null
      setHoverNode(node)
      updateReducers()
    }
    function onLeaveNode() {
      hoveredId = null
      neighbors = new Set()
      setHoverNode(null)
      updateReducers()
    }
    function onClickNode(e: { node: string; event: { x: number; y: number } }) {
      const node = nodeMap.get(e.node)
      if (!node) return
      const now = Date.now()
      const last = lastClickRef.current
      if (last && last.id === e.node && now - last.t < 350) {
        // 双击：仅 asset 节点跳转
        if (node.id.startsWith('asset:')) {
          const assetId = Number(node.id.slice('asset:'.length))
          if (Number.isFinite(assetId)) {
            navigate(`/assets/${assetId}`)
          }
        }
        lastClickRef.current = null
        return
      }
      lastClickRef.current = { id: e.node, t: now }
      setPinnedNode(node)
      setTooltipPos({ x: e.event.x, y: e.event.y })
    }
    function onMoveBody() {
      if (!hoveredId) return
      // sigma camera 移动时也用 hoverNode；位置走 mousemove 监听
    }

    sigma.on('enterNode', onEnterNode)
    sigma.on('leaveNode', onLeaveNode)
    sigma.on('clickNode', onClickNode)
    sigma.getCamera().on('updated', onMoveBody)

    // 鼠标位置追踪（hover tooltip 跟手）
    function trackMouse(ev: MouseEvent) {
      if (!container) return
      const rect = container.getBoundingClientRect()
      setTooltipPos({ x: ev.clientX - rect.left, y: ev.clientY - rect.top })
    }
    container.addEventListener('mousemove', trackMouse)
    function clearPin() {
      setPinnedNode(null)
    }
    container.addEventListener('mouseleave', clearPin)

    return () => {
      container.removeEventListener('mousemove', trackMouse)
      container.removeEventListener('mouseleave', clearPin)
      sigma.kill()
      sigmaRef.current = null
    }
  }, [payload, navigate])

  function zoomIn() {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 })
  }
  function zoomOut() {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 })
  }
  function zoomFit() {
    sigmaRef.current?.getCamera().animatedReset({ duration: 200 })
  }

  const displayNode = pinnedNode ?? hoverNode

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: HEIGHT,
          background: '#fafafa',
          border: '1px solid var(--border)',
          borderRadius: 12,
          position: 'relative',
        }}
      />
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={zoomIn} style={ctlStyle()} title="放大">+</button>
        <button type="button" onClick={zoomOut} style={ctlStyle()} title="缩小">−</button>
        <button type="button" onClick={zoomFit} style={ctlStyle()} title="适配屏幕">⛶</button>
      </div>
      <HoverTooltip node={displayNode} pinned={pinnedNode != null} position={tooltipPos} />
    </div>
  )
}

function ctlStyle(): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '20px',
    padding: 0,
  }
}
