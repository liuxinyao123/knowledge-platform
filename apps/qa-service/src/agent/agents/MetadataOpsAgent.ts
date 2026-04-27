/**
 * MetadataOpsAgent —— 数据资产目录治理 Agent
 *
 * Phase 1：只做只读工具 list_sources / list_assets / describe_field / list_acl_rules
 * 写操作一律回 not_implemented；正式上线等后续 change。
 *
 * 权限：requiredAction=ADMIN（unified-auth 挂载时会强制）。
 */
import { getPgPool } from '../../services/pgDb.ts'
import type { Agent, AgentContext } from '../types.ts'

export class MetadataOpsAgent implements Agent {
  id = 'metadata_ops' as const
  requiredAction = 'ADMIN' as const

  async run(ctx: AgentContext): Promise<void> {
    const { question, emit, signal } = ctx
    if (signal.aborted) return

    emit({ type: 'rag_step', icon: '🗂', label: '正在路由元数据治理请求...' })

    const lower = question.toLowerCase()
    const isWrite = /(新建|创建|修改|更新|删除|下线|delete|update|insert|create)/i.test(question)

    if (isWrite) {
      emit({
        type: 'content',
        text: '写操作（新增 / 修改 / 删除）当前尚未开放给 Agent，请使用 Admin API 或 UI 操作。',
      })
      emit({ type: 'trace', data: { status: 'not_implemented', reason: 'write ops stub' } })
      emit({ type: 'done' })
      return
    }

    try {
      const pool = getPgPool()

      if (lower.includes('源') || lower.includes('source')) {
        const { rows } = await pool.query(
          `SELECT id, name, type, connector, status FROM metadata_source ORDER BY id`,
        )
        emit({ type: 'content', text: formatList('数据源', rows) })
        emit({ type: 'trace', data: { tool: 'list_sources', count: rows.length } })
      } else if (lower.includes('规则') || lower.includes('acl')) {
        const { rows } = await pool.query(
          `SELECT id, source_id, asset_id, role, permission
           FROM metadata_acl_rule ORDER BY id LIMIT 100`,
        )
        emit({ type: 'content', text: formatList('ACL 规则', rows) })
        emit({ type: 'trace', data: { tool: 'list_acl_rules', count: rows.length } })
      } else {
        const { rows } = await pool.query(
          `SELECT id, name, type, path FROM metadata_asset
           ORDER BY created_at DESC LIMIT 50`,
        )
        emit({ type: 'content', text: formatList('数据资产', rows) })
        emit({ type: 'trace', data: { tool: 'list_assets', count: rows.length } })
      }
      emit({ type: 'done' })
    } catch (err) {
      emit({
        type: 'error',
        message: err instanceof Error ? err.message : 'metadata query failed',
      })
      emit({ type: 'done' })
    }
  }
}

function formatList(title: string, rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return `${title}：当前为空。`
  const lines = [`### ${title}（共 ${rows.length} 条）`, '']
  for (const r of rows.slice(0, 20)) {
    const pairs = Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' | ')
    lines.push(`- ${pairs}`)
  }
  if (rows.length > 20) lines.push(`… 仅展示前 20 条`)
  return lines.join('\n')
}
