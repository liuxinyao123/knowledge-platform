/**
 * routes/mcpDebug.ts —— PRD §14 MCP 调试区 + Cypher 调试区
 *
 * MVP：全 mock 结果。
 * 真实 SQL 执行需要连接结构化数据源（Track A 的 StructuredQuery 层）；
 * 真 Cypher 需要 Neo4j（Q3=c 推迟）。
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../auth/index.ts'
import { getPgPool } from '../services/pgDb.ts'

export const mcpDebugRouter = Router()
export const graphDebugRouter = Router()

// ───────────────────────── GET /api/mcp/stats ─────────────────────────
// 数据接入/MCP 中心首页 4 KPI + 非结构化数据源概览（真数据）
mcpDebugRouter.get('/stats', requireAuth(), async (_req: Request, res: Response) => {
  const pool = getPgPool()
  try {
    const [
      assets,
      chunksTotal,
      chunksEmbedded,
      ingests24h,
      qas24h,
      ingests7d,
      lastSync,
      lastQaRow,
      skillsRows,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM metadata_asset WHERE merged_into IS NULL`,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM metadata_field`),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM metadata_field WHERE embedding IS NOT NULL`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE action = 'ingest_done'
           AND ts > NOW() - INTERVAL '24 hours'`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE action LIKE 'qa_%'
           AND ts > NOW() - INTERVAL '24 hours'`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE action = 'ingest_done'
           AND ts > NOW() - INTERVAL '7 days'`,
      ),
      pool.query(
        `SELECT MAX(indexed_at) AS at
         FROM metadata_asset WHERE merged_into IS NULL`,
      ),
      pool.query(
        `SELECT ts
         FROM audit_log WHERE action LIKE 'qa_%'
         ORDER BY id DESC LIMIT 1`,
      ),
      // 聚合最近各 action 调用次数作为简易"Skill 一览"信号
      pool.query(
        `SELECT action, COUNT(*)::int AS n, MAX(ts) AS last_at
         FROM audit_log
         WHERE ts > NOW() - INTERVAL '7 days'
         GROUP BY action
         ORDER BY n DESC
         LIMIT 20`,
      ),
    ])

    res.json({
      assetsTotal:     assets.rows[0].n as number,
      chunksTotal:     chunksTotal.rows[0].n as number,
      chunksEmbedded:  chunksEmbedded.rows[0].n as number,
      ingestsLast24h:  ingests24h.rows[0].n as number,
      ingestsLast7d:   ingests7d.rows[0].n as number,
      qasLast24h:      qas24h.rows[0].n as number,
      lastAssetIndexedAt: lastSync.rows[0].at ?? null,
      lastQaAt:        lastQaRow.rows[0]?.ts ?? null,
      actions7d:       skillsRows.rows.map((r) => ({
        action: String(r.action),
        count:  Number(r.n),
        last_at: r.last_at,
      })),
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stats failed'
    res.status(500).json({ error: msg })
  }
})

mcpDebugRouter.post('/debug-query', requireAuth(), (req: Request, res: Response) => {
  const start = Date.now()
  const body = (req.body ?? {}) as { source?: string; sql?: string }
  if (typeof body.source !== 'string' || typeof body.sql !== 'string' || !body.sql.trim()) {
    return res.status(400).json({ error: 'source and sql required' })
  }

  const lower = body.sql.trim().toLowerCase()
  if (!lower.startsWith('select')) {
    return res.json({
      ok: false,
      authCheck: { passed: false, rules: ['只读：拒绝非 SELECT'] },
      rows: [],
      durationMs: Date.now() - start,
      reason: 'only SELECT is allowed in debug',
    })
  }

  // mock 授权 + sample rows
  const rows = [
    { po_id: 'PO-2026-0421-001', supplier: '华东电子', material: 'M-1200', cost_price: '***', qty: 1200 },
    { po_id: 'PO-2026-0421-002', supplier: '上海机电', material: 'M-1300', cost_price: '***', qty: 800 },
    { po_id: 'PO-2026-0421-003', supplier: '华东电子', material: 'M-1100', cost_price: '***', qty: 500 },
  ]

  return res.json({
    ok: true,
    authCheck: {
      passed: true,
      rules: [
        '入口鉴权：通过',
        '路由授权：通过（数据源 ' + body.source + '）',
        '执行前拦截：追加行级过滤 project_id = T1',
        '结果整形：cost_price 字段已脱敏',
      ],
    },
    rowFilter: 'project_id = T1',
    maskedFields: ['cost_price'],
    rows,
    durationMs: Date.now() - start + 42,                 // +42 演示
    note: 'mock 数据；Track A StructuredQuery 接入后替换',
  })
})

graphDebugRouter.post('/cypher', requireAuth(), (req: Request, res: Response) => {
  const start = Date.now()
  const body = (req.body ?? {}) as { query?: string }
  if (typeof body.query !== 'string' || !body.query.trim()) {
    return res.status(400).json({ error: 'query required' })
  }
  // mock 图
  return res.json({
    nodes: [
      { id: 'supplier', label: '供应商主表', count: 42 },
      { id: 'po', label: '采购订单表', count: 1200 },
      { id: 'material', label: '物料主表', count: 8000 },
    ],
    edges: [
      { from: 'supplier', to: 'po', label: 'supplier_id FK' },
      { from: 'po', to: 'material', label: 'material_id FK' },
    ],
    durationMs: Date.now() - start + 35,                 // +35 演示
    note: 'mock 数据；Neo4j 接入后替换（Q3=c 推迟）',
  })
})
