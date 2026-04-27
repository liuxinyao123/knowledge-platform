import { getPageContent } from '../services/bookstack.ts'

interface GetPageInput {
  page_id: number
}

export async function runGetPageContent(input: GetPageInput): Promise<string> {
  const page = await getPageContent(input.page_id)
  return JSON.stringify(page)
}
