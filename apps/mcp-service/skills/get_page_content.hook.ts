import { SkillContext } from '../src/skillLoader.ts'
import { getPageContent } from '../src/services/bookstack.ts'

interface GetPageInput {
  page_id: number
}

interface GetPageOutput {
  name: string
  content: string
  url: string
  tags: string[]
  updated_at: string
}

export async function run(input: GetPageInput, ctx: SkillContext): Promise<GetPageOutput> {
  return await getPageContent(input.page_id)
}
