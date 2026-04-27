/**
 * __tests__/skillBridge.test.ts —— OQ-SKILL-BRIDGE MVP 单测
 *
 * 覆盖：
 *   1. listSkills 返回 4 条
 *   2. callSkill('search_knowledge') 路由到 bookstack.searchPages
 *   3. callSkill('ontology.query_chunks') 路由到 hybridSearch + 输出 shape 对齐 yaml
 *   4. callSkill 未注册名 → SkillBridgeError(not_found)
 *   5. SKILL_BRIDGE_ENABLED=false → SkillBridgeError(disabled) + listSkills() 返回 []
 *   6. **drift 护栏**：__MCP_YAML_PATHS_FOR_DRIFT_CHECK 列出的 4 个 yaml 文件存在 + name 与 SKILLS 一致
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../services/bookstack.ts', () => ({
  searchPages: vi.fn(async (query: string, count: number) => [
    { id: 1, name: `match for ${query}`, type: 'page' },
  ].slice(0, count)),
  getPageContent: vi.fn(async (id: number) => ({
    id, name: `page-${id}`, html: '<p>x</p>', text: 'x', excerpt: 'x',
    url: `http://book/${id}`,
  })),
}))

vi.mock('../services/hybridSearch.ts', () => ({
  searchHybrid: vi.fn(async (input: { query: string; top_k?: number }) => {
    const k = input.top_k ?? 10
    return Array.from({ length: Math.min(k, 3) }, (_, i) => ({
      asset_id: 100 + i,
      chunk_content: `chunk text for ${input.query} #${i}`,
      rrf_score: 1 / (i + 1),
      source_set: 'b' as const,
    }))
  }),
}))

vi.mock('../services/knowledgeGraph.ts', () => ({
  getAssetNeighborhood: vi.fn(async (assetId: number) => ({
    nodes: [{ id: `asset:${assetId}`, label: `asset-${assetId}`, kind: 'asset' as const }],
    edges: [],
  })),
}))

import {
  SKILLS,
  listSkills,
  callSkill,
  SkillBridgeError,
  isSkillBridgeEnabled,
  __MCP_YAML_PATHS_FOR_DRIFT_CHECK,
} from '../services/skillBridge.ts'
import { searchPages } from '../services/bookstack.ts'
import { searchHybrid } from '../services/hybridSearch.ts'
import { getAssetNeighborhood } from '../services/knowledgeGraph.ts'

describe('skillBridge', () => {
  beforeEach(() => {
    delete process.env.SKILL_BRIDGE_ENABLED
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.SKILL_BRIDGE_ENABLED
  })

  it('exposes 4 MVP skills', () => {
    expect(SKILLS).toHaveLength(4)
    const names = SKILLS.map((s) => s.name).sort()
    expect(names).toEqual([
      'get_page_content',
      'ontology.query_chunks',
      'ontology.traverse_asset',
      'search_knowledge',
    ])
  })

  it('listSkills strips handler', () => {
    const items = listSkills()
    expect(items).toHaveLength(4)
    for (const s of items) {
      expect((s as Record<string, unknown>).handler).toBeUndefined()
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(s.inputSchema).toBeTruthy()
      expect(s.outputSchema).toBeTruthy()
    }
  })

  it('callSkill(search_knowledge) routes to bookstack.searchPages with default count', async () => {
    const out = await callSkill('search_knowledge', { query: 'liftgate' })
    expect(searchPages).toHaveBeenCalledWith('liftgate', 10)
    expect(out).toEqual({ results: [{ id: 1, name: 'match for liftgate', type: 'page' }] })
  })

  it('callSkill(ontology.query_chunks) shapes output to {chunks:[{asset_id,score,preview}]}', async () => {
    const out = await callSkill('ontology.query_chunks', { query: 'sealing force', top_k: 3 }) as {
      chunks: Array<{ asset_id: string; score: number; preview: string }>
    }
    expect(searchHybrid).toHaveBeenCalledWith({ query: 'sealing force', top_k: 3 })
    expect(out.chunks).toHaveLength(3)
    expect(typeof out.chunks[0].asset_id).toBe('string')   // yaml 要求 string
    expect(typeof out.chunks[0].score).toBe('number')
    expect(typeof out.chunks[0].preview).toBe('string')
    expect(out.chunks[0].preview.length).toBeLessThanOrEqual(200)
  })

  it('callSkill(ontology.traverse_asset) accepts numeric or string asset_id', async () => {
    const out1 = await callSkill('ontology.traverse_asset', { asset_id: 42 }) as {
      nodes: unknown[]; edges: unknown[]
    }
    expect(getAssetNeighborhood).toHaveBeenCalledWith(42)
    expect(out1.nodes).toHaveLength(1)

    vi.mocked(getAssetNeighborhood).mockClear()
    await callSkill('ontology.traverse_asset', { asset_id: '99' })
    expect(getAssetNeighborhood).toHaveBeenCalledWith(99)
  })

  it('callSkill rejects invalid asset_id', async () => {
    await expect(callSkill('ontology.traverse_asset', { asset_id: 'abc' })).rejects.toThrow(SkillBridgeError)
    await expect(callSkill('ontology.traverse_asset', {})).rejects.toThrow(/asset_id/)
  })

  it('callSkill rejects missing required field', async () => {
    await expect(callSkill('search_knowledge', {})).rejects.toThrow(/query/)
  })

  it('callSkill returns SkillBridgeError(not_found) for unknown skill', async () => {
    await expect(callSkill('does.not.exist', {})).rejects.toThrow(SkillBridgeError)
    try {
      await callSkill('does.not.exist', {})
    } catch (e) {
      expect((e as SkillBridgeError).code).toBe('not_found')
    }
  })

  it('SKILL_BRIDGE_ENABLED=false disables the bridge', async () => {
    process.env.SKILL_BRIDGE_ENABLED = 'false'
    expect(isSkillBridgeEnabled()).toBe(false)
    expect(listSkills()).toEqual([])
    await expect(callSkill('search_knowledge', { query: 'x' })).rejects.toThrow(/disabled/)
  })

  // ── drift 护栏：mcp-service yaml 必须存在且 name 一一对齐 ─────────────────
  it('mcp-service yaml manifests still exist and names match SKILLS catalog', async () => {
    const repoRoot = resolve(import.meta.dirname ?? __dirname, '..', '..', '..', '..')
    expect(__MCP_YAML_PATHS_FOR_DRIFT_CHECK).toHaveLength(4)
    for (const rel of __MCP_YAML_PATHS_FOR_DRIFT_CHECK) {
      const abs = resolve(repoRoot, rel)
      const stat = await fs.stat(abs)
      expect(stat.isFile()).toBe(true)
      const content = await fs.readFile(abs, 'utf-8')
      // 极简 yaml name 提取（不引 js-yaml 依赖）
      const m = content.match(/^name:\s*([\w.-]+)/m)
      expect(m, `yaml ${rel} missing name field`).not.toBeNull()
      const name = m![1]
      const inCatalog = SKILLS.some((s) => s.name === name)
      expect(inCatalog, `yaml name "${name}" (from ${rel}) not found in SKILLS catalog → drift`).toBe(true)
    }
  })
})
