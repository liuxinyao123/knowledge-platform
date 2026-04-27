import { SkillContext } from '../src/skillLoader.ts'
import { searchKnowledge } from '../src/services/bookstack.ts'

interface SearchInput {
  query: string
  shelf_id?: number
  count?: number
}

interface SearchResult {
  name: string
  excerpt: string
  url: string
  type: string
  book_name: string
}

interface SearchOutput {
  results: SearchResult[]
}

export async function run(input: SearchInput, ctx: SkillContext): Promise<SearchOutput> {
  const count = input.count ?? 10
  const results = await searchKnowledge(input.query, count, input.shelf_id)
  return { results }
}
