/**
 * TreePane —— PG 数据源 / 资产 两层树
 *
 * 节点：
 *   📂 source (metadata_source)   —— 一级，展开 lazy-load 资产列表
 *      📄 asset  (metadata_asset) —— 二级，点击触发 onSelectAsset
 *
 * 与新 ingest pipeline 完全对齐：upload-full / fetch-url / conversation
 * 写入 metadata_asset 后立即在这里出现。
 */
import { useEffect, useState, useCallback } from 'react'
import { listPgSources, listPgAssets, type PgSourceRow } from '@/api/assetDirectory'
import type { SourceNode, AssetItem, SelectedAsset } from './types'
import CreateSourceModal from './CreateSourceModal'
import PermissionsDrawer from '@/knowledge/_shared/PermissionsDrawer'
import RequirePermission from '@/auth/RequirePermission'

interface Props {
  onSelectAsset: (asset: SelectedAsset) => void
  selectedAssetId: number | null
}

const ASSET_TYPE_ICON: Record<string, string> = {
  document:   '📄',
  structured: '🗄',
  online:     '🌐',
}

function srcRowToNode(s: PgSourceRow): SourceNode {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    connector: s.connector,
    status: s.status,
    assetCount: s.asset_count,
    expanded: false,
    loading: false,
    loaded: false,
  }
}

export default function TreePane({ onSelectAsset, selectedAssetId }: Props) {
  const [sources, setSources] = useState<SourceNode[]>([])
  const [rootLoading, setRootLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // F-2 权限抽屉
  const [permDrawer, setPermDrawer] = useState<{ sourceId: number; sourceName: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await listPgSources()
      setSources((prev) => list.map((s) => {
        const old = prev.find((p) => p.id === s.id)
        const node = srcRowToNode(s)
        if (old) {
          node.expanded = old.expanded
          node.loaded = old.loaded
          node.assets = old.assets
        }
        return node
      }))
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setRootLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const toggleSource = useCallback(async (id: number) => {
    const node = sources.find((s) => s.id === id)
    if (!node) return
    if (node.expanded) {
      setSources((prev) => prev.map((s) => s.id === id ? { ...s, expanded: false } : s))
      return
    }
    if (node.loaded) {
      setSources((prev) => prev.map((s) => s.id === id ? { ...s, expanded: true } : s))
      return
    }
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, loading: true } : s))
    try {
      const { items } = await listPgAssets({ sourceId: id, limit: 200 })
      const assets: AssetItem[] = items.map((it) => ({
        id: it.id,
        name: it.name,
        type: it.type,
        tags: it.tags,
        indexedAt: it.indexed_at,
        chunksTotal: it.chunks_total,
        imagesTotal: it.images_total,
      }))
      setSources((prev) => prev.map((s) => s.id === id ? {
        ...s, loading: false, loaded: true, expanded: true, assets,
      } : s))
    } catch (e) {
      setSources((prev) => prev.map((s) => s.id === id ? { ...s, loading: false } : s))
      setErr(e instanceof Error ? e.message : 'load assets failed')
    }
  }, [sources])

  if (rootLoading) {
    return (
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 28, borderRadius: 6, background: 'var(--border)', opacity: 0.5 }} />
        ))}
      </div>
    )
  }

  if (err) {
    return <div style={{ padding: 16, color: '#b91c1c', fontSize: 13 }}>{err}</div>
  }

  return (
    <>
      <div style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sources.length} 个数据源</span>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            fontSize: 12,
            color: 'var(--p, #6C47FF)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            padding: '2px 6px',
          }}
          data-testid="create-source-btn"
        >
          + 新建数据源
        </button>
      </div>

      <CreateSourceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(src) => {
          setCreateOpen(false)
          // 立即把新源插入列表，不等下一次 reload；展开方便用户立刻可见
          setSources((prev) => [
            ...prev,
            {
              id: src.id, name: src.name,
              type: src.type, connector: src.connector, status: src.status,
              assetCount: src.asset_count ?? 0,
              expanded: true, loading: false, loaded: true, assets: [],
            },
          ])
          // 后台静默 reload 让计数等同步
          void reload()
        }}
      />

      <div style={{ padding: 4 }}>
        {sources.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            暂无数据源 · 通过 /ingest 入库后会自动登记
          </div>
        ) : sources.map((s) => (
          <SourceRow
            key={s.id}
            node={s}
            onToggle={() => void toggleSource(s.id)}
            onSelectAsset={onSelectAsset}
            selectedAssetId={selectedAssetId}
            onOpenPermissions={(id, name) => setPermDrawer({ sourceId: id, sourceName: name })}
          />
        ))}
      </div>
      {/* F-2 权限抽屉 */}
      {permDrawer && (
        <PermissionsDrawer
          open={true}
          resourceKind="source"
          resourceId={permDrawer.sourceId}
          resourceName={permDrawer.sourceName}
          onClose={() => setPermDrawer(null)}
        />
      )}
    </>
  )
}

function SourceRow({
  node, onToggle, onSelectAsset, selectedAssetId, onOpenPermissions,
}: {
  node: SourceNode
  onToggle: () => void
  onSelectAsset: (a: SelectedAsset) => void
  selectedAssetId: number | null
  onOpenPermissions: (sourceId: number, sourceName: string) => void
}) {
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
        style={{ ...rowBtnStyle(false), display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        data-testid={`source-${node.id}`}
      >
        <span style={{ width: 16, color: 'var(--muted)' }}>
          {node.expanded ? '▼' : '▶'}
        </span>
        <span style={{ marginRight: 6 }}>📂</span>
        <span style={{ flex: 1, fontWeight: 500 }}>{node.name}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }}>
          {node.assetCount}
        </span>
        {node.connector && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 999,
            background: '#f3f4f6', color: 'var(--muted)', marginRight: 6,
          }}>{node.connector}</span>
        )}
        {/* F-2 权限抽屉入口，仅 iam:manage */}
        <RequirePermission name="iam:manage">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenPermissions(node.id, node.name) }}
            title="权限…"
            aria-label={`打开 ${node.name} 的权限设置`}
            style={{
              padding: '2px 6px', fontSize: 11, lineHeight: 1.2,
              background: 'transparent', border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 4, cursor: 'pointer',
            }}
            data-testid={`perm-btn-source-${node.id}`}
          >
            🔒
          </button>
        </RequirePermission>
      </div>
      {node.loading && (
        <div style={{ paddingLeft: 32, fontSize: 12, color: 'var(--muted)' }}>加载中…</div>
      )}
      {node.expanded && node.assets?.length === 0 && (
        <div style={{ paddingLeft: 32, fontSize: 12, color: 'var(--muted)', padding: '4px 12px 8px 32px' }}>
          （无资产）
        </div>
      )}
      {node.expanded && node.assets?.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onSelectAsset({
            id: a.id, name: a.name, sourceName: node.name,
            type: a.type, tags: a.tags, indexedAt: a.indexedAt,
          })}
          data-testid={`asset-${a.id}`}
          style={rowBtnStyle(selectedAssetId === a.id, true)}
        >
          <span style={{ marginRight: 6 }}>{ASSET_TYPE_ICON[a.type] ?? '📄'}</span>
          <span style={{
            flex: 1,
            color: selectedAssetId === a.id ? 'var(--p, #6C47FF)' : 'var(--text)',
            fontWeight: selectedAssetId === a.id ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{a.name}</span>
        </button>
      ))}
    </>
  )
}

function rowBtnStyle(selected: boolean, indent = false): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 4,
    padding: indent ? '4px 12px 4px 32px' : '6px 12px',
    background: selected ? 'rgba(108,71,255,0.08)' : 'transparent',
    border: 'none', textAlign: 'left', cursor: 'pointer',
    fontSize: 13, color: 'var(--text)', borderRadius: 6,
  }
}
