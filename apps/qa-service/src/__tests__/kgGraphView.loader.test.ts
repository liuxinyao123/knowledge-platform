/**
 * kgGraphView.loader.test.ts —— GraphPayload 构造 + 截断行为
 *
 * mock runCypher 给定合成数据，验证：
 *   - 老 Space → empty:true
 *   - happy path → 节点/边形态、Tag 节点 type='_tag'
 *   - 节点超限按 degree 截断
 *   - 边过滤：两端必须在保留节点集
 *   - 边超限按 weight 降序截断
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// agtype 编码：模拟 AGE 返回字符串带引号
function ag(v: string | number): string {
  return typeof v === 'number' ? String(v) : `"${v}"`
}

const mockRunCypher = vi.fn()
vi.mock('../services/graphDb.ts', () => ({
  runCypher: (...args: unknown[]) => mockRunCypher(...args),
  isGraphEnabled: () => true,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

async function importLoader() {
  return await import('../services/kgGraphView/loader.ts')
}

describe('loadSpaceGraphForViz', () => {
  it('老 Space 在 AGE 无 :Space → empty payload', async () => {
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('MATCH (sp:Space {id:')) {
        if (q.includes('RETURN sp.id AS id LIMIT 1')) return [] // 不存在
      }
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    const r = await loadSpaceGraphForViz(99, { maxNodes: 800, maxEdges: 3000 })
    expect(r.empty).toBe(true)
    expect(r.hint).toBe('space_not_in_graph')
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([])
    expect(r.stats.node_count).toBe(0)
  })

  it('happy path：3 资产 + 2 边 + 1 tag', async () => {
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('RETURN sp.id AS id LIMIT 1')) {
        return [{ id: ag(12) }]
      }
      if (q.includes('a:Asset')) {
        if (q.includes('RETURN DISTINCT a.id')) {
          return [
            { id: ag(1), name: ag('a.pdf'), type: ag('pdf') },
            { id: ag(2), name: ag('b.md'), type: ag('md') },
            { id: ag(3), name: ag('c.docx'), type: ag('docx') },
          ]
        }
        if (q.includes('CO_CITED')) {
          return [
            { aid: ag(1), bid: ag(2), w: ag(3) },
            { aid: ag(2), bid: ag(3), w: ag(1) },
          ]
        }
        if (q.includes('HAS_TAG')) {
          return [{ aid: ag(1), name: ag('finance') }]
        }
      }
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    const r = await loadSpaceGraphForViz(12, { maxNodes: 800, maxEdges: 3000 })
    expect(r.empty).toBe(false)
    expect(r.truncated).toBe(false)
    expect(r.stats.node_count).toBe(4) // 3 asset + 1 tag
    expect(r.stats.edge_count).toBe(3) // 2 CO_CITED + 1 HAS_TAG

    const assetIds = r.nodes.filter((n) => n.id.startsWith('asset:')).map((n) => n.id).sort()
    expect(assetIds).toEqual(['asset:1', 'asset:2', 'asset:3'])

    const tag = r.nodes.find((n) => n.id === 'tag:finance')
    expect(tag).toBeDefined()
    expect(tag!.type).toBe('_tag')

    // CO_CITED 边带 weight，HAS_TAG 不带
    const coCited = r.edges.filter((e) => e.kind === 'CO_CITED')
    expect(coCited.length).toBe(2)
    expect(coCited[0].weight).toBeDefined()
    const hasTag = r.edges.filter((e) => e.kind === 'HAS_TAG')
    expect(hasTag.length).toBe(1)
    expect(hasTag[0].weight).toBeUndefined()
  })

  it('节点超限按 degree 降序截断', async () => {
    // 5 个资产，互不连接（HAS_TAG 决定 degree）
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('RETURN sp.id AS id LIMIT 1')) return [{ id: ag(1) }]
      if (q.includes('RETURN DISTINCT a.id')) {
        return [
          { id: ag(1), name: ag('a'), type: ag('pdf') },
          { id: ag(2), name: ag('b'), type: ag('pdf') },
          { id: ag(3), name: ag('c'), type: ag('pdf') },
          { id: ag(4), name: ag('d'), type: ag('pdf') },
          { id: ag(5), name: ag('e'), type: ag('pdf') },
        ]
      }
      if (q.includes('CO_CITED')) return []
      if (q.includes('HAS_TAG')) {
        // asset 1 度=3，asset 2 度=2，3=1，4=0，5=0
        return [
          { aid: ag(1), name: ag('t1') },
          { aid: ag(1), name: ag('t2') },
          { aid: ag(1), name: ag('t3') },
          { aid: ag(2), name: ag('t1') },
          { aid: ag(2), name: ag('t2') },
          { aid: ag(3), name: ag('t1') },
        ]
      }
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    // 限制总节点 4：应保留 asset 1/2/3 + 至少 1 个 tag
    const r = await loadSpaceGraphForViz(1, { maxNodes: 4, maxEdges: 100 })
    expect(r.truncated).toBe(true)
    const assetNodes = r.nodes.filter((n) => n.id.startsWith('asset:')).map((n) => n.id)
    // 4 个节点预算，资产优先：4 个资产被保留（但总共 5 个，所以截掉 1 个 — degree 最低的 4 或 5）
    // 但 maxNodes=4 总预算意味着最多 4 个节点（资产+tag 合计），算法资产优先全填满
    expect(assetNodes.length).toBeLessThanOrEqual(4)
    expect(assetNodes.length).toBeGreaterThanOrEqual(3)
    // asset 1（度 3）必在
    expect(assetNodes).toContain('asset:1')
  })

  it('边过滤：两端必须在保留节点集', async () => {
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('RETURN sp.id AS id LIMIT 1')) return [{ id: ag(1) }]
      if (q.includes('RETURN DISTINCT a.id')) {
        return [
          { id: ag(1), name: ag('a'), type: ag('pdf') },
          { id: ag(2), name: ag('b'), type: ag('pdf') },
          { id: ag(3), name: ag('c'), type: ag('pdf') },
        ]
      }
      if (q.includes('CO_CITED')) {
        return [
          { aid: ag(1), bid: ag(2), w: ag(3) }, // 度 1 + 度 1
          { aid: ag(1), bid: ag(3), w: ag(1) }, // 度 1 + 度 0
        ]
      }
      if (q.includes('HAS_TAG')) return []
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    // maxNodes=2 → 应保留 asset 1（度2）+ asset 2（度1）；asset 3 截掉 → 边 1-3 也被丢
    const r = await loadSpaceGraphForViz(1, { maxNodes: 2, maxEdges: 100 })
    expect(r.truncated).toBe(true)
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['asset:1', 'asset:2'])
    expect(r.edges).toHaveLength(1)
    expect(r.edges[0].source).toBe('asset:1')
    expect(r.edges[0].target).toBe('asset:2')
  })

  it('边超限按 weight 降序截', async () => {
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('RETURN sp.id AS id LIMIT 1')) return [{ id: ag(1) }]
      if (q.includes('RETURN DISTINCT a.id')) {
        return [
          { id: ag(1), name: ag('a'), type: ag('pdf') },
          { id: ag(2), name: ag('b'), type: ag('pdf') },
          { id: ag(3), name: ag('c'), type: ag('pdf') },
        ]
      }
      if (q.includes('CO_CITED')) {
        return [
          { aid: ag(1), bid: ag(2), w: ag(10) }, // 高
          { aid: ag(2), bid: ag(3), w: ag(5) },  // 中
          { aid: ag(1), bid: ag(3), w: ag(1) },  // 低
        ]
      }
      if (q.includes('HAS_TAG')) return []
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    const r = await loadSpaceGraphForViz(1, { maxNodes: 800, maxEdges: 2 })
    expect(r.truncated).toBe(true)
    expect(r.edges).toHaveLength(2)
    // 应保留 weight=10 和 weight=5
    const weights = r.edges.map((e) => e.weight).sort((x, y) => (y ?? 0) - (x ?? 0))
    expect(weights).toEqual([10, 5])
  })

  it('节点 label 截 12 字符 + 省略号', async () => {
    mockRunCypher.mockImplementation(async (q: string) => {
      if (q.includes('RETURN sp.id AS id LIMIT 1')) return [{ id: ag(1) }]
      if (q.includes('RETURN DISTINCT a.id')) {
        return [{ id: ag(1), name: ag('this-is-a-very-long-asset-name.pdf'), type: ag('pdf') }]
      }
      return []
    })
    const { loadSpaceGraphForViz } = await importLoader()
    const r = await loadSpaceGraphForViz(1, { maxNodes: 800, maxEdges: 3000 })
    const a = r.nodes[0]
    expect(a.label.length).toBeLessThanOrEqual(13) // 12 + ellipsis
    expect(a.label.endsWith('…')).toBe(true)
  })
})
