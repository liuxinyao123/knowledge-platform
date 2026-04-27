/**
 * /eval/runs/:id —— 单次运行详情
 *
 * - 顶部：状态 + 进度 + 汇总指标（avg recall@1/3/5 + 平均首命中 rank）
 * - 下方：逐题结果表（hit@1/3/5 + 召回的 asset_id + 错误信息）
 * - 运行中自动 1.5s 轮询
 */
import { useEffect, useState, useCallback, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRun, type EvalRunSummary, type EvalCaseResult,
} from '@/api/eval'
import {
  StatusPill, RecallCell, Time, Th, Td, tableWrapStyle, tableStyle, linkBtn,
} from './index'

function judgeColor(v: string | null | undefined): string {
  if (v == null) return 'var(--muted)'
  const n = Number(v)
  return n >= 0.8 ? '#047857' : n >= 0.5 ? '#92400e' : '#b91c1c'
}

function JudgeCell({ v }: { v: string | null }) {
  if (v == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  const n = Number(v)
  return (
    <span style={{
      color: judgeColor(v),
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 500,
    }}>{n.toFixed(2)}</span>
  )
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)
  const navigate = useNavigate()
  const [run, setRun] = useState<EvalRunSummary | null>(null)
  const [results, setResults] = useState<EvalCaseResult[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const reload = useCallback(async () => {
    if (!Number.isFinite(runId)) return
    try {
      const d = await getRun(runId)
      setRun(d.run); setResults(d.results); setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [runId])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!run) return
    if (run.status === 'done' || run.status === 'failed') return
    const t = setInterval(() => { void reload() }, 1500)
    return () => clearInterval(t)
  }, [run, reload])

  if (!Number.isFinite(runId)) {
    return <div className="page-body"><div style={{ color: '#b91c1c' }}>非法 runId</div></div>
  }
  // per-row expansion state inside the page is fine (we don't paginate)


  return (
    <div className="page-body">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">运行 #{runId}</div>
          <div className="page-sub">
            数据集：
            {run?.dataset_name ? (
              <button type="button" style={{ ...linkBtn, fontSize: 13 }}
                      onClick={() => run && navigate(`/eval/datasets/${run.dataset_id}`)}>
                {run.dataset_name}
              </button>
            ) : '加载中…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/eval')}>← 返回</button>
        </div>
      </div>

      {err && (
        <div style={{
          padding: 12, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13,
        }}>{err}</div>
      )}

      {/* Summary */}
      {run && (
        <div style={{
          background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
          padding: 16, marginTop: 14, marginBottom: 14,
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 16,
        }}>
          <Stat label="状态" value={<StatusPill status={run.status} />} />
          <Stat label="进度" value={
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>
              {run.finished} / {run.total}
              {run.errored > 0 && <span style={{ color: '#b91c1c' }}> ({run.errored}错)</span>}
            </span>
          } />
          <Stat label="召回 R@1" value={<RecallCell v={run.recall_at_1} />} />
          <Stat label="召回 R@3" value={<RecallCell v={run.recall_at_3} />} />
          <Stat label="召回 R@5" value={<RecallCell v={run.recall_at_5} />} />
          <Stat
            label="✨ 答案准确率"
            value={
              run.judged_count > 0
                ? <span style={{ color: judgeColor(run.avg_judge_score), fontFamily: 'ui-monospace, monospace' }}>
                    {Number(run.avg_judge_score ?? 0).toFixed(2)}
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
                      ({run.judged_count}题)
                    </span>
                  </span>
                : <span style={{ color: 'var(--muted)' }}>—</span>
            }
            large
          />
          <Stat label="首命中 rank"
                value={
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {run.avg_first_hit_rank == null ? '—' : Number(run.avg_first_hit_rank).toFixed(1)}
                  </span>
                } />
        </div>
      )}

      {run && (
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '0 4px 8px' }}>
          开始：<Time ms={run.started_at_ms} />
          {run.finished_at_ms && <> · 结束：<Time ms={run.finished_at_ms} /></>}
          {run.principal_email && <> · 触发人：{run.principal_email}</>}
          {run.notes && <> · 备注：{run.notes}</>}
        </div>
      )}

      {/* 逐题结果 */}
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th style={{ width: 60 }}>ID</Th>
              <Th>问题</Th>
              <Th style={{ width: 90 }}>召回前 5</Th>
              <Th style={{ width: 60 }}>R@1</Th>
              <Th style={{ width: 60 }}>R@3</Th>
              <Th style={{ width: 60 }}>R@5</Th>
              <Th style={{ width: 70 }}>✨ Judge</Th>
              <Th style={{ width: 60 }}>首命中</Th>
              <Th style={{ width: 60 }}>耗时</Th>
              <Th style={{ width: 50 }}></Th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && run?.status === 'done' ? (
              <tr><Td style={{ textAlign: 'center', color: 'var(--muted)' }}>无结果</Td></tr>
            ) : results.length === 0 ? (
              <tr><Td style={{ textAlign: 'center', color: 'var(--muted)' }}>等待执行…</Td></tr>
            ) : (
              results.map((r) => {
                const expanded = expandedIds.has(r.id)
                const canExpand = r.expected_answer || r.system_answer || r.judge_reasoning
                const toggle = () => setExpandedIds((prev) => {
                  const s = new Set(prev)
                  if (s.has(r.id)) s.delete(r.id); else s.add(r.id)
                  return s
                })
                return (
                  <Fragment key={r.id}>
                    <tr style={canExpand ? { cursor: 'pointer' } : undefined} onClick={canExpand ? toggle : undefined}>
                      <Td><span style={{ color: 'var(--muted)', fontSize: 12 }}>{r.ext_id ?? r.case_id}</span></Td>
                      <Td>
                        <div style={{ color: 'var(--text)' }}>{r.question}</div>
                        {r.error && (
                          <div style={{ color: '#b91c1c', fontSize: 11, marginTop: 2 }}>
                            ❌ {r.error}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                          {r.retrieved_asset_ids.slice(0, 5).map((id) => {
                            const hit = r.expected_asset_ids.includes(id)
                            return (
                              <span key={id} style={{
                                color: hit ? '#047857' : 'var(--muted)',
                                fontWeight: hit ? 600 : 400, marginRight: 4,
                              }}>{id}</span>
                            )
                          })}
                          {r.retrieved_asset_ids.length === 0 && <span style={{ color: 'var(--muted)' }}>(空)</span>}
                        </span>
                      </Td>
                      <Td><RecallCell v={r.recall_at_1} /></Td>
                      <Td><RecallCell v={r.recall_at_3} /></Td>
                      <Td><RecallCell v={r.recall_at_5} /></Td>
                      <Td><JudgeCell v={r.judge_score} /></Td>
                      <Td>
                        {r.first_hit_rank == null ? (
                          <span style={{ color: '#b91c1c', fontFamily: 'ui-monospace, monospace' }}>—</span>
                        ) : (
                          <span style={{
                            color: r.first_hit_rank <= 3 ? '#047857' : '#92400e',
                            fontFamily: 'ui-monospace, monospace',
                          }}>#{r.first_hit_rank}</span>
                        )}
                      </Td>
                      <Td>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                        </span>
                      </Td>
                      <Td>
                        {canExpand && (
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {expanded ? '▾' : '▸'}
                          </span>
                        )}
                      </Td>
                    </tr>
                    {expanded && (
                      <tr>
                        <Td style={{ padding: 0 }} />
                        <Td colSpan={9} style={{ padding: '12px 14px', background: '#fafafa' }}>
                          <ExpandedDetail r={r} />
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExpandedDetail({ r }: { r: EvalCaseResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      {r.expected_answer && (
        <div>
          <div style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>
            ✓ 参考答案 (ground truth)
          </div>
          <div style={{
            padding: '8px 12px', background: '#fff', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', whiteSpace: 'pre-wrap',
          }}>{r.expected_answer}</div>
        </div>
      )}
      {r.system_answer && (
        <div>
          <div style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>
            🤖 系统答案
          </div>
          <div style={{
            padding: '8px 12px', background: '#fff', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', whiteSpace: 'pre-wrap',
          }}>{r.system_answer}</div>
        </div>
      )}
      {r.judge_reasoning && (
        <div>
          <div style={{ color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>
            ✨ Judge 评分理由
            {r.judge_score != null && (
              <span style={{ marginLeft: 8, color: judgeColor(r.judge_score), fontFamily: 'ui-monospace, monospace' }}>
                {Number(r.judge_score).toFixed(2)}
              </span>
            )}
          </div>
          <div style={{
            padding: '8px 12px', background: '#fff', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', fontStyle: 'italic',
          }}>{r.judge_reasoning}</div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, large }: {
  label: string; value: React.ReactNode; large?: boolean
}) {
  return (
    <div>
      <div style={{
        fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
        letterSpacing: 0.4, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: large ? 20 : 14,
        fontWeight: large ? 700 : 500,
        color: 'var(--text)',
      }}>{value}</div>
    </div>
  )
}
