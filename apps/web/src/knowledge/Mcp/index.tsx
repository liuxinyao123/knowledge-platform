/**
 * Mcp —— PRD §14 数据接入 / MCP 中心
 * 4 KPI（RAGFlow mock）+ SQL 调试 + Skill 一览 + RAGFlow 状态 + Neo4j Cypher 调试
 */
import { useState } from 'react'
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
function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return '刚刚'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

// ────────────────────────── MCP tools ──────────────────────────
const MCP_TOOLS = [
  {
    name: 'search_knowledge',
    source: 'BookStack RAG',
    desc: '跨书架语义检索，返回文档片段与来源。',
  },
  {
    name: 'query_pg_asset',
    source: 'PG Catalog',
    desc: '结构化资产目录与元数据（PG + pgvector）。',
  },
  {
    name: 'debug_sql',
    source: 'Structured DS',
    desc: '只读 SELECT 调试，带行级过滤与字段脱敏。',
  },
  {
    name: 'graph_cypher',
    source: 'Neo4j',
    desc: 'Cypher 查询 · 当前为示例模式（真实图库尚未接入，前端组件行为一致）。',
  },
]

// 把 audit_log 的 action 名翻译成更"Skill"友好的显示
function prettifyAction(a: string): string {
  const map: Record<string, string> = {
    qa_ask:           '知识问答（调用）',
    qa_answered:      '知识问答（完成）',
    qa_intent_classified: '意图识别',
    ingest_done:      '文档入库',
    ingest_failed:    '入库失败',
    ingest_started:   '开始解析',
    bookstack_page_create: 'BookStack 建页',
    asset_register:   '资产登记',
    login_success:    '登录成功',
    login_failed:     '登录失败',
    logout:           '登出',
    user_register:    '新建用户',
    user_updated:     '用户更新',
    user_deleted:     '用户删除',
    user_password_changed: '用户自助改密',
    user_password_reset_by_admin: '管理员重置密码',
    acl_rule_create:  '新建 ACL 规则',
    acl_rule_update:  '改 ACL 规则',
    acl_rule_delete:  '删 ACL 规则',
  }
  return map[a] ?? a
}

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
  // 连接健康状态
  const [connStatus, setConnStatus] = useState<ConnStatus>('idle')
  const [connErr, setConnErr] = useState<string | null>(null)

  // TBD-09 · 真 stats —— 原手写 useEffect + cancelled 标志在 React 18 StrictMode
  // 双挂载下出现竞态（首次响应被 cancelled 吞掉、再刷不触发），表现为 /mcp 永久
  // "加载中…"。改用 react-query：StrictMode-safe、带去重、30s 轮询、错误可见。
  const statsQuery = useQuery<McpStats>({
    queryKey: ['mcp-stats'],
    queryFn: async () => {
      const s = await mcpDebugApi.getStats()
      // 防御：后端偶发返回空对象或被代理吞成 HTML 时，强制报错让 UI 走 error 分支
      // 而不是装作 loaded 显示一堆 '—'
      if (!s || typeof s !== 'object' || typeof (s as { assetsTotal?: unknown }).assetsTotal !== 'number') {
        throw new Error('/api/mcp/stats 返回结构不符')
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
        return e.response?.data?.error || e.message || '加载失败'
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
        setConnErr('qa-service 未响应（:3001）')
      }
    } catch (e) {
      setConnStatus('error')
      setConnErr(e instanceof Error ? e.message : '连接失败')
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
      setSqlErr(e instanceof Error ? e.message : '查询失败')
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
      setCypherErr(e instanceof Error ? e.message : '查询失败')
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
          <div className="page-title">数据接入层</div>
          <div className="page-sub">
            MCP 查询层 · 文档访问 Skill 层 · 向量检索与图查询连接状态
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={connStatus === 'checking'} onClick={() => void handleTestConn()}>
            {connStatus === 'checking' ? '检测中…' : '测试连接'}
          </button>
          {connStatus === 'ok'    && <span className="pill green" style={{ cursor: 'default' }}>● qa-service 正常</span>}
          {connStatus === 'error' && <span className="pill red"   style={{ cursor: 'default' }}>● 连接失败</span>}
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
      {/* 错误时 4 张卡都统一显示错误，不再静默吞；加载时 4 张卡都显示"加载中…" */}
      <div className="kc-grid-4">
        <KpiCard
          label="接入资产"
          value={fmtNum(stats?.assetsTotal)}
          detail={statsErr ? statsErr : stats ? `总资产数（已合并不计）` : '加载中…'}
          color="#2563eb"
        />
        <KpiCard
          label="向量切片"
          value={fmtNum(stats?.chunksEmbedded)}
          detail={statsErr ? statsErr : stats ? `已嵌入 / 总 ${fmtNum(stats.chunksTotal)}` : '加载中…'}
          color="#16a34a"
        />
        <KpiCard
          label="近 24h 入库"
          value={fmtNum(stats?.ingestsLast24h)}
          detail={statsErr ? statsErr : stats ? `近 7 日共 ${fmtNum(stats.ingestsLast7d)}` : '加载中…'}
          color="#f59e0b"
        />
        <KpiCard
          label="近 24h 问答"
          value={fmtNum(stats?.qasLast24h)}
          detail={statsErr ? statsErr : stats ? `上次 ${timeAgo(stats.lastQaAt)}` : '加载中…'}
          color="#9333ea"
        />
      </div>

      {/* 数据源概览（真数据） */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">📚 非结构化数据源 · BookStack + pgvector</span>
          <span style={{ marginLeft: 8 }} className="pill pill-green">● 真数据</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 }}>
          <div>
            <div style={{ color: 'var(--muted)' }}>接入资产数</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtNum(stats?.assetsTotal)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)' }}>已嵌入切片</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {fmtNum(stats?.chunksEmbedded)}
              {stats && stats.chunksTotal > stats.chunksEmbedded && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>
                  / {fmtNum(stats.chunksTotal)} 总切片
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)' }}>最近索引</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{timeAgo(stats?.lastAssetIndexedAt ?? null)}</div>
          </div>
        </div>
        <div style={{
          marginTop: 10, padding: 10, background: '#fff7e6', border: '1px solid #ffd591',
          borderRadius: 8, fontSize: 12, color: '#874d00',
        }}>
          📌 当前向量检索走 BookStack 代理 + pgvector 嵌入的原生路径，语义上与 RAGFlow 的检索层一致。
          可在后续版本无感切换到 RAGFlow 产品化编排层。
        </div>
      </div>

      {/* MCP Tools */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">🛠 MCP Tools 一览</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {MCP_TOOLS.map((t) => (
            <div key={t.name} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <code style={{
                  fontSize: 12, fontWeight: 700, color: 'var(--p)',
                  background: 'var(--p-light)', padding: '2px 6px', borderRadius: 4,
                }}>
                  {t.name}
                </code>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {t.source}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>{t.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SQL 调试区 */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">🧪 结构化 SQL 调试</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
            只读 SELECT · 含授权链路演示
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
            {sqlLoading ? '执行中…' : '执行'}
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
                {sqlResult.ok ? '✓ 授权通过' : '✗ 授权拦截'} · {sqlResult.durationMs}ms
                {sqlResult.reason && <span style={{ color: '#B91C1C' }}> · {sqlResult.reason}</span>}
              </div>
              {sqlResult.authCheck.rules.map((r, i) => (
                <div key={i} style={{ color: '#555', paddingLeft: 8 }}>· {r}</div>
              ))}
              {sqlResult.rowFilter && (
                <div style={{ marginTop: 6, color: '#555' }}>
                  行级过滤：<code>{sqlResult.rowFilter}</code>
                </div>
              )}
              {sqlResult.maskedFields && sqlResult.maskedFields.length > 0 && (
                <div style={{ color: '#555' }}>
                  脱敏字段：{sqlResult.maskedFields.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}
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
          <span className="panel-title">⚙️ 近 7 日动作调用</span>
          <span style={{ marginLeft: 8 }} className="pill pill-green">● 真数据</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
            来自 audit_log；每 30s 自动刷新
          </span>
        </div>
        {!stats ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>加载中…</div>
        ) : stats.actions7d.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            近 7 日无动作记录。点一下问答 / 上传 / 规则编辑就有数据了。
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>动作名称</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>原 action code</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>7 日调用</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>最近</th>
              </tr>
            </thead>
            <tbody>
              {stats.actions7d.map((a) => (
                <tr key={a.action} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{prettifyAction(a.action)}</td>
                  <td style={{ padding: '6px 10px' }}><code style={{ fontSize: 11, color: 'var(--muted)' }}>{a.action}</code></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtNum(a.count)}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{timeAgo(a.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Neo4j Cypher 调试 */}
      <div className="surface-card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">🕸 Neo4j Cypher 调试</span>
          <span style={{ marginLeft: 8 }} className="pill">示例模式</span>
        </div>
        <div style={{
          padding: 10, background: '#fff7e6', border: '1px solid #ffd591',
          borderRadius: 8, fontSize: 12, color: '#874d00', marginBottom: 10,
        }}>
          📌 当前为示例模式，真实图库尚未接入；执行会返回示例图结果，前端行为与生产一致。
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
            {cypherLoading ? '执行中…' : '执行 Cypher'}
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
              {cypherResult.durationMs}ms · 节点 {cypherResult.nodes.length} 条 / 边 {cypherResult.edges.length} 条
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
