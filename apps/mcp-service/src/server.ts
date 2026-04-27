import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { loadAllSkills, registerAll } from './skillLoader.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = new URL('.', import.meta.url).pathname

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'knowledge-mcp',
    version: '1.0.0',
  })

  const skillsDir = resolve(__dirname, '../skills')
  const skills = await loadAllSkills(skillsDir)
  registerAll(server, skills)

  return server
}
