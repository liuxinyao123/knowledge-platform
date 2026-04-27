import axios from 'axios'

const client = axios.create({ baseURL: '/api/asset-directory' })

export type AssetSourceRow = {
  id: number
  name: string
  sourceType: string
  systemName: string
  status: string
  assetCount: number
  updatedAtMs: number
}

export type AssetItemRow = {
  id: number
  sourceId: number
  externalRef: string
  name: string
  assetType: string
  summary?: string | null
  summaryStatus: string
  ingestStatus: string
  updatedAtMs: number
}

export async function fetchAssetSources() {
  const { data } = await client.get<{ sources: AssetSourceRow[] }>('/sources')
  return data.sources
}

export async function fetchAssetItems(sourceId: number, limit = 50, offset = 0) {
  const { data } = await client.get<{ items: AssetItemRow[]; total: number }>(
    `/sources/${sourceId}/items`,
    { params: { limit, offset } },
  )
  return data
}

export async function fetchAssetItemDetail(itemId: number) {
  const { data } = await client.get<{
    item: AssetItemRow & { summary?: string | null }
    rag: {
      chunkCount: number
      pageId: number | null
      indexed: boolean
      linkStatus?: string | null
      vectorMappingId?: string | null
    }
    graph: { status: string; message?: string }
  }>(`/items/${itemId}`)
  return data
}

export async function syncBookstackPages(sourceId?: number) {
  const { data } = await client.post<{
    ok: boolean
    sourceId: number
    upserted: number
    linksUpdated?: number
  }>('/sync-pages', sourceId ? { sourceId } : {})
  return data
}

export async function refreshKnowledgeLinks(sourceId?: number) {
  const { data } = await client.post<{ ok: boolean; sourceId: number; linksUpdated: number }>(
    '/refresh-knowledge-links',
    sourceId ? { sourceId } : {},
  )
  return data
}

export async function enrichAssetSummaries(sourceId?: number, limit?: number) {
  const { data } = await client.post<{ ok: boolean; sourceId: number; processed: number }>(
    '/enrich-summaries',
    { ...(sourceId != null ? { sourceId } : {}), ...(limit != null ? { limit } : {}) },
  )
  return data
}

/** 入库成功后：登记 BookStack 页面到资产目录并写入向量切片（走 /api/asset-directory，与「同步页面」同服务） */
export async function registerBookstackPageForAssets(pageId: number, summary?: string): Promise<void> {
  await client.post('/register-bookstack-page', {
    pageId,
    ...(summary ? { summary } : {}),
  })
}

// ── PRD §10 资产目录（pgvector metadata_asset） ─────────────────────────────

export interface PgAssetCard {
  id: number
  name: string
  type: string
  tags: string[] | null
  indexed_at: string | null
  source_name: string | null
  connector: string | null
  chunks_total: number
  images_total: number
}

export interface PgAssetDetail {
  asset: {
    id: number; name: string; type: string; path?: string | null
    tags: string[]; indexed_at: string | null
    author: string | null; merged_into: number | null
    // ADR-32 · 解析诊断
    extractor_id?: string | null
    ingest_warnings?: string[]
    ingest_chunks_by_kind?: Record<string, number> | null
    external_path?: string | null
  }
  source: {
    id: number; name: string | null; type: string | null; connector: string | null
  }
  chunks: {
    headings: Array<{ page: number; text: string; heading_path: string | null }>
    samples: Array<{ page: number; text: string; kind: string | null }>
    total: number
  }
  images: Array<{ id: number; page: number; image_index: number; caption: string | null; file_path: string }>
  graph: {
    nodes: Array<{ id: string; label: string; count?: number; type: 'entity' | 'template' }>
    edges: Array<{ from: string; to: string; label: string; kind: 'fk' | 'logical' }>
  }
}

export async function listPgAssets(
  opts: { limit?: number; offset?: number; type?: string; sourceId?: number; spaceId?: number } = {},
): Promise<{ items: PgAssetCard[]; total: number }> {
  const params: Record<string, unknown> = {}
  if (opts.limit  != null) params.limit  = opts.limit
  if (opts.offset != null) params.offset = opts.offset
  if (opts.type)           params.type   = opts.type
  if (opts.sourceId != null) params.source_id = opts.sourceId
  if (opts.spaceId  != null) params.space_id  = opts.spaceId
  const { data } = await client.get('/pg-assets', { params })
  return data
}

export interface PgSourceRow {
  id: number
  name: string
  type: string | null
  connector: string | null
  status: string | null
  asset_count: number
  created_at_ms: number
}

export async function listPgSources(): Promise<PgSourceRow[]> {
  const { data } = await client.get<{ sources: PgSourceRow[] }>('/pg-sources')
  return data.sources
}

export async function createPgSource(input: {
  name: string
  description?: string
  type?: string
  connector?: string
}): Promise<PgSourceRow> {
  const { data } = await client.post<PgSourceRow>('/pg-sources', input)
  return data
}

export async function getPgAssetDetail(id: number): Promise<PgAssetDetail> {
  const { data } = await client.get(`/pg-assets/${id}/detail`)
  return data
}

// ── 资产删除（ADR-30 · 2026-04-24） ───────────────────────────────────────
// 走 /api/knowledge/documents/:id（knowledgeDocs 路由），需要 iam:manage 或对应 source 的 DELETE 权限。
// 成功后上游 metadata_field / metadata_asset_image 通过 FK ON DELETE CASCADE 清；
// 磁盘图片目录 best-effort 清理；同时落 audit_log 'asset_delete'。
const knowledgeClient = axios.create({ baseURL: '/api/knowledge' })
export async function deleteAsset(id: number): Promise<{ ok: boolean; deleted: { id: number; name: string } }> {
  const { data } = await knowledgeClient.delete<{ ok: boolean; deleted: { id: number; name: string } }>(`/documents/${id}`)
  return data
}
