/**
 * JobQueue —— /ingest 底部「任务队列」表
 * 自动轮询 /api/ingest/jobs；处理中 / 失败 计数 + 行级日志/暂停/重试 操作。
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listJobs, pauseJob, retryJob, type JobSummary, type JobPhase } from '@/api/ingest'
import EmptyState from './EmptyState'

const POLL_MS = 2000

const PHASE_TONE: Record<JobPhase, { label: string; color: string; bg: string }> = {
  pending:  { label: '排队',     color: '#6b7280', bg: '#e5e7eb' },
  parse:    { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  ocr:      { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  table:    { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  chunk:    { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  tag:      { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  embed:    { label: '处理中',   color: '#047857', bg: '#d1fae5' },
  done:     { label: '完成',     color: '#1e40af', bg: '#dbeafe' },
  failed:   { label: '失败',     color: '#b91c1c', bg: '#fee2e2' },
  paused:   { label: '已暂停',   color: '#92400e', bg: '#fef3c7' },
}

function isRunning(p: JobPhase): boolean {
  return ['pending', 'parse', 'ocr', 'table', 'chunk', 'tag', 'embed'].includes(p)
}

function subtitle(j: JobSummary): string {
  if (j.kind === 'fetch-url') return '网页抓取 · 内容抽取'
  if (j.kind === 'conversation') return '对话沉淀 · Markdown 渲染'
  if (j.kind === 'batch') return 'ZIP / 文件夹批量'
  if (j.kind === 'scan-folder') return '扫描入库'
  return '上传 · 解析 · 切分 · 向量化'
}

interface Props {
  /** 父级触发 reload（譬如刚提交了任务） */
  refreshKey?: number
  /** 控制轮询是否进行 */
  paused?: boolean
  /** 当前选中的 jobId（被父级 PreprocessingModule 消费） */
  selectedId?: string | null
  /** 用户点击行 / 队列首次冒泡推荐 时回调 */
  onSelect?: (jobId: string) => void
}

export default function JobQueue({ refreshKey, paused, selectedId, onSelect }: Props) {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  const fetchOnce = useCallback(async () => {
    try {
      const items = await listJobs({ limit: 30 })
      setJobs(items)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchOnce() }, [fetchOnce, refreshKey])

  useEffect(() => {
    if (paused) return
    const t = setInterval(() => { void fetchOnce() }, POLL_MS)
    return () => clearInterval(t)
  }, [paused, fetchOnce])

  // 自动冒泡：父级未选中时，挑第一条"运行中"任务，没有则挑最新一条
  useEffect(() => {
    if (!onSelect || selectedId || jobs.length === 0) return
    const running = jobs.find((j) => isRunning(j.phase))
    const pick = running ?? jobs[0]
    if (pick) onSelect(pick.id)
  }, [jobs, selectedId, onSelect])

  const counts = {
    running: jobs.filter((j) => isRunning(j.phase)).length,
    failed:  jobs.filter((j) => j.phase === 'failed').length,
    done:    jobs.filter((j) => j.phase === 'done').length,
  }

  if (loading && jobs.length === 0) {
    return (
      <div style={panelStyle}>
        <Header counts={counts} />
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          加载中…
        </div>
      </div>
    )
  }

  if (err) {
    return (
      <div style={panelStyle}>
        <Header counts={counts} />
        <div style={{ padding: 20, color: '#b91c1c', fontSize: 13 }}>{err}</div>
      </div>
    )
  }

  return (
    <div style={panelStyle} data-testid="job-queue">
      <Header counts={counts} />

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>条目</Th>
                <Th>空间</Th>
                <Th>状态</Th>
                <Th style={{ width: 200 }}>进度</Th>
                <Th style={{ width: 100 }}>操作</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const tone = PHASE_TONE[j.phase]
                const action = j.phase === 'failed' ? '重试' : isRunning(j.phase) ? '暂停' : '日志'
                const isSelected = selectedId === j.id
                const onAction = async () => {
                  if (action === '暂停') { await pauseJob(j.id); void fetchOnce() }
                  else if (action === '重试') { await retryJob(j.id); void fetchOnce() }
                  else navigate(`/ingest/jobs/${j.id}`)
                }
                const onSelectRow = () => {
                  if (onSelect) onSelect(j.id)
                  else navigate(`/ingest/jobs/${j.id}`)
                }
                return (
                  <tr
                    key={j.id}
                    data-testid={`job-row-${j.id}`}
                    onClick={onSelectRow}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(108,71,255,0.06)' : 'transparent',
                    }}
                  >
                    <Td>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                        <span
                          style={{
                            color: isSelected ? 'var(--p, #6C47FF)' : 'var(--text)',
                            fontWeight: isSelected ? 600 : 500, fontSize: 13,
                          }}
                        >
                          {isSelected ? '▸ ' : ''}{j.name}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {subtitle(j)}
                        {j.error && <span style={{ color: '#b91c1c' }}>　·　{j.error}</span>}
                      </div>
                    </Td>
                    <Td>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{j.space}</span>
                    </Td>
                    <Td>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                        background: tone.bg, color: tone.color, fontSize: 12, fontWeight: 500,
                      }}>{tone.label}</span>
                    </Td>
                    <Td>
                      {j.phase === 'failed' ? (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      ) : (
                        <ProgressBar percent={j.progress} />
                      )}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void onAction() }}
                        data-testid={`job-action-${j.id}`}
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--p, #6C47FF)',
                          fontSize: 13, cursor: 'pointer', padding: 0,
                        }}
                      >
                        {action}
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
  marginTop: 14, overflow: 'hidden',
}

function Header({ counts }: { counts: { running: number; failed: number; done: number } }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>任务队列</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Badge tone="green"  text={`处理中 ${counts.running}`} />
        <Badge tone="amber"  text={`失败 ${counts.failed}`} />
        <Badge tone="muted"  text={`完成 ${counts.done}`} />
      </div>
    </div>
  )
}

function Badge({ tone, text }: { tone: 'green' | 'amber' | 'muted'; text: string }) {
  const styles = {
    green: { bg: '#d1fae5', color: '#047857' },
    amber: { bg: '#fee2e2', color: '#b91c1c' },
    muted: { bg: '#f3f4f6', color: '#6b7280' },
  }[tone]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
      background: styles.bg, color: styles.color,
    }}>{text}</span>
  )
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{
      textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
      color: 'var(--muted)', background: '#f9fafb', borderBottom: '1px solid var(--border)',
      ...style,
    }}>{children}</th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{
      padding: '12px 14px', borderBottom: '1px solid #f3f4f6',
      verticalAlign: 'top', ...style,
    }}>{children}</td>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${percent}%`, height: '100%',
          background: 'var(--p, #6C47FF)', transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text)', width: 40, textAlign: 'right' }}>
        {Math.round(percent)}%
      </span>
    </div>
  )
}
