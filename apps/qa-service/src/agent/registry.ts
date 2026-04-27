import type { Agent, AgentIntent } from './types.ts'
import { KnowledgeQaAgent } from './agents/KnowledgeQaAgent.ts'
import { DataAdminAgent } from './agents/DataAdminAgent.ts'
import { StructuredQueryAgent } from './agents/StructuredQueryAgent.ts'
import { MetadataOpsAgent } from './agents/MetadataOpsAgent.ts'

const _registry: Record<AgentIntent, Agent> = {
  knowledge_qa: new KnowledgeQaAgent(),
  data_admin: new DataAdminAgent(),
  structured_query: new StructuredQueryAgent(),
  metadata_ops: new MetadataOpsAgent(),
}

export function getAgent(intent: AgentIntent): Agent {
  return _registry[intent]
}

export function registry(): Record<AgentIntent, Agent> {
  return _registry
}

/** 测试辅助：替换某个 Agent */
export function __setAgentForTest(intent: AgentIntent, agent: Agent): void {
  _registry[intent] = agent
}
