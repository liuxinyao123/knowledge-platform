import { searchKnowledge } from '../services/bookstack.ts'

interface SearchInput {
  query: string
  shelf_id?: number
  count?: number
}

export async function runSearchKnowledge(input: SearchInput): Promise<string> {
  const results = await searchKnowledge(input.query, input.count ?? 10, input.shelf_id)
  return JSON.stringify({ results })
}
