import { runDataAdminPipeline } from '../../services/dataAdminAgent.ts'
import type { Agent, AgentContext } from '../types.ts'

export class DataAdminAgent implements Agent {
  id = 'data_admin' as const
  requiredAction = 'READ' as const

  async run(ctx: AgentContext): Promise<void> {
    await runDataAdminPipeline(ctx.question, ctx.emit, ctx.signal)
  }
}
