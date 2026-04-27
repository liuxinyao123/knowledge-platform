/**
 * /eval —— 评测中心
 *
 * 主页：
 *   - 数据集列表（含 case 数 + 最近一次 run 的时间）
 *   - 「新建数据集」按钮 → 弹窗
 *   - 最近 runs 列表（汇总 R@1/3/5）
 *
 * 仅资产级 recall@K（Roadmap-2 的雏形）。Faithfulness / Answer Relevancy 等
 * Ragas 指标走 Python 单独评测，后期再接进来。
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import RequirePermission from '@/auth/RequirePermission'
import {
  listDatasets, listRuns, createDataset,
  type EvalDatasetSummary, type EvalRunSummary,
} from '@/api/eval'
// judgeColor 在本文件下面定义

export default function EvalPage() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState<EvalDatasetSummary[] | null>(null)
  const [runs, setRuns] = useState<EvalRunSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [ds, rs] = await Promise.all([listDatasets(), listRuns()])
      setDatasets(ds); setRuns(rs); setErr(null)
    } catch (e) {
      // 即便失败也把空数组放进去，否则 UI 永远停在 Skeleton 看不到错误
      setDatasets((prev) => prev ?? [])
      setRuns((prev) => prev ?? [])
      const msg = e instanceof Error ? e.message : 'load failed'
      // 加 hint：404 大概率是后端没重启拿到新路由
      setErr(/404/.test(msg)
        ? `${msg} —— /api/eval/* 端点 404；qa-service 需要重启拿新代码：pnpm dev:down && pnpm dev:up`
        : msg)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  // 有 running 的话自动 2s 轮询
  useEffect(() => {
    if (!runs?.some((r) => r.status === 'pending' || r.status === 'running')) return
    const t = setInterval(() => { void reload() }, 2000)
    return () => clearInterval(t)
  }, [runs, reload])

  return (
    <div className="page-body">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">评测中心</div>
          <div className="page-sub">资产级 recall@K · 用 golden set 量化 RAG 检索质量</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回总览</button>
          <RequirePermission name="permission:manage" fallback={null}>
            <button className="btn primary" onClick={() => setCreateOpen(true)}>+ 新建数据集</button>
          </RequirePermission>
        </div>
      </div>

      <KnowledgeTabs />

      {err && (
        <div style={{
          padding: 12, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13,
        }}>{err}</div>
      )}

      {/* 数据集列表 */}
      <Section title="数据集">
        {datasets == null ? (
          <Skeleton />
        ) : datasets.length === 0 ? (
          <Empty
            text="暂无评测数据集"
            hint="点右上角「+ 新建数据集」开始；内置有 10 题入门模板可直接选用"
          />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>名称</Th>
                  <Th style={{ width: 80 }}>用例数</Th>
                  <Th>描述</Th>
                  <Th style={{ width: 130 }}>最近 run</Th>
                  <Th style={{ width: 100 }}>操作</Th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <button
                        type="button"
                        onClick={() => navigate(`/eval/datasets/${d.id}`)}
                        style={linkBtn}
                      >{d.name}</button>
                    </Td>
                    <Td>{d.case_count}</Td>
                    <Td><span style={{ color: 'var(--muted)' }}>{d.description ?? '—'}</span></Td>
                    <Td>{d.last_run_at_ms ? <Time ms={d.last_run_at_ms} /> : <span style={{ color: 'var(--muted)' }}>—</span>}</Td>
                    <Td>
                      <button type="button" style={linkBtn}
                              onClick={() => navigate(`/eval/datasets/${d.id}`)}>详情 →</button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 最近 runs */}
      <Section title="最近运行">
        {runs == null ? (
          <Skeleton />
        ) : runs.length === 0 ? (
          <Empty text="暂无运行记录" hint='进入数据集详情页点「运行评测」' />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th style={{ width: 60 }}>#</Th>
                  <Th>数据集</Th>
                  <Th style={{ width: 100 }}>状态</Th>
                  <Th style={{ width: 100 }}>进度</Th>
                  <Th style={{ width: 70 }}>R@1</Th>
                  <Th style={{ width: 70 }}>R@3</Th>
                  <Th style={{ width: 70 }}>R@5</Th>
                  <Th style={{ width: 90 }}>✨ Judge</Th>
                  <Th style={{ width: 100 }}>开始</Th>
                  <Th>触发人</Th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <button type="button" style={linkBtn}
                              onClick={() => navigate(`/eval/runs/${r.id}`)}>#{r.id}</button>
                    </Td>
                    <Td>
                      <span style={{ color: 'var(--text)' }}>{r.dataset_name ?? `dataset ${r.dataset_id}`}</span>
                    </Td>
                    <Td><StatusPill status={r.status} /></Td>
                    <Td>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {r.finished}/{r.total}{r.errored > 0 && <span style={{ color: '#b91c1c' }}> · {r.errored}错</span>}
                      </span>
                    </Td>
                    <Td><RecallCell v={r.recall_at_1} /></Td>
                    <Td><RecallCell v={r.recall_at_3} /></Td>
                    <Td><RecallCell v={r.recall_at_5} /></Td>
                    <Td>
                      {r.judged_count > 0 ? (
                        <span style={{
                          color: judgeColor(r.avg_judge_score), fontFamily: 'ui-monospace, monospace',
                        }}>
                          {Number(r.avg_judge_score ?? 0).toFixed(2)}
                          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>
                            ({r.judged_count})
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </Td>
                    <Td><Time ms={r.started_at_ms} /></Td>
                    <Td><span style={{ color: 'var(--muted)' }}>{r.principal_email ?? '—'}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <CreateDatasetModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          navigate(`/eval/datasets/${id}`)
        }}
      />
    </div>
  )
}

// ── modals & helpers ─────────────────────────────────────────────────────────

function CreateDatasetModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(''); setDesc(''); setErr(null); setBusy(false) }
  }, [open])

  if (!open) return null

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('请输入名称'); return }
    setBusy(true); setErr(null)
    try {
      const r = await createDataset({ name: trimmed, description: desc.trim() || undefined })
      onCreated(r.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '创建失败'
      setErr(/404/.test(msg)
        ? `${msg} —— /api/eval/datasets 不存在；后端 qa-service 没拿到新路由，需要 pnpm dev:down && pnpm dev:up 重启`
        : msg)
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
        background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
          新建评测数据集
        </div>
        <div style={{ marginBottom: 12 }}>
          <Label>名称 <span style={{ color: '#dc2626' }}>*</span></Label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="如：研发文档 Q&amp;A 评测集 v1"
                 style={fieldStyle} autoFocus
                 onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Label>描述（选填）</Label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
                    rows={3} placeholder="覆盖范围 / 业务方 / 注意事项"
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{
          padding: 10, marginBottom: 12, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 12,
        }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn primary"
                  disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: '14px 4px 8px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ padding: 30, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>加载中…</div>
  )
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{
      padding: '30px 20px', textAlign: 'center', color: 'var(--muted)',
      background: '#fafafa', border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      <div style={{ fontSize: 13 }}>{text}</div>
      {hint && <div style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function StatusPill({ status }: { status: EvalRunSummary['status'] }) {
  const tone = status === 'done' ? { bg: '#dbeafe', color: '#1e40af', label: '完成' }
    : status === 'failed' ? { bg: '#fee2e2', color: '#b91c1c', label: '失败' }
    : status === 'running' ? { bg: '#d1fae5', color: '#047857', label: '运行中' }
    : { bg: '#f3f4f6', color: '#6b7280', label: '排队' }
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
      background: tone.bg, color: tone.color,
    }}>{tone.label}</span>
  )
}

export function RecallCell({ v }: { v: string | null }) {
  if (v == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  const n = Number(v)
  const color = n >= 0.9 ? '#047857' : n >= 0.5 ? '#92400e' : '#b91c1c'
  return <span style={{ color, fontFamily: 'ui-monospace, monospace' }}>{n.toFixed(2)}</span>
}

export function judgeColor(v: string | null | undefined): string {
  if (v == null) return 'var(--muted)'
  const n = Number(v)
  return n >= 0.8 ? '#047857' : n >= 0.5 ? '#92400e' : '#b91c1c'
}

export function Time({ ms }: { ms: number }) {
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
      {`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
    </span>
  )
}

export const tableWrapStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
}
export const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse',
}
// 2026-04-25 unblock build: children 改可选（RunDetail 里有空 <Th /> / <Td />）；Td 加 colSpan 透传
export function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{
    textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
    color: 'var(--muted)', background: '#f9fafb', borderBottom: '1px solid var(--border)',
    ...style,
  }}>{children}</th>
}
export function Td({ children, style, colSpan }: { children?: React.ReactNode; style?: React.CSSProperties; colSpan?: number }) {
  return <td colSpan={colSpan} style={{
    padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
    fontSize: 13, color: 'var(--text)', verticalAlign: 'top',
    ...style,
  }}>{children}</td>
}

export const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0,
  color: 'var(--p, #6C47FF)', cursor: 'pointer', textAlign: 'left', fontSize: 13,
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 13, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{
    fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 4,
  }}>{children}</div>
}
