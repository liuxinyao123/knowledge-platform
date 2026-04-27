/**
 * /spaces/:id/tree —— 旧 source→asset 树的落脚点
 *
 * 背景：2026-04-22 从 BookStack shelf/book/chapter/page 瘦身到 source→asset 两层。
 * ADR 2026-04-23-26 把空间页改成"空间+成员+目录"之后，这套资产浏览器搬到空间详情的子路由下。
 *
 * 复用已有 TreePane + PreviewPane，数据源 API 不变（仍是 /api/asset-directory/pg-*）。
 * 当前 TreePane 不过滤空间归属（只按 source→asset）；后端评估已按 space_id 过滤，
 * 即便 TreePane 列出了非本空间的 source，点进去时 API 会被 ACL 拦。
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import TreePane from './TreePane'
import PreviewPane from './PreviewPane'
import type { SelectedAsset } from './types'

export default function SpaceSourceTreePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(null)
  const spaceId = Number(id)

  return (
    <div className="page-body" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">资产树浏览</div>
          <div className="page-sub">
            空间 #{spaceId} · 数据源 → 资产（两层，受空间 ACL 过滤）
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate(`/spaces/${spaceId}`)}>
            ← 返回空间详情
          </button>
        </div>
      </div>
      <div className="split" style={{ flex: 1, minHeight: 520 }}>
        <div className="surface-card split-left panel">
          <div className="panel-head">
            <div className="title">数据源 · 资产</div>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <TreePane
              onSelectAsset={setSelectedAsset}
              selectedAssetId={selectedAsset?.id ?? null}
            />
          </div>
        </div>
        <div className="surface-card split-right panel">
          <div className="panel-head">
            <div className="title">{selectedAsset ? selectedAsset.name : '资产详情'}</div>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <PreviewPane asset={selectedAsset} />
          </div>
        </div>
      </div>
    </div>
  )
}
