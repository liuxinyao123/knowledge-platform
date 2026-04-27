import dotenv from 'dotenv'
import { existsSync } from 'node:fs'

const envPath = new URL('../.env', import.meta.url).pathname
if (existsSync(envPath)) dotenv.config({ path: envPath, override: true })

import { getPgPool, runPgMigrations } from '../src/services/pgDb.ts'
import { embedTexts, isEmbeddingConfigured } from '../src/services/embeddings.ts'
import { chunkDocument } from '../src/services/chunkDocument.ts'

const BS_URL = process.env.BOOKSTACK_URL ?? 'http://localhost:6875'
const TOKEN_ID = process.env.BOOKSTACK_TOKEN_ID ?? ''
const TOKEN_SECRET = process.env.BOOKSTACK_TOKEN_SECRET ?? ''

async function bsFetch(path: string) {
  const res = await fetch(`${BS_URL}/api${path}`, {
    headers: { Authorization: `Token ${TOKEN_ID}:${TOKEN_SECRET}` },
  })
  if (!res.ok) throw new Error(`BookStack API ${res.status}: ${path}`)
  return res.json()
}

async function ensureUniqueIndex(pool: ReturnType<typeof getPgPool>) {
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_source_ext
    ON metadata_asset(source_id, external_id)
  `).catch(() => {})
}

async function syncPage(pool: ReturnType<typeof getPgPool>, sourceId: number, pageId: number) {
  const page = await bsFetch(`/pages/${pageId}`) as {
    id: number; name: string; book_id: number; slug: string
    html?: string; raw_html?: string; updated_at?: string
  }
  const text = (page.html ?? page.raw_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const url = `${BS_URL}/books/${page.book_id}/page/${page.slug}`

  const { rows: [asset] } = await pool.query(
    `INSERT INTO metadata_asset (source_id, external_id, name, type, path, content, metadata, updated_at)
     VALUES ($1, $2, $3, 'document', $4, $5, $6, NOW())
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET name = EXCLUDED.name, content = EXCLUDED.content,
           metadata = EXCLUDED.metadata, updated_at = NOW()
     RETURNING id`,
    [sourceId, String(pageId), page.name, url, text, JSON.stringify({ url, updated_at: page.updated_at })]
  )

  const assetId: number = asset.id
  await pool.query('DELETE FROM metadata_field WHERE asset_id = $1', [assetId])

  if (!text) return

  const { l1, l2, l3 } = chunkDocument(text)
  const embeddings = isEmbeddingConfigured() && l3.length > 0 ? await embedTexts(l3) : []

  const allChunks = [
    ...l1.map((c) => ({ level: 1, content: c, embedding: null as number[] | null })),
    ...l2.map((c) => ({ level: 2, content: c, embedding: null as number[] | null })),
    ...l3.map((c, i) => ({ level: 3, content: c, embedding: embeddings[i] ?? null })),
  ]

  for (let i = 0; i < allChunks.length; i++) {
    const { level, content, embedding } = allChunks[i]
    await pool.query(
      `INSERT INTO metadata_field (asset_id, chunk_index, chunk_level, content, embedding, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assetId, i, level, content, embedding ? `[${embedding.join(',')}]` : null, Math.ceil(content.length / 1.5)]
    )
  }

  await pool.query('UPDATE metadata_asset SET indexed_at = NOW() WHERE id = $1', [assetId])
  console.log(`  ✓ page ${pageId} "${page.name}" → ${allChunks.length} chunks`)
}

async function main() {
  await runPgMigrations()
  const pool = getPgPool()
  await ensureUniqueIndex(pool)

  const { rows: [src] } = await pool.query(
    `SELECT id FROM metadata_source WHERE connector = 'bookstack' LIMIT 1`
  )
  const sourceId: number = src.id
  console.log(`Using metadata_source id=${sourceId}`)

  const shelves = await bsFetch('/shelves?count=100') as { data: { id: number }[] }
  for (const shelf of shelves.data) {
    const shelfDetail = await bsFetch(`/shelves/${shelf.id}`) as { books: { id: number }[] }
    for (const book of shelfDetail.books) {
      const bookDetail = await bsFetch(`/books/${book.id}`) as {
        contents: { type: string; id: number }[]
      }
      for (const item of bookDetail.contents) {
        if (item.type === 'page') {
          await syncPage(pool, sourceId, item.id)
        } else if (item.type === 'chapter') {
          const chapter = await bsFetch(`/chapters/${item.id}`) as { pages: { id: number }[] }
          for (const p of chapter.pages) await syncPage(pool, sourceId, p.id)
        }
      }
    }
  }

  console.log('\n✅ Sync complete')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
