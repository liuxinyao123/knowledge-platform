import { useCallback, useEffect, useState } from 'react'
import {
  enrichAssetSummaries,
  fetchAssetSources,
  fetchAssetItems,
  fetchAssetItemDetail,
  refreshKnowledgeLinks,
  syncBookstackPages,
  type AssetItemRow,
  type AssetSourceRow,
} from '@/api/assetDirectory'

type SseNavigate = {
  seq: number
  sourceId?: number
  itemId?: number
  tab?: 'assets' | 'rag' | 'graph'
}

export default function AssetDirectoryPanel({ sseNavigate }: { sseNavigate?: SseNavigate }) {
  const [sources, setSources] = useState<AssetSourceRow[]>([])
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [items, setItems] = useState<AssetItemRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [refreshingLinks, setRefreshingLinks] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<'rag' | 'graph'>('rag')
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchAssetItemDetail>> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchAssetSources()
        if (cancelled) return
        setSources(list)
        setSourceId((prev) => prev ?? list[0]?.id ?? null)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载数据源失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadItems = useCallback(async () => {
    if (sourceId == null) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const data = await fetchAssetItems(sourceId, 80, 0)
      setItems(data.items)
      setTotal(data.total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [sourceId])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    if (!sseNavigate?.seq) return
    const { sourceId: sid, itemId: iid, tab } = sseNavigate
    if (sid != null) setSourceId(sid)
    if (iid != null) {
      void (async () => {
        setSelectedItemId(iid)
        setDetailTab(tab === 'graph' ? 'graph' : 'rag')
        setErr(null)
        try {
          const d = await fetchAssetItemDetail(iid)
          setDetail(d)
        } catch (e) {
          setDetail(null)
          setErr(e instanceof Error ? e.message : '加载详情失败')
        }
      })()
    } else {
      setSelectedItemId(null)
      setDetail(null)
    }
  }, [sseNavigate?.seq])

  const handleSync = async () => {
    setSyncing(true)
    setErr(null)
    try {
      await syncBookstackPages(sourceId ?? undefined)
      const list = await fetchAssetSources()
      setSources(list)
      await loadItems()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleRefreshLinks = async () => {
    setRefreshingLinks(true)
    setErr(null)
    try {
      await refreshKnowledgeLinks(sourceId ?? undefined)
      if (selectedItemId != null) {
        try {
          setDetail(await fetchAssetItemDetail(selectedItemId))
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '刷新映射失败')
    } finally {
      setRefreshingLinks(false)
    }
  }

  const handleEnrichSummaries = async () => {
    setEnriching(true)
    setErr(null)
    try {
      await enrichAssetSummaries(sourceId ?? undefined, 10)
      if (selectedItemId != null) {
        try {
          setDetail(await fetchAssetItemDetail(selectedItemId))
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '摘要生成失败')
    } finally {
      setEnriching(false)
    }
  }

  const openItem = async (id: number) => {
    setSelectedItemId(id)
    setDetailTab('rag')
    setErr(null)
    try {
      const d = await fetchAssetItemDetail(id)
      setDetail(d)
    } catch (e) {
      setDetail(null)
      setErr(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const currentSource = sources.find((s) => s.id === sourceId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>数据源</div>
        <select
          data-testid="asset-source-select"
          value={sourceId ?? ''}
          onChange={(e) => {
            setSourceId(Number(e.target.value) || null)
            setSelectedItemId(null)
            setDetail(null)
          }}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            fontSize: 13,
          }}
        >
          {sources.length === 0 ? (
            <option value="">—</option>
          ) : (
            sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.sourceType} ({s.assetCount})
              </option>
            ))
          )}
        </select>
        {currentSource && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            状态 {currentSource.status} · 更新{' '}
            {currentSource.updatedAtMs ? new Date(currentSource.updatedAtMs).toLocaleString() : '—'}
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary"
          data-testid="asset-sync-btn"
          disabled={syncing || sourceId == null}
          onClick={() => void handleSync()}
          style={{ width: '100%', marginTop: 8, fontSize: 12, padding: '6px 10px' }}
        >
          {syncing ? '同步中…' : '从 BookStack 同步页面'}
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            type="button"
            className="btn"
            data-testid="asset-refresh-links-btn"
            disabled={refreshingLinks || sourceId == null}
            onClick={() => void handleRefreshLinks()}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px' }}
          >
            {refreshingLinks ? '刷新中…' : '刷新向量映射'}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="asset-enrich-btn"
            disabled={enriching || sourceId == null}
            onClick={() => void handleEnrichSummaries()}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px' }}
          >
            {enriching ? '生成中…' : '摘要(10条)'}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ margin: 8, padding: 8, background: '#FEF2F2', color: '#B91C1C', fontSize: 12, borderRadius: 6 }}>
          {err}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {selectedItemId != null && detail && (
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12 }}
              onClick={() => {
                setSelectedItemId(null)
                setDetail(null)
              }}
            >
              ← 返回列表
            </button>
          </div>
        )}

        {selectedItemId != null && detail ? (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {(['rag', 'graph'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={detailTab === t ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  onClick={() => setDetailTab(t)}
                >
                  {t === 'rag' ? 'RAG / 摘要' : '知识图谱'}
                </button>
              ))}
            </div>
            {detailTab === 'rag' && (
              <div className="surface-card" style={{ padding: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{detail.item.name}</div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                  <div>BookStack 页面 ID：{detail.rag.pageId ?? '—'}</div>
                  <div>向量片段数：{detail.rag.chunkCount}</div>
                  <div>已入索引：{detail.rag.indexed ? '是' : '否'}</div>
                  {detail.rag.linkStatus != null && (
                    <div>向量映射：{detail.rag.linkStatus}</div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    摘要状态：{detail.item.summaryStatus}
                    {detail.item.summary ? (
                      <div style={{ marginTop: 6, color: 'var(--text)' }}>{detail.item.summary}</div>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>（尚无摘要，可由后续预处理管道写入）</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {detailTab === 'graph' && (
              <div className="surface-card" style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>
                {detail.graph.message ?? '未接入图谱'}
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>加载资产…</div>
        ) : items.length === 0 ? (
          <div className="empty-state" style={{ padding: '1rem 0' }}>
            <div className="empty-illus">📂</div>
            <div className="empty-text">暂无资产，请点击上方同步</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              共 {total} 条（本页 {items.length}）
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((it) => (
                <li key={it.id} style={{ marginBottom: 6 }}>
                  <button
                    type="button"
                    data-testid={`asset-item-${it.id}`}
                    onClick={() => void openItem(it.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{it.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{it.externalRef}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
