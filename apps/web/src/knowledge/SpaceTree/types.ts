/**
 * SpaceTree types —— PG metadata_source / metadata_asset 两层模型
 *
 * 历史：原本基于 BookStack shelf/book/chapter/page 四层，2026-04-22 重写为两层
 * （source → asset），与新 ingest pipeline (ingestPipeline → metadata_asset) 对齐。
 */

export type SourceNode = {
  id: number
  name: string
  type: string | null
  connector: string | null
  status: string | null
  assetCount: number
  expanded: boolean
  loading: boolean
  loaded: boolean
  assets?: AssetItem[]
}

export type AssetItem = {
  id: number
  name: string
  type: string
  tags: string[] | null
  indexedAt: string | null
  chunksTotal: number
  imagesTotal: number
}

/** 选中资产的精简摘要（原在 index.tsx；ADR 2026-04-23-26 space-permissions 改造后搬进此文件） */
export interface SelectedAsset {
  id: number
  name: string
  sourceName: string
  type: string
  tags: string[] | null
  indexedAt: string | null
}
