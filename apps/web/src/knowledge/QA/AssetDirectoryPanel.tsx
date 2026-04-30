import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('qa')
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
        if (!cancelled) setErr(e instanceof Error ? e.message : t('assetPanel.errors.loadSources'))
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
      setErr(e instanceof Error ? e.message : t('assetPanel.errors.loadList'))
    } finally {
      setLoading(false)
    }
  }, [sourceId, t])

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
          setErr(e instanceof Error ? e.message : t('assetPanel.errors.loadDetail'))
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
      setErr(e instanceof Error ? e.message : t('assetPanel.errors.syncFailed'))
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
      setErr(e instanceof Error ? e.message : t('assetPanel.errors.refreshLinksFailed'))
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
      setErr(e instanceof Error ? e.message : t('assetPanel.errors.enrichFailed'))
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
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('assetPanel.sourceLabel')}</div>
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
            {t('assetPanel.statusUpdated', {
              status: currentSource.status,
              time: currentSource.updatedAtMs ? new Date(currentSource.updatedAtMs).toLocaleString() : '—',
            })}
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
          {syncing ? t('assetPanel.syncing') : t('assetPanel.syncBtn')}
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
            {refreshingLinks ? t('assetPanel.refreshingLinks') : t('assetPanel.refreshLinks')}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="asset-enrich-btn"
            disabled={enriching || sourceId == null}
            onClick={() => void handleEnrichSummaries()}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px' }}
          >
            {enriching ? t('assetPanel.enriching') : t('assetPanel.enrichSummary')}
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
              {t('assetPanel.backToList')}
            </button>
          </div>
        )}

        {selectedItemId != null && detail ? (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {(['rag', 'graph'] as const).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  className={detailTab === tabKey ? 'btn btn-primary' : 'btn'}
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  onClick={() => setDetailTab(tabKey)}
                >
                  {tabKey === 'rag' ? t('assetPanel.tabRag') : t('assetPanel.tabGraph')}
                </button>
              ))}
            </div>
            {detailTab === 'rag' && (
              <div className="surface-card" style={{ padding: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{detail.item.name}</div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                  <div>{t('assetPanel.rag.pageId', { id: detail.rag.pageId ?? '—' })}</div>
                  <div>{t('assetPanel.rag.chunkCount', { count: detail.rag.chunkCount })}</div>
                  <div>{t('assetPanel.rag.indexed', { yes: detail.rag.indexed ? t('assetPanel.yes') : t('assetPanel.no') })}</div>
                  {detail.rag.linkStatus != null && (
                    <div>{t('assetPanel.rag.linkStatus', { status: detail.rag.linkStatus })}</div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    {t('assetPanel.rag.summaryStatus', { status: detail.item.summaryStatus })}
                    {detail.item.summary ? (
                      <div style={{ marginTop: 6, color: 'var(--text)' }}>{detail.item.summary}</div>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>{t('assetPanel.rag.noSummary')}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {detailTab === 'graph' && (
              <div className="surface-card" style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>
                {detail.graph.message ?? t('assetPanel.graph.notConnected')}
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('assetPanel.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty-state" style={{ padding: '1rem 0' }}>
            <div className="empty-illus">📂</div>
            <div className="empty-text">{t('assetPanel.empty')}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              {t('assetPanel.totalLine', { total, current: items.length })}
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
