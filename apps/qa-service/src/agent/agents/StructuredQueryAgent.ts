import type { Agent, AgentContext } from '../types.ts'

/**
 * 占位 Agent —— 结构化查询层尚未建设（依赖 MCP 结构化层 change）。
 * 明确告知用户"建设中"，避免误导。
 */
export class StructuredQueryAgent implements Agent {
  id = 'structured_query' as const
  requiredAction = 'READ' as const

  async run(ctx: AgentContext): Promise<void> {
    ctx.emit({ type: 'rag_step', icon: '🧰', label: '结构化查询能力尚未实现' })
    ctx.emit({
      type: 'content',
      text:
        '结构化查询（SQL / Schema 发现）功能正在建设中，预计随「MCP 结构化查询层」Change 交付。'
        + '\n\n如果你实际想问的是知识库内容，请改用 @知识问答。',
    })
    ctx.emit({ type: 'trace', data: { status: 'not_implemented' } })
    ctx.emit({ type: 'done' })
  }
}
