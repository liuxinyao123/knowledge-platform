/**
 * services/skillBridge.ts —— qa-service 端的 Skill 桥（OQ-SKILL-BRIDGE 2026-04-25 MVP）
 *
 * 背景见：
 *   .superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md §D-007
 *   .superpowers-memory/open-questions.md OQ-SKILL-BRIDGE
 *
 * MVP（弱解读）目的：让 qa-service 的 agent 在不通过 MCP 协议层的情况下也能消费
 * mcp-service 提供的声明式 Skill。本桥**不**起 MCP client、**不**做 stdio/HTTP roundtrip，
 * 而是在 qa-service 进程内直接 dispatch 到本地 service 函数。
 *
 * 当前覆盖（4/8）：
 *   - search_knowledge          → bookstack.searchPages
 *   - get_page_content          → bookstack.getPageContent
 *   - ontology.query_chunks     → hybridSearch.searchHybrid
 *   - ontology.traverse_asset   → knowledgeGraph.getAssetNeighborhood
 *
 * 未覆盖（待 Phase 2 升级为完整 MCP client）：
 *   - ontology.match_tag        — 后端 /api/ontology/match 未实现
 *   - ontology.path_between     — 后端 /api/ontology/path  未实现
 *   - action.execute            — 写操作；待 ADR-30 + actionEngine 配合
 *   - action.status             — 同上
 *
 * 单点真相维护：本文件 SKILLS 数组的 input/output 形状必须与
 *   apps/mcp-service/skills/<name>.skill.yaml 同名 manifest 一致。
 *   有 yaml drift 检测的单测（__tests__/skillBridge.test.ts）作护栏。
 *
 * 启用：默认开启（无副作用），可通过 SKILL_BRIDGE_ENABLED=false 关闭。
 */

import { searchPages, getPageContent } from './bookstack.ts'
import { searchHybrid, type HybridResult } from './hybridSearch.ts'
import { getAssetNeighborhood, type GraphNeighborhood } from './knowledgeGraph.ts'

// ── 类型 ──────────────────────────────────────────────────────────────────────

/**
 * Skill 描述符 —— 与 mcp-service `SkillYaml` 字段子集对齐。
 * input/output 用 JSON Schema 表达（本桥不强校验，靠 handler 自洽 + 调用方信任）。
 */
export interface SkillDescriptor {
  name: string
  description: string
  category?: string
  inputSchema: object
  outputSchema: object
  /** 直接在 qa-service 进程内调用的本地实现 */
  handler: (input: unknown) => Promise<unknown>
}

export class SkillBridgeError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'SkillBridgeError'
    this.code = code
  }
}

// ── 启用开关 ──────────────────────────────────────────────────────────────────

export function isSkillBridgeEnabled(): boolean {
  return (process.env.SKILL_BRIDGE_ENABLED ?? 'true').toLowerCase() !== 'false'
}

// ── 输入校验辅助（极简 JSON Schema 子集）──────────────────────────────────────

function asObject(input: unknown): Record<string, unknown> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SkillBridgeError('input must be an object', 'invalid_input')
  }
  return input as Record<string, unknown>
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new SkillBridgeError(`missing or empty field: ${key}`, 'invalid_input')
  }
  return v
}

function optionalNumber(obj: Record<string, unknown>, key: string, defaultVal: number): number {
  const v = obj[key]
  if (v === undefined || v === null) return defaultVal
  const n = Number(v)
  if (!Number.isFinite(n)) {
    throw new SkillBridgeError(`field ${key} must be a number`, 'invalid_input')
  }
  return n
}

// ── Skill 实现 ────────────────────────────────────────────────────────────────

/**
 * search_knowledge —— 对应 apps/mcp-service/skills/search_knowledge.skill.yaml + .hook.ts
 * 输入：{ query: string, shelf_id?: number, count?: number }
 * 输出：{ results: BookStack page[] }
 */
async function handleSearchKnowledge(input: unknown): Promise<{ results: unknown[] }> {
  const obj = asObject(input)
  const query = requireString(obj, 'query')
  const count = optionalNumber(obj, 'count', 10)
  const results = await searchPages(query, count)
  return { results }
}

/**
 * get_page_content —— 对应 apps/mcp-service/skills/get_page_content.skill.yaml + .hook.ts
 * 输入：{ id: number }
 * 输出：BookStack page detail
 */
async function handleGetPageContent(input: unknown): Promise<unknown> {
  const obj = asObject(input)
  const id = optionalNumber(obj, 'id', NaN)
  if (!Number.isFinite(id) || id <= 0) {
    throw new SkillBridgeError('field id must be a positive number', 'invalid_input')
  }
  return getPageContent(id)
}

/**
 * ontology.query_chunks —— 对应 apps/mcp-service/skills/ontology/query_chunks.skill.yaml
 * 输入：{ query: string, top_k?: integer, space_id?: string }
 * 输出：{ chunks: [{asset_id, score, preview}] }
 *
 * 实现：直接调 hybridSearch.searchHybrid（绕过 qa-service 的 HTTP /api/qa/retrieve roundtrip）。
 * 注意 space_id 在当前 hybridSearch 接口里没有直接对应字段；保留作 Phase 2 接入点。
 */
async function handleOntologyQueryChunks(input: unknown): Promise<{ chunks: unknown[] }> {
  const obj = asObject(input)
  const query = requireString(obj, 'query')
  const top_k = optionalNumber(obj, 'top_k', 10)
  const hits: HybridResult[] = await searchHybrid({ query, top_k })
  return {
    chunks: hits.map((h) => ({
      asset_id: String(h.asset_id),
      score: h.rrf_score,
      preview: (h.chunk_content ?? '').slice(0, 200),
    })),
  }
}

/**
 * ontology.traverse_asset —— 对应 apps/mcp-service/skills/ontology/traverse_asset.skill.yaml
 * 输入：{ asset_id: string|number, max_hop?: integer }（max_hop 当前实现只支持 1，AGE
 *       Cypher 内已硬编码；future 升级到可变 hop 时再透出）
 * 输出：GraphNeighborhood（节点 + 边）
 */
async function handleOntologyTraverseAsset(input: unknown): Promise<GraphNeighborhood> {
  const obj = asObject(input)
  const raw = obj.asset_id
  const assetId = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(assetId) || assetId <= 0) {
    throw new SkillBridgeError('field asset_id must be a positive number or numeric string', 'invalid_input')
  }
  return getAssetNeighborhood(assetId)
}

// ── Skill 目录 ────────────────────────────────────────────────────────────────

/**
 * SKILLS —— 单一真相源（**与 mcp-service yaml manifest 必须一一对齐**，drift 由单测护栏）
 */
export const SKILLS: SkillDescriptor[] = [
  {
    name: 'search_knowledge',
    description: '在 BookStack 知识库中按关键词搜索页面（来自 search_knowledge.skill.yaml v1）',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        shelf_id: { type: 'integer', description: '限定 shelf（可选）' },
        count: { type: 'integer', description: '返回结果数', default: 10 },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' } },
      },
      required: ['results'],
    },
    handler: handleSearchKnowledge,
  },
  {
    name: 'get_page_content',
    description: '按页面 ID 拉 BookStack 页面正文（来自 get_page_content.skill.yaml v1）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'BookStack page id' } },
      required: ['id'],
    },
    outputSchema: { type: 'object' },
    handler: handleGetPageContent,
  },
  {
    name: 'ontology.query_chunks',
    description: '语义召回——查询相关知识片段（来自 ontology/query_chunks.skill.yaml v1）',
    category: 'ontology',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询文本' },
        top_k: { type: 'integer', description: '返回结果数，默认 10', default: 10 },
        space_id: { type: 'string', description: '知识空间 ID（可选）' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        chunks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              asset_id: { type: 'string' },
              score: { type: 'number' },
              preview: { type: 'string' },
            },
          },
        },
      },
      required: ['chunks'],
    },
    handler: handleOntologyQueryChunks,
  },
  {
    name: 'ontology.traverse_asset',
    description: '查询 asset 的邻域（来自 ontology/traverse_asset.skill.yaml v1）',
    category: 'ontology',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: '资产 ID' },
        max_hop: { type: 'integer', description: '最大跳数（当前固定 1）', default: 1 },
      },
      required: ['asset_id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
      },
      required: ['nodes', 'edges'],
    },
    handler: handleOntologyTraverseAsset,
  },
]

const skillIndex = new Map<string, SkillDescriptor>(SKILLS.map((s) => [s.name, s]))

// ── 对外 API ──────────────────────────────────────────────────────────────────

/** 列出所有可用 Skill（不含 handler，用于 LLM tool descriptor 生成） */
export function listSkills(): Array<Omit<SkillDescriptor, 'handler'>> {
  if (!isSkillBridgeEnabled()) return []
  return SKILLS.map(({ handler: _h, ...rest }) => rest)
}

/** 按名调用 Skill；未注册或未启用时抛 SkillBridgeError */
export async function callSkill(name: string, input: unknown): Promise<unknown> {
  if (!isSkillBridgeEnabled()) {
    throw new SkillBridgeError('skill bridge disabled (SKILL_BRIDGE_ENABLED=false)', 'disabled')
  }
  const skill = skillIndex.get(name)
  if (!skill) {
    throw new SkillBridgeError(`skill not found: ${name}`, 'not_found')
  }
  return skill.handler(input)
}

/** 测试用：mcp-service 引用对照路径，护栏单测会读 yaml 比对 */
export const __MCP_YAML_PATHS_FOR_DRIFT_CHECK = [
  'apps/mcp-service/skills/search_knowledge.skill.yaml',
  'apps/mcp-service/skills/get_page_content.skill.yaml',
  'apps/mcp-service/skills/ontology/query_chunks.skill.yaml',
  'apps/mcp-service/skills/ontology/traverse_asset.skill.yaml',
]
