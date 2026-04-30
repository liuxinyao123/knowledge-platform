/**
 * Mcp —— PRD §14 数据接入 / MCP 中心
 * 4 KPI（RAGFlow mock）+ SQL 调试 + Skill 一览 + RAGFlow 状态 + Neo4j Cypher 调试
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import {
  mcpDebugApi, type DebugQueryResult, type CypherResult, type McpStats,
} from '@/api/mcp'

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

/** 把 ISO 时间 → 「刚刚 / N 分钟前 / N 小时前 / N 天前」（i18n 化） */
function useTimeAgo() {
  const { t } = useTranslation('mcp')
  return (iso: string | null): string => {
    if (!iso) return '—'
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 60_000) return t('timeAgo.justNow')
    const m = Math.floor(ms / 60_000)
    if (m < 60) return t('timeAgo.minutes', { n: m })
    const h = Math.floor(m / 60)
    if (h < 24) return t('timeAgo.hours', { n: h })
    return t('timeAgo.days', { n: Math.floor(h / 24) })
  }
}

// ────────────────────────── MCP tools ──────────────────────────
const MCP_TOOLS: { name: string; source: string; descKey: string }[] = [
  { name: 'search_knowledge', source: 'BookStack RAG',  descKey: 'tools.list.search_knowledge' },
  { name: 'query_pg_asset',   source: 'PG Catalog',     descKey: 'tools.list.query_pg_asset' },
  { name: 'debug_sql',        source: 'Structured DS',  descKey: 'tools.list.debug_sql' },
  { name: 'graph_cypher',     source: 'Neo4j',          descKey: 'tools.list.graph_cypher' },
]

type ConnStatus = 'idle' | 'checking' | 'ok' | 'error'

function KpiCard({
  label, value, detail, color,
}: { label: string; value: string; detail: string; color: string }) {
  return (
    <div className="surface-card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{detail}</div>
    </div>
  )
}

export default function Mcp() {
  const { t } = useTranslation('mcp')
  const timeAgo = useTimeAgo()
  // 连接健康状态
  const [connStatus, setConnStatus] = useState<ConnStatus>('idle')
  const [connErr, setConnErr] = useState<string | null>(null)

  // TBD-09 · 真 stats —— 原手写 useEffect + cancelled 标志在 React 18 StrictMode
  // 双挂载下出现竞态，改用 react-query：StrictMode-safe、带去重、30s 轮询、错误可见。
  const statsQuery = useQuery<McpStats>({
    queryKey: ['mcp-stats'],
    queryFn: async () => {
      const s = await mcpDebugApi.getStats()
      // 防御：后端偶发返回空对象或被代理吞成 HTML 时，强制报错让 UI 走 error 分支
      if (!s || typeof s !== 'object' || typeof (s as { assetsTotal?: unknown }).assetsTotal !== 'number') {
        throw new Error(t('errors.statsShape'))
      }
      return s
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  })
  const stats = statsQuery.data ?? null
  const statsErr = statsQuery.error
    ? (() => {
        const e = statsQuery.error as { response?: { data?: { error?: string } }; message?: string }
        return e.response?.data?.error || e.message || t('errors.loadFailed')
      })()
    : null

  // SQL 调试
  const [sqlSource, setSqlSource] = useState('erp_prod')
  const [sql, setSql] = useState('SELECT po_id, supplier, material, cost_price, qty FROM po LIMIT 5')
  const [sqlResult, setSqlResult] = useState<DebugQueryResult | null>(null)
  const [sqlLoading, setSqlLoading] = useState(false)
  const [sqlErr, setSqlErr] = useState<string | null>(null)

  // Cypher 调试
  const [cypher, setCypher] = useState('MATCH (s:Supplier)-[:SUPPLIES]->(p:PO) RETURN s,p LIMIT 10')
  const [cypherResult, setCypherResult] = useState<CypherResult | null>(null)
  const [cypherLoading, setCypherLoading] = useState(false)
  const [cypherErr, setCypherErr] = useState<string | null>(null)

  async function handleTestConn() {
    setConnStatus('checking')
    setConnErr(null)
    try {
      const r = await axios.get<{ ok: boolean }>('/health').catch(() => null)
      if (r?.data?.ok) {
        setConnStatus('ok')
      } else {
        setConnStatus('error')
        setConnErr(t('errors.qaServiceDown'))
      }
    } catch (e) {
      setConnStatus('error')
      setConnErr(e instanceof Error ? e.message : t('errors.connectFailed'))
    }
  }

  async function handleRunSql() {
    setSqlLoading(true)
    setSqlErr(null)
    setSqlResult(null)
    try {
      const r = await mcpDebugApi.debugQuery(sqlSource, sql)
      setSqlResult(r)
    } catch (e) {
      setSqlErr(e instanceof Error ? e.message : t('errors.queryFailed'))
    } finally {
      setSqlLoading(false)
    }
  }

  async function handleRunCypher() {
    setCypherLoading(true)
    setCypherErr(null)
    setCypherResult(null)
    try {
      const r = await mcpDebugApi.runCypher(cypher)
      setCypherResult(r)
    } catch (e) {
      setCypherErr(e instanceof Error ? e.message : t('errors.queryFailed'))
    } finally {
      setCypherLoading(false)
    }
  }

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">{t('title')}</div>
          <div className="page-sub">
            {t('subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={connStatus === 'checking'} onClick={() => void handleTestConn()}>
            {connStatus === 'checking' ? t('testing') : t('testConn')}
          </button>
          {connStatus === 'ok'    && <span className="pill green" style={{ cursor: 'default' }}>{t('connOk')}</span>}
          {connStatus === 'error' && <span className="pill red"   style={{ cursor: 'default' }}>{t('connError')}</span>}
        </div>
      </div>

      <KnowledgeTabs />

      {connStatus === 'error' && connErr && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'var(--red-bg)', color: 'var(--red)',
          borderRadius: 8, fontSize: 13,
        }}>
          {connErr}
        </div>
      )}

      {/* KPI —— 4 指标（真数据） */}
      <div className="kc-grid-4">
        <KpiCard
          label={t('kpi.assetsLabel')}
          value={fmtNum(stats?.assetsTotal)}
          detail={statsErr ? statsErr : stats ? t('kpi.assetsDetail') : t('kpi.loading')}
          color="#2563eb"
        />
        <KpiCard
          label={t('kpi.chunksLabel')}
          value={fmtNum(stats?.chunksEmbedded)}
          detail={statsErr ? statsErr : stats ? t('kpi.chunksDetail', { total: fmtNum(stats.chunksTotal) }) : t('kpi.loading')}
          color="#16a34a"
        />
        <KpiCard
          label={t('kpi.ingest24hLabel')}
          value={fmtNum(stats?.ingestsLast24h)}
          detail={statsErr ? statsErr : stats ? t('kpi.ingest24hDetail', { total: fmtNum(stats.ingestsLast7d) }) : t('kpi.loading')}
          color="#f59e0b"
        />
        <KpiCard
          label={t('kpi.qa24hLabel')}
          value={fmtNum(stats?.qasLast24h)}
          detail={statsErr ? statsErr : stats ? t('kpi.qa24hDetail', { ago: timeAgo(stats.lastQaAt) }) : t('kpi.loading')}
          color="#9333ea"
        />
      </div>

      {/* 数据源概览（真数据） */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{t('sources.panelTitle')}</span>
          <span style={{ marginLeft: 8 }} className="pill pill-green">{t('sources.realDataPill')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 }}>
          <div>
            <div style={{ color: 'var(--muted)' }}>{t('sources.assetsCount')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtNum(stats?.assetsTotal)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)' }}>{t('sources.chunksEmbedded')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {fmtNum(stats?.chunksEmbedded)}
              {stats && stats.chunksTotal > stats.chunksEmbedded && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>
                  {t('sources.totalChunks', { total: fmtNum(stats.chunksTotal) })}
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)' }}>{t('sources.lastIndex')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{timeAgo(stats?.lastAssetIndexedAt ?? null)}</div>
          </div>
        </div>
        <div style={{
          marginTop: 10, padding: 10, background: '#fff7e6', border: '1px solid #ffd591',
          borderRadius: 8, fontSize: 12, color: '#874d00',
        }}>
          {t('sources.ragNote')}
        </div>
      </div>

      {/* MCP Tools */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{t('tools.panelTitle')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {MCP_TOOLS.map((tool) => (
            <div key={tool.name} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <code style={{
                  fontSize: 12, fontWeight: 700, color: 'var(--p)',
                  background: 'var(--p-light)', padding: '2px 6px', borderRadius: 4,
                }}>
                  {tool.name}
                </code>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {tool.source}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>{t(tool.descKey)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SQL 调试区 */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{t('sql.panelTitle')}</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
            {t('sql.panelSub')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select
            value={sqlSource}
            onChange={(e) => setSqlSource(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
          >
            <option value="erp_prod">erp_prod</option>
            <option value="finance_dw">finance_dw</option>
            <option value="procurement_dm">procurement_dm</option>
          </select>
          <button className="btn" disabled={sqlLoading} onClick={() => void handleRunSql()}>
            {sqlLoading ? t('sql.running') : t('sql.run')}
          </button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={3}
          style={{
            width: '100%', fontFamily: 'monospace', fontSize: 12,
            padding: 10, border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical',
          }}
        />
        {sqlErr && (
          <div style={{ marginTop: 8, padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>
            {sqlErr}
          </div>
        )}
        {sqlResult && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              padding: 10, background: sqlResult.ok ? '#f0fdf4' : '#FEF2F2',
              border: `1px solid ${sqlResult.ok ? '#86efac' : '#fecaca'}`,
              borderRadius: 6, marginBottom: 10, fontSize: 12,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {sqlResult.ok ? t('sql.authPass') : t('sql.authBlock')} · {sqlResult.durationMs}ms
                {sqlResult.reason && <span style={{ color: '#B91C1C' }}> · {sqlResult.reason}</span>}
              </div>
              {sqlResult.authCheck.rules.map((r, i) => (
                <div key={i} style={{ color: '#555', paddingLeft: 8 }}>· {r}</div>
              ))}
              {sqlResult.rowFilter && (
                <div style={{ marginTop: 6, color: '#555' }}>
                  {t('sql.rowFilter')}<code>{sqlResult.rowFilter}</code>
                </div>
              )}
              {sqlResult.maskedFields && sqlResult.maskedFields.length > 0 && (
                <div style={{ color: '#555' }}>
                  {t('sql.maskedFields')}{sqlResult.maskedFields.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}
                </div>
              )}
            </div>
            {sqlResult.rows.length > 0 && (
              <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ background: '#f9fafb' }}>
                    <tr>
                      {Object.keys(sqlResult.rows[0]).map((k) => (
                        <th key={k} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sqlResult.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        {Object.keys(sqlResult.rows[0]).map((k) => (
                          <td key={k} style={{ padding: '6px 10px' }}>{String(row[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sqlResult.note && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>{sqlResult.note}</div>
            )}
          </div>
        )}
      </div>

      {/* 近 7 日动作调用（真 audit_log 聚合） */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{t('actions7d.panelTitle')}</span>
          <span style={{ marginLeft: 8 }} className="pill pill-green">{t('actions7d.realDataPill')}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
            {t('actions7d.subtitle')}
          </span>
        </div>
        {!stats ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{t('actions7d.loading')}</div>
        ) : stats.actions7d.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            {t('actions7d.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{t('actions7d.colName')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{t('actions7d.colCode')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>{t('actions7d.colCount')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{t('actions7d.colLast')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.actions7d.map((a) => {
                // 已知 action code 走字典翻译；未知 fallback 到原 code
                const knownLabel = t(`actions7d.actionLabels.${a.action}`, { defaultValue: '' })
                const display = knownLabel || a.action
                return (
                  <tr key={a.action} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{display}</td>
                    <td style={{ padding: '6px 10px' }}><code style={{ fontSize: 11, color: 'var(--muted)' }}>{a.action}</code></td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtNum(a.count)}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{timeAgo(a.last_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Neo4j Cypher 调试 */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{t('cypher.panelTitle')}</span>
          <span style={{ marginLeft: 8 }} className="pill">{t('cypher.samplePill')}</span>
        </div>
        <div style={{
          padding: 10, background: '#fff7e6', border: '1px solid #ffd591',
          borderRadius: 8, fontSize: 12, color: '#874d00', marginBottom: 10,
        }}>
          {t('cypher.sampleNote')}
        </div>
        <textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          rows={3}
          style={{
            width: '100%', fontFamily: 'monospace', fontSize: 12,
            padding: 10, border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical',
          }}
        />
        <div style={{ marginTop: 8 }}>
          <button className="btn" disabled={cypherLoading} onClick={() => void handleRunCypher()}>
            {cypherLoading ? t('cypher.running') : t('cypher.run')}
          </button>
        </div>
        {cypherErr && (
          <div style={{ marginTop: 8, padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>
            {cypherErr}
          </div>
        )}
        {cypherResult && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              {t('cypher.result', { ms: cypherResult.durationMs, nodes: cypherResult.nodes.length, edges: cypherResult.edges.length })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nodes</div>
                <pre style={{
                  padding: 10, background: '#f9fafb', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 11, overflow: 'auto', margin: 0, maxHeight: 240,
                }}>
                  {JSON.stringify(cypherResult.nodes, null, 2)}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Edges</div>
                <pre style={{
                  padding: 10, background: '#f9fafb', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 11, overflow: 'auto', margin: 0, maxHeight: 240,
                }}>
                  {JSON.stringify(cypherResult.edges, null, 2)}
                </pre>
              </div>
            </div>
            {cypherResult.note && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>{cypherResult.note}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
