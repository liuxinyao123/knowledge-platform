import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadAllSkills, buildMcpSchema } from '../src/skillLoader.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  const skillsDir = path.resolve(__dirname, '../skills')
  const schemaFile = path.resolve(__dirname, '../mcp-schema.json')

  const skills = await loadAllSkills(skillsDir)
  const schema = await buildMcpSchema(skills)

  const jsonStr = JSON.stringify(schema, null, 2)

  // Check mode: compare with existing
  const mode = process.argv[2]
  if (mode === '--check') {
    try {
      const existing = await fs.readFile(schemaFile, 'utf-8')
      const existingJson = JSON.stringify(JSON.parse(existing), null, 2)
      if (jsonStr !== existingJson) {
        console.error('schema drift detected')
        process.exit(1)
      }
      console.log('✓ schema is up-to-date')
    } catch (err) {
      if ((err as any).code === 'ENOENT') {
        console.error('schema file not found')
        process.exit(1)
      }
      throw err
    }
  } else {
    // Build mode: write schema
    await fs.writeFile(schemaFile, jsonStr + '\n')
    console.log(`✓ generated ${schemaFile}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
