import type { AssetPanelSsePayload, EmitFn } from '../ragTypes.ts'
import { getPool } from './db.ts'
import {
  getDefaultBookstackSourceId,
  refreshKnowledgeLinksForSource,
  syncBookstackAssetsForSource,
} from './assetCatalog.ts'
import { chatComplete, isLlmConfigured, getLlmFastModel } from './llm.ts'
import type { ChatMessage, OAITool } from './llm.ts'

// ── Tool 定义（OpenAI function-calling 格式） ────────────────────────────────

const TOOLS: OAITool[] = [
  {
    type: 'function',
    function: {
      name: 'list_asset_sources',
      description: '列出平台中已注册的数据源（名称、类型、资产数量）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_asset_items',
      description: '在指定数据源下按名称模糊搜索资产',
      parameters: {
        type: 'object',
        properties: {
          source_id: { type: 'number', description: '数据源 id' },
          query:     { type: 'string', description: '搜索关键词' },
          limit:     { type: 'number', description: '最多返回条数，默认 15' },
        },
        required: ['source_id', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_bookstack_pages',
      description: '从 BookStack 同步所有页面到资产目录，并刷新向量映射状态',
      parameters: {
        type: 'object',
        properties: {
          source_id: { type: 'number', description: '可选，默认主 BookStack 源' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_asset_panel',
      description: '在问答页右侧打开「资产目录」并可定位数据源/资产 Tab',
      parameters: {
        type: 'object',
        properties: {
          source_id: { type: 'number' },
          item_id:   { type: 'number' },
          tab:       { type: 'string', enum: ['assets', 'rag', 'graph'] },
        },
        required: [],
      },
    },
  },
]

// ── 关键词检测 ───────────────────────────────────────────────────────────────

export function isDataAdminQuestion(question: string): boolean {
  const q = question.trim()
  if (/^@(数据管理员|资产)/.test(q)) return true
  if (/数据管理员专家/.test(q)) return true
  if (/#资产(目录)?/i.test(q)) return true
  return false
}

// ── 工具执行 ────────────────────────────────────────────────────────────────

async function execTool(
  name: string,
  input: Record<string, unknown>,
  emit: EmitFn,
): Promise<string> {
  const pool = getPool()

  if (name === 'list_asset_sources') {
    const [rows] = await pool.execute(
      'SELECT id, name, source_type, asset_count, status FROM asset_source ORDER BY id',
    )
    return JSON.stringify({ sources: rows })
  }

  if (name === 'search_asset_items') {
    const sourceId = Number(input.source_id)
    const query = String(input.query ?? '').trim()
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 15)))
    if (!Number.isFinite(sourceId) || !query) {
      return JSON.stringify({ error: 'source_id 与 query 必填' })
    }
    const [rows] = await pool.execute(
      `SELECT id, name, external_ref, summary_status FROM asset_item
       WHERE source_id = ? AND LOCATE(?, name) > 0 ORDER BY id LIMIT ?`,
      [sourceId, query, limit | 0],
    )
    return JSON.stringify({ items: rows })
  }

  if (name === 'sync_bookstack_pages') {
    let sid = Number(input.source_id)
    if (!Number.isFinite(sid) || sid <= 0) {
      const def = await getDefaultBookstackSourceId(pool)
      if (def == null) return JSON.stringify({ error: '未找到 bookstack 数据源' })
      sid = def
    }
    const out = await syncBookstackAssetsForSource(pool, sid)
    await refreshKnowledgeLinksForSource(pool, sid)
    emit({ type: 'rag_step', icon: '📥', label: `已同步 BookStack 页面 ${out.upserted} 条` })
    return JSON.stringify({ ok: true, sourceId: sid, upserted: out.upserted })
  }

  if (name === 'open_asset_panel') {
    const data: AssetPanelSsePayload = {
      open: true,
      sourceId: Number.isFinite(Number(input.source_id)) ? Number(input.source_id) : undefined,
      itemId:   Number.isFinite(Number(input.item_id))   ? Number(input.item_id)   : undefined,
      tab:
        input.tab === 'rag' || input.tab === 'graph' || input.tab === 'assets'
          ? input.tab
          : undefined,
    }
    emit({ type: 'asset_panel', data })
    return JSON.stringify({ ok: true, ui: 'opened asset panel', ...data })
  }

  return JSON.stringify({ error: `unknown tool: ${name}` })
}

// ── 数据管理员 Pipeline ───────────────────────────────────────────────────────

export async function runDataAdminPipeline(
  question: string,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  if (!isLlmConfigured()) {
    emit({
      type: 'content',
      text: '数据管理员专家需要配置 LLM API Key（SILICONFLOW_API_KEY）。也可在右侧「资产目录」中手动同步与查看。',
    })
    emit({ type: 'done' })
    return
  }

  emit({ type: 'rag_step', icon: '🛡', label: '数据管理员专家：理解意图…' })

  const system = `你是「数据管理员专家」，帮助用户在知识平台中查看数据源、搜索资产、同步 BookStack 页面到资产目录、打开右侧资产面板。
规则：优先使用工具完成操作；回答使用简洁中文；同步类操作前先确认用户意图已包含同步请求再调用 sync_bookstack_pages。`

  const messages: ChatMessage[] = [{ role: 'user', content: question }]

  for (let round = 0; round < 8; round++) {
    if (signal.aborted) return

    const { content, toolCalls, rawMessage } = await chatComplete(messages, {
      model: getLlmFastModel(),
      maxTokens: 2048,
      system,
      tools: TOOLS,
    })

    if (content) emit({ type: 'content', text: content })

    if (!toolCalls.length) break

    // 把 assistant 回复（含 tool_calls）追加到历史
    messages.push(rawMessage)

    // 执行每个工具，结果以 role:'tool' 追加
    for (const tc of toolCalls) {
      if (signal.aborted) return
      emit({ type: 'rag_step', icon: '🔧', label: `调用 ${tc.function.name}` })
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function.arguments) } catch { /* ignore */ }
      const out = await execTool(tc.function.name, input, emit)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
    }
  }

  emit({ type: 'done' })
}
