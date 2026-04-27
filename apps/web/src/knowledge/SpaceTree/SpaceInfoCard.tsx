/**
 * SpaceInfoCard —— 空间信息卡
 *
 * 原型图对应："空间信息" 区块（Owner / 可见范围 / 文档数 + name/desc）
 */
import type { SpaceDetail } from '@/api/spaces'

interface Props {
  space: SpaceDetail
  onEdit: () => void
  canEdit: boolean
}

export default function SpaceInfoCard({ space, onEdit, canEdit }: Props) {
  return (
    <div style={{
      padding: '14px 16px',
      border: '1px solid var(--border)', borderRadius: 10,
      background: '#fff',
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>空间信息</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {space.name}
          </div>
          {space.description && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              {space.description}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--text)' }}>
            <span>所有者：<strong>{space.owner_email}</strong></span>
            <span>
              {space.visibility === 'org' ? '公开：组织内' : '私有：仅成员'}
            </span>
            <span>文档: <strong>{space.doc_count.toLocaleString()}</strong></span>
            <span>数据源: {space.source_count}</span>
            <span>成员: {space.member_count}</span>
          </div>
        </div>
        {canEdit && (
          <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onEdit}>
            编辑
          </button>
        )}
      </div>
    </div>
  )
}
