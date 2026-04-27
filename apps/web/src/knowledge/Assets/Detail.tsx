/**
 * /assets/:id —— PRD §10.3 资产详情页
 * 对齐原型 §page-knowledge-asset-detail：
 *  - topbar-crumb 面包屑 + page-title + 返回目录/配置权限
 *  - banner（类型/状态/更新/规模）
 *  - kc-subtabs: 资产列表 / RAGFlow 摘要 / 知识图谱
 *  - surface-card 内容壳，各 Tab 子组件复用
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { getPgAssetDetail, deleteAsset, type PgAssetDetail } from '@/api/assetDirectory'
import DetailAssets from './DetailAssets'
import DetailRagflow from './DetailRagflow'
import DetailGraph from './DetailGraph'
import PermissionsDrawer from '@/knowledge/_shared/PermissionsDrawer'
import RequirePermission from '@/auth/RequirePermission'

type Tab = 'assets' | 'ragflow' | 'graph'

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('assets')
  const [detail, setDetail] = useState<PgAssetDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // F-2 权限抽屉
  const [permOpen, setPermOpen] = useState(false)
  // ADR-30 · 删除状态
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    getPgAssetDetail(Number(id))
      .then((r) => { setDetail(r); setErr(null) })
      .catch((e) => setErr(e?.response?.data?.error || e?.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(() => { load() }, [load])

  const handleDelete = useCallback(async () => {
    if (!detail) return
    const ok = window.confirm(
      `确认删除资产「${detail.asset.name}」？\n\n` +
      `此操作会：\n` +
      `  · 从资产目录移除该条目\n` +
      `  · 清除所有向量切片（${detail.chunks.total} 条）\n` +
      `  · 清除关联图片（${detail.images.length} 张）\n\n` +
      `删除后不可恢复。`,
    )
    if (!ok) return
    setDeleting(true)
    try {
      await deleteAsset(detail.asset.id)
      navigate('/assets')
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e as { message?: string })?.message || '删除失败'
      window.alert(`删除失败：${msg}`)
      setDeleting(false)
    }
  }, [detail, navigate])

  return (
    <div className="page-body">
      {/* Breadcrumb + header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="topbar-crumb" style={{ marginBottom: 8 }}>
            <span style={{ cursor: 'pointer' }} onClick={() => navigate('/overview')}>知识中台</span>
            <span style={{ margin: '0 6px' }}>›</span>
            <span style={{ cursor: 'pointer' }} onClick={() => navigate('/assets')}>资产目录</span>
            <span style={{ margin: '0 6px' }}>›</span>
            <span className="crumb-now">{detail?.asset.name ?? '…'}</span>
          </div>
          <div className="page-title" style={{ marginBottom: 4 }}>
            {detail?.asset.name ?? '加载中…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/assets')}>返回目录</button>
          <RequirePermission name="iam:manage">
            <button
              className="btn primary"
              onClick={() => setPermOpen(true)}
              title="打开该资产的权限抽屉（V2 · F-2）"
              data-testid="perm-btn-asset"
              style={{ whiteSpace: 'nowrap' }}
            >
              🔒 权限设置
            </button>
          </RequirePermission>
          {detail && (
            <RequirePermission name="iam:manage">
              <button
                className="btn"
                onClick={handleDelete}
                disabled={deleting}
                title="永久删除该资产（含切片和图片，不可恢复）"
                data-testid="delete-btn-asset"
                style={{
                  whiteSpace: 'nowrap',
                  color: 'var(--red, #dc2626)',
                  borderColor: 'var(--red, #dc2626)',
                }}
              >
                {deleting ? '删除中…' : '🗑 删除资产'}
              </button>
            </RequirePermission>
          )}
        </div>
      </div>

      <KnowledgeTabs />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
      ) : err ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: 'var(--red)', marginBottom: 8 }}>⚠ {err}</div>
          <button className="btn" onClick={() => navigate('/assets')}>返回目录</button>
        </div>
      ) : detail ? (
        <>
          {/* Banner */}
          <Banner detail={detail} />

          <div style={{ height: 12 }} />

          {/* 3 Tab */}
          <div className="kc-subtabs">
            {[
              { id: 'assets'  as const, label: '资产列表' },
              { id: 'ragflow' as const, label: 'RAGFlow 摘要' },
              { id: 'graph'   as const, label: '知识图谱' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`kc-subtab${tab === t.id ? ' active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="surface-card" style={{ padding: 14 }}>
            {tab === 'assets'  && <DetailAssets detail={detail} />}
            {tab === 'ragflow' && <DetailRagflow detail={detail} />}
            {tab === 'graph'   && <DetailGraph detail={detail} />}
          </div>
        </>
      ) : null}
      {/* F-2 权限抽屉 */}
      {detail && (
        <PermissionsDrawer
          open={permOpen}
          resourceKind="asset"
          resourceId={detail.asset.id}
          resourceName={detail.asset.name}
          onClose={() => setPermOpen(false)}
        />
      )}
    </div>
  )
}

function Banner({ detail }: { detail: PgAssetDetail }) {
  const a = detail.asset
  const statusLabel = a.indexed_at ? '正常' : '待索引'
  const updateStr = a.indexed_at
    ? new Date(a.indexed_at).toLocaleString('zh-CN')
    : '—'

  // ADR-32 · 解析诊断
  const breakdown = a.ingest_chunks_by_kind ?? {}
  const breakdownEntries = Object.entries(breakdown).filter(([, n]) => (n as number) > 0)
  const warnings = a.ingest_warnings ?? []
  const hasDiag = !!a.extractor_id || breakdownEntries.length > 0 || warnings.length > 0

  return (
    <div className="banner">
      <div className="banner-title">资产概览</div>
      <div className="banner-sub">
        类型：{a.type || '—'} · 状态：{statusLabel} · 更新时间：{updateStr}
        {' · '}切片 {detail.chunks.total}
        {detail.images.length > 0 && ` · 图 ${detail.images.length}`}
        {detail.source.name && ` · 来源：${detail.source.name}`}
      </div>

      {/* ADR-32 · 解析诊断行 —— 让用户直接看到 extractorId / chunks 分类 / warnings */}
      {hasDiag && (
        <div
          className="banner-sub"
          style={{
            marginTop: 6,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 12,
            opacity: 0.85,
          }}
          data-testid="ingest-diagnostics"
        >
          {a.extractor_id && (
            <span>
              提取器：<strong style={{ fontFamily: 'monospace' }}>{a.extractor_id}</strong>
            </span>
          )}
          {breakdownEntries.length > 0 && (
            <span>
              切片分类：{breakdownEntries.map(([k, n]) => `${k} ${n}`).join(' · ')}
            </span>
          )}
          {a.external_path && (
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {a.external_path}
            </span>
          )}
          {warnings.length > 0 && (
            <span
              style={{ color: 'var(--amber, #d97706)' }}
              title={warnings.join('\n')}
            >
              ⚠ {warnings.length} 条警告（悬停查看）
            </span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <details style={{ marginTop: 8, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--amber, #d97706)' }}>
            查看 {warnings.length} 条提取警告
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(a.tags?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {a.tags.map((t) => (
            <span key={t} className="pill" style={{ cursor: 'default' }}>
              标签：{t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
