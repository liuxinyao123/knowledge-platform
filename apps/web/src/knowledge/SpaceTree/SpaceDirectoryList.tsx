/**
 * SpaceDirectoryList —— 目录结构
 *
 * 原型图对应："目录结构" 列表；每行一个分组 + source 列表
 * 数据模型：source 的分组视图（按 metadata_source.config->>'group_tag' 分组）
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSpaceSources, type SpaceSourceGroup } from '@/api/spaces'

interface Props {
  spaceId: number
  canEdit: boolean
  onAttachSource: () => void
}

function formatRelative(ms: number): string {
  if (!ms) return '—'
  const d = Date.now() - ms
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const w = Math.floor(days / 7)
  if (w < 5) return `${w} 周前`
  return new Date(ms).toLocaleDateString()
}

export default function SpaceDirectoryList({ spaceId, canEdit, onAttachSource }: Props) {
  const [groups, setGroups] = useState<SpaceSourceGroup[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    setGroups(null); setErr(null)
    listSpaceSources(spaceId, 'tag')
      .then((g) => { if (alive) setGroups(g) })
      .catch((e) => { if (alive) { setErr((e as Error).message); setGroups([]) } })
    return () => { alive = false }
  }, [spaceId])

  return (
    <div style={{
      padding: '14px 16px',
      border: '1px solid var(--border)', borderRadius: 10,
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>目录结构</div>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <>
            <button
              className="btn" style={{ padding: '3px 10px', fontSize: 12, marginRight: 6 }}
              onClick={onAttachSource}
            >
              + 关联数据源
            </button>
            <button
              className="btn" style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={() => navigate(`/spaces/${spaceId}/tree`)}
            >
              浏览资产树 ↗
            </button>
          </>
        )}
      </div>
      {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      {groups === null && <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>加载中…</div>}
      {groups && groups.length === 0 && (
        <div style={{
          padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12,
          background: '#f9fafb', border: '1px dashed var(--border)', borderRadius: 10,
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
          <div>该空间暂未关联数据源</div>
          {canEdit && <div style={{ marginTop: 6, fontSize: 11 }}>点上方「关联数据源」开始</div>}
        </div>
      )}
      {groups && groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 4 }}>
          <div style={{
            padding: '8px 12px', borderRadius: 8, background: '#fafaf9',
            display: 'flex', alignItems: 'center', gap: 8,
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 14 }}>📁</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {g.sources.length} 条 · 最近更新：{g.sources.length > 0 ? formatRelative(Math.max(...g.sources.map((s) => s.updated_at_ms))) : '—'}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>›</span>
          </div>
          <div style={{ paddingLeft: 18, marginTop: 4 }}>
            {g.sources.map((s) => (
              <div key={s.id} style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 6,
                display: 'flex', alignItems: 'center', gap: 8,
                color: 'var(--text)',
              }}>
                <span>•</span>
                <span style={{ flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {s.asset_count} 资产
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
