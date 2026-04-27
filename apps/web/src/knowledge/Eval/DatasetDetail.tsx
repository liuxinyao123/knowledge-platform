/**
 * /eval/datasets/:id —— 数据集详情
 *
 * - 头部：数据集名 + 描述
 * - case 表：增删改 + JSONL 批量导入
 * - 「运行评测」按钮：POST /datasets/:id/run → 拿 runId → 跳 /eval/runs/:id
 * - 历史 runs（同数据集）
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import RequirePermission from '@/auth/RequirePermission'
import {
  getDataset, addCase, patchCase, deleteCase, importJsonl,
  startRun, listRuns,
  type EvalCase, type EvalDatasetSummary, type EvalRunSummary,
} from '@/api/eval'
import {
  StatusPill, RecallCell, Time, Th, Td, tableWrapStyle, tableStyle, linkBtn, judgeColor,
} from './index'

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>()
  const datasetId = Number(id)
  const navigate = useNavigate()
  const [dataset, setDataset] = useState<EvalDatasetSummary | null>(null)
  const [cases, setCases] = useState<EvalCase[]>([])
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [editingCaseId, setEditingCaseId] = useState<number | null>(null)
  const [addingCase, setAddingCase] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [running, setRunning] = useState(false)

  const reload = useCallback(async () => {
    if (!Number.isFinite(datasetId)) return
    try {
      const [d, rs] = await Promise.all([getDataset(datasetId), listRuns(datasetId)])
      setDataset(d.dataset); setCases(d.cases); setRuns(rs); setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [datasetId])

  useEffect(() => { void reload() }, [reload])

  // 有 running 的话 2s 轮询
  useEffect(() => {
    if (!runs.some((r) => r.status === 'pending' || r.status === 'running')) return
    const t = setInterval(() => { void reload() }, 2000)
    return () => clearInterval(t)
  }, [runs, reload])

  async function handleRun() {
    if (cases.length === 0) { alert('数据集为空，先添加用例'); return }
    setRunning(true)
    try {
      const r = await startRun(datasetId)
      // 直接跳详情页看实时进度
      navigate(`/eval/runs/${r.runId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '启动失败')
    } finally {
      setRunning(false)
    }
  }

  if (!Number.isFinite(datasetId)) {
    return <div className="page-body"><div style={{ color: '#b91c1c' }}>非法 datasetId</div></div>
  }

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">{dataset?.name ?? '加载中…'}</div>
          <div className="page-sub">
            {dataset?.description || '评测数据集 · 资产级 recall@K'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/eval')}>← 返回</button>
          <RequirePermission name="permission:manage" fallback={null}>
            <button className="btn" onClick={() => setImportOpen(true)}>导入 JSONL</button>
            <button className="btn" onClick={() => setAddingCase(true)}>+ 新增用例</button>
            <button
              className="btn primary"
              disabled={running || cases.length === 0}
              onClick={() => void handleRun()}
            >{running ? '启动中…' : `▶ 运行评测（${cases.length} 题）`}</button>
          </RequirePermission>
        </div>
      </div>

      {err && (
        <div style={{
          padding: 12, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13,
        }}>{err}</div>
      )}

      {/* Cases */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: '14px 4px 8px' }}>
        用例 · {cases.length} 题
      </div>
      {cases.length === 0 && !addingCase ? (
        <div style={{
          padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13,
          background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          暂无用例 · 点「+ 新增用例」或「导入 JSONL」开始
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th style={{ width: 60 }}>ID</Th>
                <Th>问题</Th>
                <Th style={{ width: 180 }}>期望 asset_ids</Th>
                <Th style={{ width: 80 }}>操作</Th>
              </tr>
            </thead>
            <tbody>
              {addingCase && (
                <CaseRow
                  mode="add"
                  onSave={async (input) => {
                    await addCase(datasetId, input)
                    setAddingCase(false)
                    void reload()
                  }}
                  onCancel={() => setAddingCase(false)}
                />
              )}
              {cases.map((c) => (
                editingCaseId === c.id ? (
                  <CaseRow
                    key={c.id}
                    mode="edit"
                    initial={c}
                    onSave={async (input) => {
                      await patchCase(c.id, input)
                      setEditingCaseId(null)
                      void reload()
                    }}
                    onCancel={() => setEditingCaseId(null)}
                  />
                ) : (
                  <tr key={c.id}>
                    <Td><span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.ext_id ?? c.id}</span></Td>
                    <Td>
                      <div style={{ color: 'var(--text)' }}>{c.question}</div>
                      {c.expected_answer && (
                        <div style={{
                          color: '#047857', fontSize: 11, marginTop: 2,
                          padding: '2px 6px', background: '#ecfdf5', borderRadius: 4,
                          display: 'inline-block', maxWidth: '100%',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          ✓ {c.expected_answer.slice(0, 80)}
                        </div>
                      )}
                      {c.comment && <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>{c.comment}</div>}
                    </Td>
                    <Td>
                      {c.expected_asset_ids.length === 0
                        ? <span style={{ color: 'var(--muted)' }}>—</span>
                        : <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                            {c.expected_asset_ids.join(', ')}
                          </span>}
                    </Td>
                    <Td>
                      <RequirePermission name="permission:manage" fallback={null}>
                        <button type="button" style={linkBtn}
                                onClick={() => setEditingCaseId(c.id)}>改</button>
                        {' · '}
                        <button type="button" style={{ ...linkBtn, color: '#b91c1c' }}
                                onClick={async () => {
                                  if (!confirm(`删除用例 ${c.ext_id ?? c.id}？`)) return
                                  await deleteCase(c.id); void reload()
                                }}>删</button>
                      </RequirePermission>
                    </Td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Runs */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: '20px 4px 8px' }}>
        运行历史
      </div>
      {runs.length === 0 ? (
        <div style={{
          padding: 20, color: 'var(--muted)', fontSize: 13, textAlign: 'center',
          background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          暂无运行记录
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th style={{ width: 60 }}>#</Th>
                <Th style={{ width: 100 }}>状态</Th>
                <Th style={{ width: 100 }}>进度</Th>
                <Th style={{ width: 70 }}>R@1</Th>
                <Th style={{ width: 70 }}>R@3</Th>
                <Th style={{ width: 70 }}>R@5</Th>
                <Th style={{ width: 90 }}>✨ Judge</Th>
                <Th style={{ width: 110 }}>开始时间</Th>
                <Th>触发人</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <button type="button" style={linkBtn}
                            onClick={() => navigate(`/eval/runs/${r.id}`)}>#{r.id}</button>
                  </Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {r.finished}/{r.total}
                      {r.errored > 0 && <span style={{ color: '#b91c1c' }}> · {r.errored}错</span>}
                    </span>
                  </Td>
                  <Td><RecallCell v={r.recall_at_1} /></Td>
                  <Td><RecallCell v={r.recall_at_3} /></Td>
                  <Td><RecallCell v={r.recall_at_5} /></Td>
                  <Td>
                    {r.judged_count > 0 ? (
                      <span style={{ color: judgeColor(r.avg_judge_score), fontFamily: 'ui-monospace, monospace' }}>
                        {Number(r.avg_judge_score ?? 0).toFixed(2)}
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>
                          ({r.judged_count})
                        </span>
                      </span>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </Td>
                  <Td><Time ms={r.started_at_ms} /></Td>
                  <Td><span style={{ color: 'var(--muted)' }}>{r.principal_email ?? '—'}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* JSONL Import 弹窗 */}
      <ImportJsonlModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        datasetId={datasetId}
        onDone={() => { setImportOpen(false); void reload() }}
      />
    </div>
  )
}

// ── Case 行（编辑/新增 共用） ─────────────────────────────────────────────────

function CaseRow({
  mode, initial, onSave, onCancel,
}: {
  mode: 'add' | 'edit'
  initial?: EvalCase
  onSave: (input: {
    ext_id?: string; question: string; expected_asset_ids: number[];
    comment?: string; expected_answer?: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const [extId, setExtId] = useState(initial?.ext_id ?? '')
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [expectedRaw, setExpectedRaw] = useState((initial?.expected_asset_ids ?? []).join(', '))
  const [expectedAns, setExpectedAns] = useState(initial?.expected_answer ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const expected = expectedRaw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)

  async function handleSave() {
    if (!question.trim()) { setErr('question 必填'); return }
    setBusy(true); setErr(null)
    try {
      await onSave({
        ext_id: extId.trim() || undefined,
        question: question.trim(),
        expected_asset_ids: expected,
        comment: comment.trim() || undefined,
        expected_answer: expectedAns.trim() || undefined,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
      setBusy(false)
    }
  }

  return (
    <tr style={{ background: 'rgba(108,71,255,0.04)' }}>
      <Td>
        <input value={extId} onChange={(e) => setExtId(e.target.value)}
               placeholder="Q01" style={{ ...inlineField, width: 50 }} />
      </Td>
      <Td>
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                  rows={2} placeholder="问题"
                  style={{ ...inlineField, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        <textarea value={expectedAns} onChange={(e) => setExpectedAns(e.target.value)}
                  rows={2} placeholder="参考答案（选填，但填了才能跑 LLM Judge 评分）"
                  style={{ ...inlineField, width: '100%', marginTop: 4, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
        <input value={comment} onChange={(e) => setComment(e.target.value)}
               placeholder="备注（选填）"
               style={{ ...inlineField, width: '100%', marginTop: 4, fontSize: 11 }} />
        {err && <div style={{ color: '#b91c1c', fontSize: 11, marginTop: 2 }}>{err}</div>}
      </Td>
      <Td>
        <input value={expectedRaw} onChange={(e) => setExpectedRaw(e.target.value)}
               placeholder="27, 28, 29" style={{ ...inlineField, width: '100%', fontFamily: 'ui-monospace, monospace' }} />
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          已识别 {expected.length} 个 ID
        </div>
      </Td>
      <Td>
        <button type="button" style={linkBtn}
                disabled={busy} onClick={() => void handleSave()}>
          {busy ? '保存中…' : (mode === 'add' ? '新增' : '保存')}
        </button>
        <br />
        <button type="button" style={{ ...linkBtn, color: 'var(--muted)' }}
                onClick={onCancel}>取消</button>
      </Td>
    </tr>
  )
}

// ── JSONL Import 弹窗 ──────────────────────────────────────────────────────────

function ImportJsonlModal({ open, onClose, datasetId, onDone }: {
  open: boolean; onClose: () => void; datasetId: number; onDone: () => void
}) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | { inserted: number; parsed: number; errors: Array<{ line: number; error: string }> }>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (open) { setText(''); setResult(null); setErr(null); setBusy(false); setReplace(false) } }, [open])
  if (!open) return null

  async function submit() {
    if (!text.trim()) { setErr('JSONL 内容为空'); return }
    setBusy(true); setErr(null); setResult(null)
    try {
      const r = await importJsonl(datasetId, text, replace)
      setResult(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
         style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
           zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
         }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 640, maxWidth: '92vw',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          批量导入 JSONL
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          一行一条 JSON：<code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>
            {'{"id":"Q01","question":"...","expected_asset_ids":[27,28],"comment":"..."}'}
          </code>
          <br />支持 # 和 // 开头的注释行；缺失字段会跳过并报错列。
        </div>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder='# example&#10;{"id":"Q01","question":"What is X?","expected_asset_ids":[27]}'
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace',
            boxSizing: 'border-box', outline: 'none',
          }}
        />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--text)',
        }}>
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          替换模式：先清空所有现有用例再导入（默认追加）
        </label>

        {err && <div style={{
          padding: 10, marginTop: 10, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{err}</div>}

        {result && (
          <div style={{
            padding: 10, marginTop: 10, background: '#dbeafe', color: '#1e40af',
            borderRadius: 8, fontSize: 12,
          }}>
            ✓ 成功导入 {result.inserted} 条 / 解析 {result.parsed} 条
            {result.errors.length > 0 && (
              <div style={{ marginTop: 6, color: '#b91c1c' }}>
                {result.errors.length} 行失败：
                {result.errors.slice(0, 3).map((e) => (
                  <div key={e.line}>· 第 {e.line} 行：{e.error}</div>
                ))}
                {result.errors.length > 3 && <div>… 还有 {result.errors.length - 3} 条</div>}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={result ? onDone : onClose}>
            {result ? '完成' : '取消'}
          </button>
          {!result && (
            <button type="button" className="btn primary"
                    disabled={busy || !text.trim()} onClick={() => void submit()}>
              {busy ? '导入中…' : '开始导入'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const inlineField: React.CSSProperties = {
  padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13, background: '#fff', color: 'var(--text)', outline: 'none',
  boxSizing: 'border-box',
}
