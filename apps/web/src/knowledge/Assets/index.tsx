/**
 * /assets —— PRD §10.2 资产目录（列表）
 * 对齐原型 §page-knowledge-assets：
 *  - page-body / page-title / page-sub + 右侧 btn/btn primary
 *  - KnowledgeTabs + kc-subtabs（知识治理/资产目录/数据权限）
 *  - 搜索+类型筛选卡
 *  - kc-grid-2 + asset-card/asset-head/asset-ico/asset-name/status-pill/asset-meta-grid/asset-k/asset-v
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { listPgAssets, deleteAsset, type PgAssetCard } from '@/api/assetDirectory'
import { listSpaces, type SpaceSummary } from '@/api/spaces'
import RequirePermission from '@/auth/RequirePermission'

const TYPE_FILTERS = [
  { id: '',           label: '全部' },
  { id: 'structured', label: '结构化' },
  { id: 'document',   label: '文件型' },
  { id: 'online',     label: '在线文档' },
] as const

function statusKind(card: PgAssetCard): { cls: 'ok' | 'proc'; text: string } {
  if (card.indexed_at) return { cls: 'ok', text: '正常' }
  return { cls: 'proc', text: '待索引' }
}

function typeIcon(t: string): string {
  if (t === 'structured') return '🗄'
  if (t === 'online')     return '📄'
  return '📁'   // document / fallback
}

function typeLabel(t: string): string {
  if (t === 'structured') return '结构化'
  if (t === 'online')     return '在线文档'
  if (t === 'document')   return '文件型'
  return t || '—'
}

function fmtTime(iso: string | null): string {
  if (!iso) return '未索引'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1)  return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function Assets() {
  const navigate = useNavigate()
  const [type, setType] = useState<string>('')
  const [kw, setKw] = useState<string>('')
  const [spaceId, setSpaceId] = useState<number | null>(null)
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [items, setItems] = useState<PgAssetCard[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    listPgAssets({
      type: type || undefined,
      spaceId: spaceId ?? undefined,
      limit: 100,
    })
      .then((r) => { setItems(r.items); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [type, spaceId])
  useEffect(() => { load() }, [load])

  // 拉空间列表给筛选器用（只拉一次）
  useEffect(() => {
    listSpaces().then(setSpaces).catch(() => setSpaces([]))
  }, [])

  const filtered = items?.filter((a) =>
    !kw.trim() ? true :
      a.name.toLowerCase().includes(kw.trim().toLowerCase())
      || (a.tags ?? []).some((t) => t.toLowerCase().includes(kw.trim().toLowerCase())),
  ) ?? null

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">资产目录</div>
          <div className="page-sub">数据源 / 文档库 / 在线文档等资产统一视图</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回运行概览</button>
          <button className="btn primary" onClick={() => navigate('/ingest')}>+ 新增数据源</button>
        </div>
      </div>

      <KnowledgeTabs />

      {/* 三联 subtabs —— 治理域导航 */}
      <div className="kc-subtabs">
        <button className="kc-subtab" onClick={() => navigate('/governance')}>知识治理</button>
        <button className="kc-subtab active">资产目录</button>
        <button className="kc-subtab" onClick={() => navigate('/iam')}>数据权限</button>
      </div>

      {/* 搜索 + 空间 + 类型筛选 */}
      <div className="surface-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input
              className="field"
              placeholder="搜索资产名、标签…"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </div>
          <select
            value={spaceId == null ? '' : String(spaceId)}
            onChange={(e) => {
              const v = e.target.value
              setSpaceId(v === '' ? null : Number(v))
            }}
            style={{
              padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 13, background: '#fff', minWidth: 180,
            }}
          >
            <option value="">所有空间</option>
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.visibility === 'private' ? '🔒 ' : '📁 '}{sp.name}
              </option>
            ))}
          </select>
          {kw && <button className="pill" onClick={() => setKw('')}>清除</button>}
        </div>
        <div style={{ height: 10 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setType(f.id)}
              className={`kc-subtab${type === f.id ? ' active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 资产卡网格 */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
      ) : err ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ color: 'var(--red)', marginBottom: 8 }}>⚠ {err}</div>
          <button className="btn" onClick={load}>重试</button>
        </div>
      ) : !filtered || filtered.length === 0 ? (
        <div className="empty-state" style={{
          padding: 60, background: '#f9fafb',
          border: '1px dashed var(--border)', borderRadius: 12,
        }}>
          <div className="empty-illus">📦</div>
          <div className="empty-text">当前条件下无资产</div>
          {(kw || type || spaceId != null) && (
            <button className="btn" onClick={() => { setKw(''); setType(''); setSpaceId(null) }}>清除筛选</button>
          )}
        </div>
      ) : (
        <div className="kc-grid-2">
          {filtered.map((card) => {
            const status = statusKind(card)
            const onRowDelete = async (e: React.MouseEvent) => {
              e.stopPropagation()  // 不要触发卡片的 onClick 跳转
              const ok = window.confirm(
                `确认删除资产「${card.name}」？\n\n` +
                `会清除 ${card.chunks_total} 个切片${card.images_total ? `、${card.images_total} 张图` : ''}，不可恢复。`,
              )
              if (!ok) return
              try {
                await deleteAsset(card.id)
                // 本地乐观更新，不等重新拉
                setItems((prev) => (prev ? prev.filter((c) => c.id !== card.id) : prev))
              } catch (err) {
                const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
                  || (err as { message?: string })?.message || '删除失败'
                window.alert(`删除失败：${msg}`)
              }
            }
            return (
              <div
                key={card.id}
                className="asset-card"
                onClick={() => navigate(`/assets/${card.id}`)}
              >
                <div className="asset-head">
                  <div className="asset-ico">{typeIcon(card.type)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="asset-name"
                      style={{
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={card.name}
                    >
                      {card.name}
                    </div>
                  </div>
                  <div className={`status-pill ${status.cls}`}>
                    <span className="status-dot" />
                    {status.text}
                  </div>
                  <RequirePermission name="iam:manage">
                    <button
                      className="btn"
                      onClick={onRowDelete}
                      title="永久删除该资产（不可恢复）"
                      aria-label={`删除资产 ${card.name}`}
                      data-testid={`delete-btn-card-${card.id}`}
                      style={{
                        marginLeft: 8,
                        padding: '2px 8px',
                        fontSize: 12,
                        color: 'var(--red, #dc2626)',
                        borderColor: 'var(--red, #dc2626)',
                      }}
                    >
                      🗑
                    </button>
                  </RequirePermission>
                </div>
                <div className="asset-meta-grid">
                  <div>
                    <div className="asset-k">类型</div>
                    <div className="asset-v">{typeLabel(card.type)}</div>
                  </div>
                  <div>
                    <div className="asset-k">更新时间</div>
                    <div className="asset-v">{fmtTime(card.indexed_at)}</div>
                  </div>
                  <div>
                    <div className="asset-k">规模</div>
                    <div className="asset-v">
                      {card.chunks_total.toLocaleString()} 切片
                      {card.images_total ? ` · ${card.images_total} 图` : ''}
                    </div>
                  </div>
                </div>
                {card.tags && card.tags.length > 0 && (
                  <div className="tag-row">
                    {card.tags.slice(0, 5).map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
